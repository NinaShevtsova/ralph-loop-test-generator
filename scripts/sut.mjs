// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The tests talk to a real application — a demo veterinary-clinic API running in Docker.
// This script is the remote control for it: start it, wait until it answers, put it back
// to a clean state, stop it.
//
// Resetting before every test run is the load-bearing part. Without it, records left over
// from the previous run make a test fail for reasons that have nothing to do with the
// test, and the loop would blame the AI for a dirty database.
//
// It does not take "it answered" as proof of a restart, either: the application answering
// is equally true of one that never restarted. So a reset also checks that the container's
// start time really moved and that the data really is back to its seeded amounts.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/sut.mjs — lifecycle of the system under test (Spring PetClinic REST in Docker).
//
// Design D-09: the state is reset before every gate run, because only then does a red test
// unambiguously mean "the test is bad" rather than "the database is dirty".
// Design D-10: the FRAMEWORK never restarts anything. Restarting lives here, in the harness,
// so the delivered framework still runs against a shared environment.
//
//   node scripts/sut.mjs ensure    create the container if missing, start it, wait for ready
//   node scripts/sut.mjs reset     restart (or create), wait for ready, and PROVE both happened
//   node scripts/sut.mjs wait      only wait for ready
//   node scripts/sut.mjs stop      stop the container
//
// `reset` is the one command a gate grades, and `runGate` grades it on its exit code alone, so its
// exit code carries two proofs the readiness probe cannot give: the container's own start time moved
// (`restartVerdict`), and the application that answered is serving the seed (`SEED_COUNTS`). Both
// exist because `/pettypes` answering 200 is equally true of an application that never restarted.

import { brokenInvocationMessage, invocation, run } from './lib.mjs';

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
 * The H2 seed the image reloads on every start. Measured against a freshly reset container on
 * 2026-08-09: `GET /pettypes` 6, `/owners` 10, `/pets` 13, `/visits` 4.
 *
 * These exist to answer the question the readiness probe cannot: `/pettypes` answering `200` is
 * equally true of an application that was never restarted. Leftover records from a previous run are
 * the harmful case and they show up as counts ABOVE the seed.
 */
export const SEED_COUNTS = { pettypes: 6, owners: 10, pets: 13, visits: 4 };

/**
 * The collections holding more records than the seed, described for a human. Empty means clean.
 *
 * Only the ABOVE direction is a failure. Below-seed cannot be leftover data — it is either a
 * different image or a collection read while the seed was still loading — and turning that into a
 * red gate would stop the loop for something that is not the condition D-09 cares about.
 */
export function aboveSeed(counts, seed = SEED_COUNTS) {
  return Object.entries(seed)
    .filter(([name, expected]) => Number.isInteger(counts?.[name]) && counts[name] > expected)
    .map(([name, expected]) => `${name}: ${counts[name]}, seed ${expected}`);
}

/**
 * What the container's own start time says about a restart: `'moved'`, `'unmoved'` or `'unreadable'`.
 *
 * `docker inspect -f '{{.State.StartedAt}}'` is the strongest proof available that is independent of
 * the test data. Measured across `docker restart petclinic`:
 * `2026-08-09T17:51:55.794465458Z` -> `2026-08-09T17:56:13.340830095Z`.
 *
 * A missing `before` is only acceptable when the container did not exist and was created — otherwise
 * the baseline could not be read and there is nothing to compare, which is `'unreadable'` and not
 * proof. Treating that as `'moved'` would reinstate the whole defect: a step reporting success for a
 * check it never managed to run.
 */
export function restartVerdict(before, after, { created = false } = {}) {
  if (!after) return 'unreadable';
  if (!created && !before) return 'unreadable';
  if (before && before === after) return 'unmoved';
  return 'moved';
}

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

/**
 * The container's own start time, or `''` when docker will not say.
 *
 * Reads `.stdout`, NOT `.out`, for the reason `exists()` documents: `run()` merges stderr in, and a
 * credential-helper warning would then be compared as if it were the timestamp.
 */
function startedAt() {
  const result = run('docker', ['inspect', '-f', '{{.State.StartedAt}}', CONTAINER]);
  return result.ok ? result.stdout.trim() : '';
}

/**
 * Refuses unless the container's start time actually moved.
 *
 * This is the half of D-09 nothing checked. `reset` used to prove only that `/pettypes` answers
 * `200` — which an application that was never restarted answers too — so a `reset` that did nothing
 * exited 0, the gate went green, and every red test afterwards was blamed on the test. The runner
 * grades this step on its exit code alone; the exit code is therefore what has to be honest.
 */
