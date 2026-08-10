// tests/sut.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { invocation } from '../scripts/lib.mjs';
import { aboveSeed, pollUntilReady, restartVerdict, SEED_COUNTS } from '../scripts/sut.mjs';

/** Starts a stub that returns `codes.shift()` per request, defaulting to the last code. */
function stub(codes, { headers = {}, body = '[]' } = {}) {
  const remaining = [...codes];
  const server = createServer((_req, res) => {
    const code = remaining.length > 1 ? remaining.shift() : remaining[0];
    res.writeHead(code, { 'content-type': 'application/json', ...headers });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    });
  });
}

test('pollUntilReady reports ready once the endpoint answers 200', async () => {
  const s = await stub([200]);
  const result = await pollUntilReady(s.url, { timeoutMs: 3000, intervalMs: 50 });
  s.close();
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.lastError, '');
});

test('pollUntilReady keeps polling through 5xx and succeeds when it flips to 200', async () => {
  const s = await stub([503, 503, 200]);
  const result = await pollUntilReady(s.url, { timeoutMs: 3000, intervalMs: 20 });
  s.close();
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 3, 'it must have taken all three responses to get there');
});

test('pollUntilReady does NOT accept 404 as ready', async () => {
  // The one deliberate decision in this module, so it gets a test. An earlier version treated 404
  // as ready, reasoning that an empty collection answers 404. That is wrong here: the H2 seed
  // reloads on every start with 6 pet types, so after a reset /pettypes must answer 200 — a 404
  // means "up but unseeded", which is a dirty state the gate has to catch. Without this test,
  // deleting the rule leaves the suite green and the regression only shows up as a 90 s timeout.
  const s = await stub([404], { body: '' });
  // 1000 ms, not 150, and the reason is worth keeping because the obvious diagnosis was wrong.
  //
  // At 150 ms this test failed roughly 1 run in 5, reporting "The operation was aborted due to
  // timeout" instead of "HTTP 404". That is not the 404 rule breaking; it is the budget being too
  // small for a request to answer in. The real culprit was in `poll`, whose pre-attempt guard only
  // caught a remainder of `<= 0` and so still issued a final attempt clamped to a few milliseconds —
  // fixed there with MIN_ATTEMPT_MS. This budget is the second half: a 150 ms total is also the FIRST
  // request's abort timeout, and one scheduling stall is enough to lose it.
  //
  // Nothing is weakened. The stub answers 404 for every request, so a longer budget means MORE
  // rejected attempts, and both assertions below are unchanged.
  const result = await pollUntilReady(s.url, { timeoutMs: 1000, intervalMs: 20 });
  s.close();
  assert.equal(result.ready, false);
  assert.equal(result.lastError, 'HTTP 404');
});

test('pollUntilReady does not follow a redirect to something that is not PetClinic', async () => {
  // Measured with redirect following on: a 302 to an unrelated login page read as "ready".
  const s = await stub([302], { headers: { location: 'http://example.invalid/login' }, body: '' });
  // 1000 ms for the same reason as the 404 test above: the budget doubles as the first request's
  // abort timeout, and an aborted first attempt replaces `HTTP 302` with an abort message.
  const result = await pollUntilReady(s.url, { timeoutMs: 1000, intervalMs: 20 });
  s.close();
  assert.equal(result.ready, false);
  assert.equal(result.lastError, 'HTTP 302');
});

test('pollUntilReady gives up within its budget rather than merely returning eventually', async () => {
  // Asserting only the return value cannot detect an inflated wait: measured, multiplying the
  // deadline by 50 kept every test passing and just made the suite take 10 s instead of 200 ms.
  const s = await stub([503]);
  const started = Date.now();
  const result = await pollUntilReady(s.url, { timeoutMs: 200, intervalMs: 20 });
  const elapsed = Date.now() - started;
  s.close();
  assert.equal(result.ready, false);
  assert.ok(elapsed < 2000, `expected to give up near the 200 ms budget, took ${elapsed} ms`);
});

test('pollUntilReady reports the reason for an unreachable host instead of swallowing it', async () => {
  // 1000 ms: this test asserts `lastError` does NOT mention an abort, so it carries exactly the same
  // first-attempt exposure as the two above — a stall past the budget would make it fail on the very
  // string it is checking for.
  const result = await pollUntilReady('http://127.0.0.1:1/', { timeoutMs: 1000, intervalMs: 20 });
  assert.equal(result.ready, false);
  assert.ok(result.attempts >= 1);
  assert.ok(result.lastError.length > 0, 'the failure reason must survive to the caller');
  // Asserting only `length > 0` was not enough: it passed even while a final 1 ms-clamped attempt
  // overwrote every real reason with its own abort message. This is the assertion that pins it.
  assert.ok(
    !/abort/i.test(result.lastError),
    `the abort of a clamped final attempt must not mask the real reason, got: ${result.lastError}`
  );
});

test('pollUntilReady throws on a non-finite timeout instead of looping forever', () => {
  // Number('90_000') is NaN, and `Date.now() >= NaN` is always false. Measured with the old code:
  // 121 attempts in 2 seconds and no return — the gate hung with no output at all. `90_000` is the
  // spelling used in sut.mjs's own source, so it is an easy thing to paste into an env var.
  assert.throws(() => pollUntilReady('http://127.0.0.1:1/', { timeoutMs: Number('90_000') }), /finite/);
  assert.throws(() => pollUntilReady('http://127.0.0.1:1/', { timeoutMs: 100, intervalMs: 0 }), /positive/);
});

