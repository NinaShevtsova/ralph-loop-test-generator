// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// Everything else in this project asks whether a test LOOKS like it checks something. This
// script asks whether it actually does — by breaking the application on purpose.
//
// It slips a small relay between the tests and the application, quietly damages one field
// in the answers coming back, and then demands that the tests which check that field turn
// red. A test suite that stays green while the application is lying is green about
// nothing, and no amount of reading the code proves otherwise.
//
// Two safety rails, both learned the hard way. It first proves the suite is green with the
// relay in place and nothing broken — otherwise a faulty relay makes every test fail and
// every deliberate break look "caught". And it refuses to count a break that reddens the
// WHOLE suite, because a test that would have failed no matter what proves nothing about
// the field it names.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/mutation-control.mjs — proof that the generated tests can fail.
//
// Everything else in this repository asks whether a scenario LOOKS like it verifies its acceptance
// criterion: regexes rule out the shapes that cannot fail, and a judge reads the diff for the ones
// they cannot see. Both are judgement about text. Nobody had ever established, by running anything,
// that a single one of the twenty scenarios goes red when the API stops behaving — and "the tests are
// green" is worth exactly nothing until that is known.
//
// So: put a proxy in front of PetClinic, break one thing in its responses, and require the scenarios
// that assert on that thing to fail. Nothing in `framework/` is touched — the framework reads its base
// URL from `PETCLINIC_BASE_URL`, so the proxy is addressed by configuration alone and the delivered
// tests stay exactly what the client gets.
//
//   npm run control -- list                      what each mutation breaks, and what must go red
//   npm run control -- serve --mutation drop-pet-name
//   npm run control                              baseline, then every mutation in turn
//
// IT NEEDS DOCKER AND TAKES MINUTES. Each mutation is a full suite run, and the baseline is one more.
//
// A BASELINE FIRST, always. A red suite proves nothing about a mutation: the failures could be the
// database, the container, a half-finished turn. The control only means something if the same suite
// was green one run earlier against the unmutated API.

import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';

import { repoRoot, run, invocation, brokenInvocationMessage } from './lib.mjs';
import { BASE_URL } from './sut.mjs';

const ROOT = repoRoot(import.meta.url);
const SOLUTION = 'framework/ApiTests.sln';

/**
 * What each mutation breaks, and the acceptance criteria that must notice.
 *
 * `expect` is deliberately the MINIMUM set — the scenarios whose own AC text names the thing being
 * broken — not everything that happens to touch it. A control that demanded the full blast radius
 * would go red every time an unrelated scenario was added, and a control nobody trusts is a control
 * nobody runs. Anything else that fails is reported as observed, and is not a failure of the control.
 *
 * Every mutation is scoped to GET. Teardown deletes what the scenarios create, and a mutation that
 * reached DELETE would leave records behind in a database the next run is graded against.
 */
