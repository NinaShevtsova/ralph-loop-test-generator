// scripts/sut.mjs — lifecycle of the system under test (Spring PetClinic REST in Docker).
//
// Design D-09: the state is reset before every gate run, because only then does a red test
// unambiguously mean "the test is bad" rather than "the database is dirty".
// Design D-10: the FRAMEWORK never restarts anything. Restarting lives here, in the harness,
// so the delivered framework still runs against a shared environment.
//
//   node scripts/sut.mjs ensure    create the container if missing, start it, wait for ready
//   node scripts/sut.mjs reset     restart (or create) and wait for ready
//   node scripts/sut.mjs wait      only wait for ready
//   node scripts/sut.mjs stop      stop the container

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { run } from './lib.mjs';

// The image listens on 9966 INSIDE the container, and that is not configurable from here — the
// port and the /petclinic/api base path are baked into the published image. PETCLINIC_PORT moves
// only the HOST side of the mapping. Publishing `<host>:<host>` would map to a port nothing
// listens on, so every gate run would wait out its whole readiness budget and then fail.
const CONTAINER_PORT = 9966;

export const IMAGE = process.env.PETCLINIC_IMAGE ?? 'springcommunity/spring-petclinic-rest';
export const CONTAINER = process.env.PETCLINIC_CONTAINER ?? 'petclinic';
export const HOST_PORT = Number(process.env.PETCLINIC_PORT ?? CONTAINER_PORT);
export const BASE_URL = process.env.PETCLINIC_BASE_URL ?? `http://localhost:${HOST_PORT}/petclinic/api`;
export const READY_URL = `${BASE_URL.replace(/\/+$/, '')}/pettypes`;
export const READY_TIMEOUT_MS = Number(process.env.PETCLINIC_READY_TIMEOUT_MS ?? 90000);

/**
 * Polls `url` until PetClinic answers `200`, or the budget expires. Resolves
 * `{ ready, attempts, lastError }` and never rejects for a network condition — a rejected promise
 * here would surface as a crashed gate instead of a red one.
 *
 * It DOES throw on a malformed budget, because that is a configuration error rather than a state to
 * wait out. Measured: `Number('90_000')` is NaN, `Date.now() >= NaN` is always false, and the loop
 * then spun 121 times in 2 seconds and never returned — a gate hung forever with no output. The
 * `90_000` spelling is the one used in this file's own source, so it is an easy thing to paste into
 * an environment variable.
 *
 * **Only `200` counts as ready.** An earlier version also accepted `404`, reasoning that an empty
 * collection answers `404` and that still proves the app is routing. That is wrong on the path the
 * loop actually uses: the H2 seed reloads on every start with 6 pet types, so after a reset
 * `/pettypes` must answer `200`. A `404` there means "up but unseeded" — a dirty-state condition
 * the gate has to notice, not wave through. Measured with the old rule: a bare `404` from a
 * non-PetClinic server and a `302` to an unrelated login page both read as "PetClinic is ready".
 */
export function pollUntilReady(url, { timeoutMs = READY_TIMEOUT_MS, intervalMs = 1000 } = {}) {
  // Validated SYNCHRONOUSLY, before any promise exists. A malformed budget is a configuration
  // error, not a state to wait out, so it must fail at the call site rather than become a rejected
  // promise that a missing `await` could swallow.
  //
  // This is also why the function is not itself `async`: an `async function` cannot throw
  // synchronously at all — it returns a rejected promise — so a caller (or a test) written as
  // `assert.throws(() => pollUntilReady(...))` could never see the error, and Node would report a
  // leaked unhandledRejection instead.
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`pollUntilReady: timeoutMs must be a finite non-negative number, got ${timeoutMs}`);
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`pollUntilReady: intervalMs must be a positive finite number, got ${intervalMs}`);
  }

  return poll(url, timeoutMs, intervalMs);
}

/**
 * The smallest remaining budget worth spending on an attempt. Below this a request cannot complete
 * even on loopback, so issuing it produces nothing but an abort message that hides the real reason.
 * It only ever trims the tail of an exhausted budget — the first attempt is always made.
 */