function requireRestarted(before, after, created) {
  const verdict = restartVerdict(before, after, { created });
  if (verdict === 'moved') {
    console.log(`sut: ${CONTAINER} start time ${before || '(newly created)'} -> ${after}`);
    return;
  }
  if (verdict === 'unmoved') {
    console.error(
      `sut: ${CONTAINER} reports the same start time before and after the restart (${after}) — ` +
        `the container did not restart, so the database still holds whatever the last run left in it`
    );
    process.exit(1);
  }
  console.error(
    `sut: cannot read ${CONTAINER}'s start time from \`docker inspect\`, so there is no evidence the ` +
      `reset happened — refusing to report success for a step that may have done nothing`
  );
  process.exit(1);
}

/**
 * The second, independent signal: the restarted application is serving the SEED and nothing more.
 *
 * The start-time check proves the action; this proves the outcome, and it is the only one of the two
 * that survives a `PETCLINIC_BASE_URL` pointing at a different host from the container we restarted
 * (`checkConfig` compares the port, not the host).
 */
async function requireSeedCounts() {
  const root = BASE_URL.replace(/\/+$/, '');
  const counts = {};
  const unread = [];

  for (const name of Object.keys(SEED_COUNTS)) {
    try {
      const response = await fetch(`${root}/${name}`, {
        signal: AbortSignal.timeout(10000),
        redirect: 'manual',
      });
      if (response.status !== 200) {
        unread.push(`${name} (HTTP ${response.status})`);
        await response.arrayBuffer().catch(() => {});
        continue;
      }
      const body = await response.json();
      if (!Array.isArray(body)) unread.push(`${name} (not a JSON array)`);
      else counts[name] = body.length;
    } catch (error) {
      unread.push(`${name} (${error?.message ?? error})`);
    }
  }

  const over = aboveSeed(counts);
  if (over.length > 0) {
    console.error(`sut: the database is NOT at its seed after the restart — ${over.join('; ')}`);
    console.error(
      'sut: counts above the seed are records that survived the reset, which is exactly the dirty ' +
        'state D-09 exists to prevent'
    );
    console.error(
      `sut: (if PETCLINIC_IMAGE was changed, the seed recorded in scripts/sut.mjs — ` +
        `${JSON.stringify(SEED_COUNTS)} — is what is stale)`
    );
    process.exit(1);
  }

  // A check that counted NOTHING is not a passing check — `Verdict.report` refuses on exactly this
  // shape. The readiness probe has already had `/pettypes` answer 200, so no collection being
  // readable means the answer came from something that is not this application.
  const seen = Object.entries(counts).map(([name, n]) => `${name}: ${n}`);
  if (seen.length === 0) {
    console.error(`sut: not one seeded collection could be counted — ${unread.join(', ')}`);
    console.error('sut: refusing to report a clean database that nothing was able to look at');
    process.exit(1);
  }

  console.log(`sut: seed intact — ${seen.join(', ')}`);
  if (unread.length > 0) console.log(`sut: not compared — ${unread.join(', ')}`);
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
 * The three-way answer is the point, and `lib.mjs` carries the measurements. `'import'` stays inert,
 * as `tests/sut.test.mjs` requires. `'broken'` — argv[1] names THIS file and cannot be confirmed to
 * BE this file — used to be indistinguishable from an import, so the whole `switch` below was
 * skipped and `node scripts/sut.mjs reset` exited **0 having done nothing** (measured through a
 * `subst` drive). `runGate` grades on the exit code alone, so the gate went green without a reset and
 * every red test afterwards was blamed on the test rather than on the database. Whatever the
 * environment does to path spellings, `node …/sut.mjs` now either runs or exits non-zero.
 */
const how = invocation(import.meta.url, process.argv[1]);

if (how === 'broken') {
  console.error(
    brokenInvocationMessage(
      import.meta.url,
      process.argv[1],
      'exiting 2 rather than 0, because a silent 0 here is a gate step reporting that it reset the ' +
        'database when it did not run at all'
    )
  );
  process.exit(2);
}

if (how === 'cli') {
  checkConfig();

  const command = process.argv[2] ?? 'ensure';
  switch (command) {
    case 'ensure':
      if (!exists()) create();
      else start();
      await waitOrDie();
      break;
    case 'reset': {
      // The proof, in the order the evidence becomes available: the start time is readable the
      // moment docker returns, so it is compared BEFORE spending the readiness budget on a container
      // that never moved.
      const present = exists();
      const before = present ? startedAt() : '';
      if (!present) create();
      else restart();
      requireRestarted(before, startedAt(), !present);
      await waitOrDie();
      await requireSeedCounts();
      break;
    }
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