export const MUTATIONS = {
  /*
   * The framework's own contracts, not the scenarios'. Everything above breaks a FIELD and asks which
   * acceptance criteria notice. These break a CALL and ask how the framework reports it.
   *
   * They exist because the contracts they cover were, until this file, held up by prose alone.
   * Measured: with the role split removed from all ten call sites of `OwnerSteps.cs`, `dotnet build`,
   * `check:scaffold`, `check:invariants`, `check:tests` and all 17 tests stayed green. Nothing in the
   * harness could tell the difference, so nothing was enforcing it.
   */

  'reject-owner-creation': {
    description: 'POST /owners answers 500, in a step that is a When for one AC and a Given for three',
    expect: ['AC-F01-01', 'AC-F01-02', 'AC-F01-03', 'AC-F01-04'],
    applies: ({ method, pathname }) => method === 'POST' && /\/owners\d?$/.test(pathname),
    mutate: () => ({ status: 500, body: { error: 'mutation-control' } }),
    proves: {
      // `an owner is registered` is the criterion of AC-F01-01 and the precondition of the other
      // three. One method, two roles -- which is why the role cannot be chosen at the call site.
      'a When reports the unmet criterion as a FAILURE, with a because':
        /AC_F01_01[\s\S]*?Expected response\.StatusCode[\s\S]*?because the contract/,
      'a Given reports the broken precondition as an ERROR':
        /AC_F01_02[\s\S]*?System\.InvalidOperationException/,
      // The same output proves the message carries the request, which no other check looks at.
      'the failure names the verb and the URL':
        /POST http:\/\/[^\s]+\/owners → 500/,
    },
  },

  'refuse-visit-delete': {
    description: 'DELETE /visits/{id} answers 500, which only teardown ever calls',
    // Teardown runs after the scenario, so the failure lands on whichever scenarios created a visit.
    expect: ['AC-F01-04'],
    applies: ({ method, pathname }) => method === 'DELETE' && /\/visits\/\d+$/.test(pathname),
    mutate: () => ({ status: 500, body: { error: 'mutation-control' } }),
    proves: {
      // The defect this replaces: the clear sat after the loop and the throw left the three later
      // lists undrained, so one 500 on a visit leaked an owner, a pet and a pet type into the next
      // scenario. If the later passes still run, the message names the visit route and nothing else.
      'teardown still names the visit delete it could not do':
        /DELETE http:\/\/[^\s]+\/visits\/\d+ → 500/,
    },
  },

  'drop-pet-name': {
    description: 'GET /pets/{id} answers without the `name` field',
    expect: ['AC-F02-01'],
    applies: ({ method, pathname }) => method === 'GET' && /\/pets\/\d+$/.test(pathname),
    mutate: ({ body }) => {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const { name, ...rest } = body;
        return { body: rest };
      }
      return { body };
    },
  },

  'empty-owner-pets': {
    description: 'GET /owners/{id} answers with an empty `pets` array',
    expect: ['AC-F02-01'],
    applies: ({ method, pathname }) => method === 'GET' && /\/owners\/\d+$/.test(pathname),
    mutate: ({ body }) =>
      body && typeof body === 'object' && !Array.isArray(body) ? { body: { ...body, pets: [] } } : { body },
  },

  'stale-owner-city': {
    description: 'GET /owners/{id} keeps answering with the pre-update city',
    expect: ['AC-F01-02'],
    applies: ({ method, pathname }) => method === 'GET' && /\/owners\/\d+$/.test(pathname),
    mutate: ({ body }) =>
      body && typeof body === 'object' && !Array.isArray(body)
        ? { body: { ...body, city: 'Stale City' } }
        : { body },
  },

  'found-instead-of-missing': {
    description: 'a GET that should answer 404 answers 200 with an empty object',
    // The three ACs whose whole point is that a record is gone. If a 404 turning into a 200 does not
    // fail these, they are asserting on nothing at all.
    expect: ['AC-F01-03', 'AC-F02-07', 'AC-F03-05'],
    applies: ({ method, status }) => method === 'GET' && status === 404,
    mutate: () => ({ status: 200, body: {} }),
  },
};

/**
 * The mutation that changes nothing — the control's own control.
 *
 * The baseline runs against the API DIRECTLY, so it says nothing about the proxy. Put a broken proxy
 * in the path and every scenario fails, `expect ⊆ observed` is satisfied trivially, and every
 * mutation reports as caught.
 *
 * Not hypothetical, and it did not take a subtle fault: the first real run of this script reported
 * all four mutations caught with all twenty criteria red, because `runSuite` was synchronous and the
 * proxy shares this process — the event loop was blocked for the whole suite, so the proxy served
 * nothing and every scenario timed out in the readiness probe. This block is what found that. It
 * would have taken a live run and a careful reading of the observed sets otherwise, and the observed
 * sets are exactly what a green control invites nobody to read.
 */
export const PASSTHROUGH = {
  description: 'nothing is changed — proves the proxy itself is invisible to the suite',
  expect: [],
  applies: () => false,
  mutate: (exchange) => exchange,
};