test('READY_URL appends the probe path exactly once, whatever the base URL ends with', async () => {
  const { READY_URL, BASE_URL } = await import('../scripts/sut.mjs');
  assert.equal(READY_URL, `${BASE_URL.replace(/\/+$/, '')}/pettypes`);
  assert.equal(READY_URL.match(/pettypes/g).length, 1);
  assert.ok(!READY_URL.includes('//pettypes'));
});

// ── the reset actually happened (review item C8) ──────────────────────────────
//
// `reset` used to prove only that `/pettypes` answers `200` — which an application that was never
// restarted answers just as well. `runGate` grades this step on its exit code alone, so a reset that
// did nothing went green, and D-09's promise that a red test means "the test is bad" rather than
// "the database is dirty" quietly stopped holding. Two independent proofs replace it: the
// container's own start time, and the seed the restarted application serves.

test('this module stays inert when imported, which is what makes this whole file possible', () => {
  // The top of this file imports scripts/sut.mjs. If the guard answered `cli` here, the switch would
  // run docker commands and `process.exit` inside the test runner. argv[1] under `node --test` is
  // this test file — measured — so the guard sees a name that is not its own and says nothing.
  assert.equal(invocation(new URL('../scripts/sut.mjs', import.meta.url).href, process.argv[1]), 'import');
});

test('restartVerdict: a start time that moved is the proof that the container restarted', () => {
  // Measured across `docker restart petclinic`: 2026-08-09T17:51:55.794465458Z became
  // 2026-08-09T17:56:13.340830095Z. The timestamps below are those two.
  assert.equal(
    restartVerdict('2026-08-09T17:51:55.794465458Z', '2026-08-09T17:56:13.340830095Z'),
    'moved'
  );
});

test('restartVerdict: the same start time on both sides is a container that never restarted', () => {
  // The whole defect in one value. Without this the readiness probe answers 200 from the same
  // long-running application and the gate goes green over a database full of the last run's records.
  assert.equal(
    restartVerdict('2026-08-09T17:51:55.794465458Z', '2026-08-09T17:51:55.794465458Z'),
    'unmoved'
  );
});

test('restartVerdict: an unreadable start time is never treated as proof', () => {
  // `docker inspect` failing is the state in which we know least, and it must not be the state that
  // passes. A missing AFTER is unreadable; so is a missing BEFORE on a container that already
  // existed, because there is then no baseline the after can be compared against.
  assert.equal(restartVerdict('2026-08-09T17:51:55.794465458Z', ''), 'unreadable');
  assert.equal(restartVerdict('', ''), 'unreadable');
  assert.equal(restartVerdict('', '2026-08-09T17:56:13.340830095Z'), 'unreadable');
});

test('restartVerdict: a container that had to be created is the one legitimate missing baseline', () => {
  // Nothing existed to read a start time from, and a container that has just been created cannot be
  // carrying a previous run's data. This is the only route by which an empty `before` passes.
  assert.equal(restartVerdict('', '2026-08-09T17:56:13.340830095Z', { created: true }), 'moved');
  assert.equal(restartVerdict('', '', { created: true }), 'unreadable');
});

test('SEED_COUNTS is the seed measured on a freshly reset container', () => {
  // Measured 2026-08-09 against a container that had just been restarted: 6 / 10 / 13 / 4. §10.1 of
  // the conventions quotes two of them ("10 owners and 13 pets") as the reason literal ids prove
  // nothing, so a drift here is a drift from the specification the tests are generated against.
  assert.deepEqual(SEED_COUNTS, { pettypes: 6, owners: 10, pets: 13, visits: 4 });
});

test('aboveSeed reports a collection holding more than the seed, and names both numbers', () => {
  // Measured live: POST /owners on a freshly reset container took /owners from 10 to 11, and this is
  // the shape of every leftover-record condition.
  const over = aboveSeed({ pettypes: 6, owners: 11, pets: 13, visits: 4 });
  assert.equal(over.length, 1);
  assert.match(over[0], /owners/);
  assert.match(over[0], /11/);
  assert.match(over[0], /10/, 'the seed it exceeded must be in the message, or it cannot be judged');
});

test('aboveSeed says nothing about a clean database', () => {
  assert.deepEqual(aboveSeed({ pettypes: 6, owners: 10, pets: 13, visits: 4 }), []);
});

test('aboveSeed ignores the below-seed direction, which cannot be leftover data', () => {
  // A count BELOW the seed is either a different image or a collection read while the seed was still
  // loading. Neither is the dirty state D-09 cares about, and failing the gate on it would stop the
  // loop for something that is not a defect. Only the harmful direction is a refusal.
  assert.deepEqual(aboveSeed({ pettypes: 5, owners: 0, pets: 1, visits: 0 }), []);
});

test('aboveSeed ignores a collection it could not count, rather than inventing a verdict', () => {
  // An endpoint that answered 404, or answered something that is not a JSON array, leaves no number.
  // Treating a missing count as 0 would silently pass; treating it as a failure would make an
  // unrelated endpoint outage look like a dirty database. It is reported separately, not here.
  assert.deepEqual(aboveSeed({ owners: 11 }, { owners: 10, visits: 4 }), ['owners: 11, seed 10']);
  assert.deepEqual(aboveSeed({}, SEED_COUNTS), []);
  assert.deepEqual(aboveSeed({ owners: 'many' }, SEED_COUNTS), []);
  assert.deepEqual(aboveSeed(null, SEED_COUNTS), []);
});
