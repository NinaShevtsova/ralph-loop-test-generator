// tests/sut.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { pollUntilReady } from '../scripts/sut.mjs';

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