/** One exchange transformed, or returned untouched. Pure, so the table above is unit-tested. */
export function applyMutation(mutation, exchange) {
  if (!mutation.applies(exchange)) return { status: exchange.status, body: exchange.body };
  const changed = mutation.mutate(exchange);
  return { status: changed.status ?? exchange.status, body: 'body' in changed ? changed.body : exchange.body };
}

/**
 * What `dotnet test` reported: the failure count from its summary, and the AC ids it named.
 *
 * BOTH, and that is the point. Reqnroll builds test names from scenario titles, so an id arrives as
 * `AC_F02_01`, and a change of test-name convention would silently reduce the parsed set to nothing —
 * which reads exactly like a mutation that broke nothing. Holding the summary count beside the parsed
 * ids makes that disagreement visible instead of letting it pass as a result.
 */
export function parseFailures(output) {
  const text = output ?? '';

  // `Failed!  - Failed: 5, Passed: 18, …` — the run summary, whatever the per-test format is.
  const summary = /\bFailed:\s*(\d+)/.exec(text);
  const totalMatch = /\bTotal:\s*(\d+)/.exec(text);

  const acIds = new Set();
  for (const line of text.split('\n')) {
    // A failing test is printed either as `  Failed <name>` or, on newer SDKs, as `  X <name>`.
    if (!/^\s*(Failed\s|X\s)/.test(line)) continue;
    for (const m of line.matchAll(/AC[-_]F(\d{2})[-_](\d{2})/g)) acIds.add(`AC-F${m[1]}-${m[2]}`);
  }

  return {
    failed: summary ? Number(summary[1]) : null,
    total: totalMatch ? Number(totalMatch[1]) : null,
    acIds,
  };
}

/**
 * Whether one mutation did what it was supposed to do.
 *
 * `unattributed` is a distinct outcome from a miss, for the reason `parseFailures` returns two
 * numbers: tests failed but their names could not be read, which is a fault in this script rather
 * than a verdict on the suite. Reporting it as a red control would send someone to debug the tests.
 */
export function gradeMutation(mutation, { failed, total, acIds, output }) {
  const missing = mutation.expect.filter((ac) => !acIds.has(ac));

  /*
   * The contracts this mutation is supposed to demonstrate, beyond "something went red".
   *
   * `expect` answers WHICH tests failed. Some contracts are about HOW they failed, and those cannot
   * be seen from a set of ids: that a precondition surfaces as an error while an unmet criterion
   * surfaces as a failure, that the message names the request. Both are in the same output this
   * function already receives the counts from, so proving them needs no new machinery — only the
   * question being asked.
   *
   * Missing output with a `proves` block is UNPROVEN, never satisfied. A contract that could not be
   * looked at has not been demonstrated, and the whole point of this file is to refuse that trade.
   */
  const unproven = Object.entries(mutation.proves ?? {})
    .filter(([, pattern]) => typeof output !== 'string' || !pattern.test(output))
    .map(([label]) => label);
  const unattributed = failed !== null && failed > 0 && acIds.size === 0;

  /*
   * A mutation that failed the WHOLE suite has not been caught — it has hidden something.
   *
   * Measured on the first real run, and it is the reason this clause exists. Every one of the four
   * mutations reported all twenty acceptance criteria red, identically, and the control called all
   * four "caught": `expect ⊆ observed` is satisfied trivially when `observed` is everything. The
   * cause was `runSuite` being synchronous while the proxy shares this process — the event loop was
   * blocked for the whole suite, nothing was served, and every scenario timed out in the readiness
   * probe. A broken harness scored as four successful proofs.
   *
   * The same shape hides a genuinely indiscriminate mutation: one that breaks a route every scenario
   * touches proves nothing about the scenarios that NAME the broken field, because they would fail
   * whatever they asserted. `drop-pet-name` measured 7 failures out of 23 — a proportionate radius
   * is what a real catch looks like.
   */
  const indiscriminate = failed !== null && total !== null && total > 0 && failed >= total;

  return {
    ok: missing.length === 0 && unproven.length === 0 && !unattributed && !indiscriminate,
    missing,
    unproven,
    unattributed,
    indiscriminate,
    observed: [...acIds].sort(),
    failed,
    total,
  };
}