const MIN_ATTEMPT_MS = 50;

/** The polling loop itself. Reached only through `pollUntilReady`, which validates the budget. */
async function poll(url, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError = 'no attempt completed';

  for (;;) {
    const remaining = deadline - Date.now();

    // Checked BEFORE the attempt, and this is NOT redundant with the check at the bottom of the
    // loop. Without it the sleep can carry us past the deadline, and the loop then runs one more
    // attempt with `perRequest` clamped to 1 ms — which always aborts, and its abort message
    // overwrites the real reason. Measured against a stub answering 404: `lastError` came back as
    // "The operation was aborted due to timeout" instead of "HTTP 404", so `waitOrDie` printed the
    // same useless line for every possible failure and the reason was never usable.
    //
    // `< MIN_ATTEMPT_MS`, not `<= 0`. The original guard only caught a sleep that overshot the
    // deadline, which is the rare case. The common one is a final iteration starting with a small
    // POSITIVE remainder — `perRequest` is then clamped to a few milliseconds, the request cannot
    // finish inside it, and the abort overwrites `lastError` exactly as above. Measured: the 404 test
    // failed this way 2 times in 20 runs even after its budget was raised to 1000 ms, because the
    // last of ~40 attempts landed with 3 ms left. A budget too small to answer in is not a budget.
    if (attempts > 0 && remaining < MIN_ATTEMPT_MS) return { ready: false, attempts, lastError };

    // Clamped to what is left of the budget. Measured unclamped: a server that accepts the
    // connection and never answers made a 200 ms budget take 5018 ms — 25x over.
    const perRequest = Math.max(1, Math.min(5000, remaining > 0 ? remaining : 1));

    attempts += 1;
    try {
      // `redirect: 'manual'` — following redirects let a captive portal, or a stale container of a
      // different image, answer on PetClinic's behalf.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(perRequest),
        redirect: 'manual',
      });
      if (response.status === 200) return { ready: true, attempts, lastError: '' };
      lastError = `HTTP ${response.status}`;
      // Consume the body, or the socket is held until garbage collection.
      await response.arrayBuffer().catch(() => {});
    } catch (error) {
      // Keep the reason. A bare `catch {}` made a malformed URL — `localhost:9966` without a
      // scheme is the likeliest way anyone mis-sets it — produce 90 identical doomed attempts and
      // then a message blaming the application. A blind loop cannot fix what it cannot see.
      lastError = error?.message ?? String(error);
    }

    if (Date.now() >= deadline) return { ready: false, attempts, lastError };
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

/**
 * Whether the container exists at all.
 *
 * Reads `.stdout`, NOT `.out`: `run()` merges stderr into `out`, so any docker warning — a
 * credential-helper notice, a config deprecation — would fail the comparison and send us on to
 * create a container that already exists, which then dies with "the container name is already in
 * use". `lib.mjs` documents the same trap for `git()`. A failed `docker ps` is also not evidence
 * of absence, so it stops the run rather than guessing.
 */
function exists() {
  const result = run('docker', [
    'ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Names}}',
  ]);
  if (!result.ok) {
    console.error(`sut: \`docker ps\` failed — cannot tell whether ${CONTAINER} exists\n${result.out}`);
    process.exit(1);
  }
  return result.stdout.trim() === CONTAINER;
}

function create() {
  console.log(`sut: creating container ${CONTAINER} from ${IMAGE} (host ${HOST_PORT} -> container ${CONTAINER_PORT})`);
  const result = run('docker', [
    'run', '-d', '--name', CONTAINER, '-p', `${HOST_PORT}:${CONTAINER_PORT}`, IMAGE,
  ]);
  if (!result.ok) {
    console.error(`sut: docker run failed\n${result.out}`);
    process.exit(1);
  }
}

/**
 * Starts an existing container. The result is checked: a `docker run` that failed because the host
 * port was taken leaves the container CREATED but not started, with its name consumed. Ignoring
 * this failure sent us straight to the readiness probe, which would then be answered by whatever
 * else owns the port — and the gate would run the suite against a foreign server.
 */
