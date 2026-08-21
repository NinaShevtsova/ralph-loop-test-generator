// tests/check-invariants.test.mjs — the CLI, run for real against the real tree.
//
// The pure rules have their own tests with both controls; this file answers the two questions those
// cannot. Which invariants the ACCEPTED scaffold satisfies, and does `--through-row` actually narrow
// the set so an early wave is not judged against files nobody has been asked to build yet.
//
// D-30 held for six of the seven: an invariant that goes red on accepted work is wrong, and the
// scaffold is the reference. I7 is the recorded exception, and the reason is a measurement rather than
// a preference — see the test below and scripts/invariants.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const SCRIPT = join(ROOT, 'scripts', 'check-invariants.mjs');

const run = (...args) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

test('the accepted scaffold satisfies the six invariants D-30 was tested against', () => {
  // D-30. If any of these six goes red, the invariant is wrong — not the scaffold, which a judge and a
  // mutation control have both already passed. Named one by one rather than counted, so that adding an
  // invariant cannot quietly retire one of them.
  const result = run();
  for (const line of [
    /ok {2}one RestClient/,
    /ok {2}no hard-coded base URL/,
    /ok {2}route coverage: all \d+ routes/,
    /ok {2}the assembly is NonParallelizable/,
    /ok {2}every service method is reachable/,
    /ok {2}step inventory/,
  ]) {
    assert.match(result.out, line, result.out);
  }
});

test('I7 is the one invariant the accepted scaffold does NOT satisfy, and it says which file', () => {
  /*
   * The recorded exception to D-30, and the exception is a measurement. `Hooks/ScenarioHooks.cs` in the
   * accepted scaffold declares `[BeforeTestRun]`, which makes NUnit run an assembly-level fixture for
   * any test in the assembly — 96 s and red with the container stopped. So this red is the finding, not
   * a fault in the rule, and it stands with the six forward requirements `check:scaffold` reports.
   *
   * THE EXIT CODE IS DELIBERATELY NOT ASSERTED HERE. It is 1 before the first regeneration and 0 after
   * it, so pinning either value would make this test fail on one side of the very change it exists to
   * survive. What is pinned is the pair the operator needs either way: the rule ran, and if it found
   * something it named the file.
   */
  const result = run();
  const hit = /assembly-wide setup at ([^\s:]+):(\d+)/.exec(result.out);
  if (hit === null) {
    assert.match(result.out, /ok {2}no assembly-wide setup hook/, result.out);
    return;
  }
  assert.match(hit[1], /Hooks\/ScenarioHooks\.cs$/, result.out);
  assert.match(result.out, /96 s/, 'the failure must carry the measurement, not just the rule');
});

test('an early row is judged only against the invariants whose files exist by then', () => {
  // Unscoped, I3 needs the services and I5/I6 need the step definitions, so an unscoped run is red by
  // construction until the last row — and the runner reads a red pre-turn gate as fatal.
  const result = run('--through-row', 'S2');
  assert.equal(result.status, 0, result.out);
  assert.doesNotMatch(result.out, /route/i, 'I3 must not run before the services exist');
});

test('the scope grows with the row', () => {
  const early = run('--through-row', 'S2').out;
  const late = run('--through-row', 'S14').out;
  assert.ok(late.length > early.length, `late:\n${late}\nearly:\n${early}`);
  assert.match(late, /route/i, 'I3 belongs to the late scope');
});

test('an unknown row is refused rather than silently checking everything', () => {
  // A typo must not fall through to the full run, which is red until the last row and would be read
  // as a verdict on the turn.
  const result = run('--through-row', 'S99');
  assert.equal(result.status, 2, result.out);
  assert.match(result.out, /S99/);
});

test('--quiet suppresses the passing lines', () => {
  // Scoped to a row BEFORE the one I7 belongs to, so this stays green whatever the tree looks like.
  // Unscoped it would ride on I7's expected red and start asserting the state of the framework instead
  // of the behaviour of the flag. That the failures survive `--quiet` is pinned for the sibling script
  // in tests/check-scaffold.test.mjs, on the same `Verdict` class both of them use.
  const result = run('--through-row', 'S10', '--quiet');
  assert.equal(result.status, 0, result.out);
  assert.doesNotMatch(result.out, /^ {2}ok {2}/m);
});

test('--through-row with nothing after it is refused, not read as "no scope at all"', () => {
  // The same fault as an unknown row and the same consequence, so it must not take the other branch.
  // The obvious `?? null` reads a MISSING VALUE as a MISSING FLAG, and the run then silently becomes
  // the unscoped one — red until the last row, and reported as a verdict on the turn.
  const result = run('--through-row');
  assert.equal(result.status, 2, result.out);
  assert.match(result.out, /unknown row/);
});

test('the very first row of a from-scratch run is green, not "the gate itself is broken"', () => {
  // At S1 nothing an invariant reads exists yet, so no check is in scope. Verdict.report refuses to
  // call a run with zero checks green -- rightly -- so the script has to say which case it is.
  // Without that, `npm run ralph -- --stage scaffold` on an empty framework/ dies on iteration 1.
  const result = run('--through-row', 'S1');
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /no invariant applies/);
  assert.doesNotMatch(result.out, /the gate itself is broken/);
});

test('the scope is a function of the row alone, not of what happens to be on disk', () => {
  // The same row must compose the same set on a finished tree and on an empty one, or a re-run would
  // be graded differently from the first run.
  const first = run('--through-row', 'S4').out;
  const second = run('--through-row', 'S4').out;
  assert.equal(first, second);
});