/**
 * The proxy. Buffers each response so a body can be rewritten, and forwards everything else verbatim.
 *
 * A failure to parse or rewrite forwards the ORIGINAL bytes rather than an error: a proxy that
 * answered 500 would turn every scenario red, which is indistinguishable from a mutation that worked
 * and is the one way this control can lie in the direction of a false green.
 */
export function startProxy({ mutation, port, target }) {
  const upstream = new URL(target);

  const server = createServer((clientRequest, clientResponse) => {
    const chunks = [];
    clientRequest.on('data', (chunk) => chunks.push(chunk));
    clientRequest.on('end', () => {
      const forwarded = request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: clientRequest.url,
          method: clientRequest.method,
          headers: { ...clientRequest.headers, host: upstream.host },
        },
        (upstreamResponse) => {
          const body = [];
          upstreamResponse.on('data', (chunk) => body.push(chunk));
          upstreamResponse.on('end', () => {
            const raw = Buffer.concat(body);
            const headers = { ...upstreamResponse.headers };
            let status = upstreamResponse.statusCode;
            let out = raw;

            try {
              const isJson = /application\/json/i.test(headers['content-type'] ?? '');
              const exchange = {
                method: clientRequest.method,
                pathname: new URL(clientRequest.url, target).pathname,
                status,
                body: isJson && raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null,
              };
              const changed = applyMutation(mutation, exchange);
              if (changed.status !== status || changed.body !== exchange.body) {
                status = changed.status;
                out = Buffer.from(changed.body === null ? '' : JSON.stringify(changed.body), 'utf8');
                headers['content-type'] = 'application/json';
              }
            } catch {
              // Forward what upstream said. See the note above: an error here must not read as a
              // mutation that worked.
              out = raw;
            }

            delete headers['content-length'];
            delete headers['transfer-encoding'];
            clientResponse.writeHead(status, { ...headers, 'content-length': out.length });
            clientResponse.end(out);
          });
        }
      );

      forwarded.on('error', () => {
        clientResponse.writeHead(502, { 'content-type': 'text/plain' });
        clientResponse.end('mutation-control: upstream unreachable');
      });

      forwarded.end(Buffer.concat(chunks));
    });
  });

  /*
   * The listen phase gets its own error handler, and that is not decoration.
   *
   * An `'error'` event with no listener is a hard crash, so a busy port — a leftover
   * `control serve` from an earlier session is the ordinary way to get one — took the whole script
   * down with a raw stack, and the promise never settled. Every other failure in this repository
   * arrives as a sentence naming the fix; this one did not.
   *
   * After `listen` succeeds the handler is swapped for one that only reports. A socket error
   * mid-suite must not end a run that is otherwise fine: the suite will fail the request, and a
   * failed request is a result the control can read.
   */
  return new Promise((ready, fail) => {
    const onListenError = (error) => {
      fail(
        new Error(
          error.code === 'EADDRINUSE'
            ? `port ${port} is already in use — a leftover \`control serve\` is probably still bound. ` +
              'Stop it, or pass --port <n>.'
            : `the proxy could not listen on port ${port} — ${error.message}`
        )
      );
    };

    server.once('error', onListenError);
    server.listen(port, () => {
      server.off('error', onListenError);
      server.on('error', (error) => process.stderr.write(`control: proxy socket error — ${error.message}\n`));
      ready(server);
    });
  });
}

// ── CLI ────────────────────────────────────────────────────────────────────────────

const argAt = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