function start() {
  const result = run('docker', ['start', CONTAINER]);
  if (!result.ok) {
    console.error(`sut: docker start ${CONTAINER} failed\n${result.out}`);
    process.exit(1);
  }
}

function restart() {
  console.log(`sut: restarting ${CONTAINER}`);
  const result = run('docker', ['restart', CONTAINER]);
  if (!result.ok) {
    console.error(`sut: docker restart failed\n${result.out}`);
    process.exit(1);
  }
}

async function waitOrDie() {
  console.log(`sut: waiting for ${READY_URL} (timeout ${READY_TIMEOUT_MS} ms)`);
  const { ready, attempts, lastError } = await pollUntilReady(READY_URL);
  if (ready) {
    console.log(`sut: ready after ${attempts} attempt(s)`);
    return;
  }
  console.error(`sut: ${READY_URL} did not become ready within ${READY_TIMEOUT_MS} ms`);
  console.error(`sut: ${attempts} attempt(s), last failure: ${lastError}`);
  process.exit(1);
}

/** Configuration that would make the script probe one endpoint while the container binds another. */
function checkConfig() {
  for (const [name, value] of [
    ['PETCLINIC_PORT', HOST_PORT],
    ['PETCLINIC_READY_TIMEOUT_MS', READY_TIMEOUT_MS],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      console.error(`sut: ${name}=${process.env[name]} — must be a positive integer`);
      process.exit(2);
    }
  }

  // PETCLINIC_BASE_URL says where to PROBE; PETCLINIC_PORT says where to PUBLISH. Different
  // consumers set them — the C# framework reads the URL, this script does the port mapping — so a
  // disagreement is silent and makes the probe watch an endpoint the container never binds.
  if (process.env.PETCLINIC_BASE_URL) {
    let declared;
    try {
      declared = new URL(BASE_URL);
    } catch {
      console.error(`sut: PETCLINIC_BASE_URL=${BASE_URL} is not a valid absolute URL (is the scheme missing?)`);
      process.exit(2);
    }
    const declaredPort = Number(declared.port || (declared.protocol === 'https:' ? 443 : 80));
    if (declaredPort !== HOST_PORT) {
      console.error(
        `sut: PETCLINIC_BASE_URL points at port ${declaredPort} but the container publishes ` +
          `${HOST_PORT} — the probe would watch a different endpoint from the one the container binds`
      );
      process.exit(2);
    }
  }
}

/**
 * Only act as a CLI when executed directly — imported by tests, this file must stay inert.
 *
 * `realpathSync.native` is not optional. Node resolves the main module to its REAL path for
 * `import.meta.url`, while `process.argv[1]` keeps whatever path was typed. Reached through a
 * junction, a symlink or a `subst` drive — all ordinary on Windows — the two never match, the whole
 * `switch` is skipped, and `node scripts/sut.mjs reset` exits **0 having done nothing**. Measured:
 * through a junction, `sut.mjs bogus` printed nothing and exited 0; through the real path it
 * printed the error and exited 2. `runGate` only checks the exit code, so the gate would go green
 * without resetting the database, and every red test afterwards would be blamed on the test.
 */
const executedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync.native(entry)).href;
  } catch {
    return false;
  }
})();

if (executedDirectly) {
  checkConfig();

  const command = process.argv[2] ?? 'ensure';
  switch (command) {
    case 'ensure':
      if (!exists()) create();
      else start();
      await waitOrDie();
      break;
    case 'reset':
      if (!exists()) create();
      else restart();
      await waitOrDie();
      break;
    case 'wait':
      await waitOrDie();
      break;
    case 'stop': {
      const stopped = run('docker', ['stop', CONTAINER]);
      if (!stopped.ok) {
        console.error(`sut: docker stop ${CONTAINER} failed\n${stopped.out}`);
        process.exit(1);
      }
      console.log(`sut: stopped ${CONTAINER}`);
      break;
    }
    default:
      console.error(`sut: unknown command "${command}" — use ensure | reset | wait | stop`);
      process.exit(2);
  }
}