/**
 * The suite, against whichever base URL is given. ASYNCHRONOUS, and that is load-bearing.
 *
 * This was `run()`, which is `spawnSync`, and the proxy lives in THIS process. Node is
 * single-threaded: a synchronous spawn blocks the event loop for the whole run, so the proxy accepted
 * nothing while the suite was trying to talk to it. Measured — every scenario failed in
 * `ReadinessProbe.WaitUntilReady` after the full 90-second budget, 23 of 23, for every mutation
 * alike, and the control read that as four mutations caught. The same proxy driven from a separate
 * process (`serve`) answered `curl` and a filtered test perfectly, which is what made the fault look
 * like the tests rather than the harness.
 *
 * `spawn` keeps the loop turning, so the proxy serves while `dotnet test` runs.
 */
function runSuite(baseUrl) {
  return new Promise((done) => {
    const child = spawn('dotnet', ['test', SOLUTION, '--nologo'], {
      cwd: ROOT,
      env: { ...process.env, PETCLINIC_BASE_URL: baseUrl },
      shell: process.platform === 'win32',
    });

    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });

    child.on('error', (error) => done({ ok: false, out: `${out}\ncontrol: dotnet test — ${error.message}` }));
    child.on('close', (code) => done({ ok: code === 0, out }));
  });
}

if (invocation(import.meta.url, process.argv[1]) === 'broken') {
  console.error(
    brokenInvocationMessage(import.meta.url, process.argv[1], 'no mutation was applied and no suite was run.')
  );
  process.exit(2);
}

if (invocation(import.meta.url, process.argv[1]) === 'cli') {
  const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'run';
  const port = Number(argAt('--port') ?? 9977);
  const proxyUrl = `${BASE_URL.replace(/^http:\/\/[^/]+/, `http://localhost:${port}`)}`;

  if (command === 'list') {
    for (const [name, mutation] of Object.entries(MUTATIONS)) {
      console.log(`  ${name}`);
      console.log(`      ${mutation.description}`);
      console.log(`      must fail: ${mutation.expect.join(', ')}`);
    }
    process.exit(0);
  }

  const named = argAt('--mutation');
  if (named && !MUTATIONS[named]) {
    console.error(`control: unknown mutation "${named}" — ${Object.keys(MUTATIONS).join(', ')}`);
    process.exit(2);
  }

  /** A proxy, or a stop that names the fix. `startProxy` rejects on a busy port; see its note. */
  const openProxy = async (mutation) => {
    try {
      return await startProxy({ mutation, port, target: BASE_URL });
    } catch (error) {
      console.error(`control: ${error.message}`);
      process.exit(2);
    }
  };

  if (command === 'serve') {
    if (!named) {
      console.error('control: serve needs --mutation <name>');
      process.exit(2);
    }
    const server = await openProxy(MUTATIONS[named]);
    console.log(`control: serving "${named}" on ${proxyUrl} -> ${BASE_URL}`);
    console.log('control: run the suite with PETCLINIC_BASE_URL set to the address above. Ctrl-C to stop.');
    process.on('SIGINT', () => {
      server.close();
      process.exit(130);
    });
  } else if (command === 'run') {
    /**
     * The database, put back to its seed — and the exit code CHECKED, every time.
     *
     * It was checked before the baseline and ignored inside the loop. That was not what broke the
     * first real run — a blocked event loop was, see PASSTHROUGH — but it is the same shape of hole:
     * a restart that silently did not finish makes every scenario fail at the readiness probe, and
     * `expect ⊆ observed` is then satisfied by a suite that is red for a reason that has nothing to
     * do with any mutation. A step whose result is not read is a step that did not run.
     */
    const reset = (why) => {
      const result = run(process.execPath, ['scripts/sut.mjs', 'reset'], { cwd: ROOT });
      if (result.ok) return;
      console.error(result.out.split('\n').slice(-15).join('\n'));
      console.error(`control: the SUT could not be reset ${why} — nothing below it can be concluded`);
      process.exit(2);
    };

    reset('before the baseline');

    console.log('control: baseline — the unmutated suite must be green before anything is broken');
    const baseline = await runSuite(BASE_URL);
    if (!baseline.ok) {
      console.error(baseline.out.split('\n').slice(-25).join('\n'));
      console.error('control: the suite is RED before any mutation. Nothing can be concluded — fix that first.');
      process.exit(2);
    }
    const baselineCounts = parseFailures(baseline.out);
    console.log(`control: baseline green (${baselineCounts.total ?? '?'} tests)\n`);

    // The proxy's own baseline. See PASSTHROUGH: the run above went straight to the API, so it says
    // nothing about whether the suite survives being proxied at all.
    console.log('control: passthrough — the same suite, through the proxy, still green');
    reset('before the passthrough run');
    const passthroughServer = await openProxy(PASSTHROUGH);
    const passthrough = await runSuite(proxyUrl);
    passthroughServer.close();
    if (!passthrough.ok) {
      console.error(passthrough.out.split('\n').slice(-25).join('\n'));
      console.error(
        'control: the suite is RED through an unmutated proxy. The proxy is the fault, not the tests —\n' +
          'control: every mutation below would have "passed" for that reason alone.'
      );
      process.exit(2);
    }
    console.log('control: passthrough green\n');

    const selected = named ? [named] : Object.keys(MUTATIONS);
    const results = [];

    for (const name of selected) {
      const mutation = MUTATIONS[name];
      console.log(`control: ${name} — ${mutation.description}`);

      reset(`before "${name}"`);
      const server = await openProxy(mutation);
      const suite = await runSuite(proxyUrl);
      server.close();

      const grade = gradeMutation(mutation, { ...parseFailures(suite.out), output: suite.out });
      results.push({ name, ...grade });

      const scale = `${grade.failed ?? '?'}/${grade.total ?? '?'} failed`;
      if (grade.indiscriminate) {
        console.log(`  ?? the WHOLE suite went red (${scale}) — that proves nothing about ${mutation.expect.join(', ')}`);
      } else if (grade.unattributed) {
        console.log(`  ?? ${grade.failed} test(s) failed but no AC id could be read from their names`);
      } else if (grade.ok) {
        console.log(`  ok  ${mutation.expect.join(', ')} went red (${scale}; observed: ${grade.observed.join(', ')})`);
        for (const label of Object.keys(mutation.proves ?? {})) console.log(`      proved: ${label}`);
      } else if (grade.unproven.length > 0 && grade.missing.length === 0) {
        // Red in the right places and still not a proof: the contract this mutation exists to
        // demonstrate did not show up in the output.
        console.log(`  MISS the right tests went red, but not for the stated reason (${scale})`);
        for (const label of grade.unproven) console.log(`      unproven: ${label}`);
      } else {
        console.log(`  MISS ${grade.missing.join(', ')} stayed GREEN (${scale}; observed: ${grade.observed.join(', ') || 'none'})`);
      }
    }

    // Put the environment back the way it was found, whatever the verdict: the next thing anyone runs
    // is the ordinary suite, and it must not be pointed at a proxy that is no longer there.
    run(process.execPath, ['scripts/sut.mjs', 'reset'], { cwd: ROOT });

    const missed = results.filter((r) => !r.ok);
    console.log('');
    if (missed.length === 0) {
      console.log(`control: OK — every mutation was caught by the scenarios that name it (${results.length}).`);
      process.exit(0);
    }
    for (const result of missed) {
      console.error(
        `control: FAIL — ${result.name}: ${
          result.indiscriminate
            ? `the whole suite failed (${result.failed}/${result.total}), so nothing was proved about ${result.missing.length ? result.missing.join(', ') : 'anything'}`
            : result.unattributed
              ? 'failures could not be attributed to an AC'
              : `${result.missing.join(', ')} did not fail`
        }`
      );
    }
    console.error('control: a scenario that stays green while the API lies about the thing it asserts is green about nothing.');
    process.exit(1);
  } else {
    console.error(`control: unknown command "${command}" — use list, serve or run`);
    process.exit(2);
  }
}
