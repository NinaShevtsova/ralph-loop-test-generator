// tests/gates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gateSteps, preGateSteps, skipPreGate } from '../loop/gates.mjs';

test('the tests gate resets the SUT first and runs the whole suite', () => {
  const steps = gateSteps('tests', { acId: 'AC-F02-01' });
  assert.deepEqual(
    steps.map((step) => step.name),
    ['sut reset', 'dotnet build', 'dotnet test', 'check:tests', 'steps:inventory']
  );
});

test('the tests gate passes the target AC to check:tests', () => {
  const steps = gateSteps('tests', { acId: 'AC-F02-01' });
  const check = steps.find((step) => step.name === 'check:tests');
  assert.ok(check.args.includes('--ac'));
  assert.ok(check.args.includes('AC-F02-01'));
});

test('the tests gate asks check:tests to write the judge report', () => {
  const steps = gateSteps('tests', { acId: 'AC-F02-01' });
  const check = steps.find((step) => step.name === 'check:tests');
  const index = check.args.indexOf('--report');
  assert.ok(index !== -1, 'must pass --report');
  assert.match(check.args[index + 1], /AC-F02-01.*report\.md$/);
});

test('the tests gate hands check:tests a base to fence the turn against', () => {
  // Without a base check:tests falls back to `HEAD`, which for the runner — calling it AFTER the turn
  // has committed, against a clean tree — means "nothing changed". The base is what makes the fence
  // see the turn at all.
  const steps = gateSteps('tests', { acId: 'AC-F02-01', base: '9a3f21c' });
  const check = steps.find((step) => step.name === 'check:tests');
  const index = check.args.indexOf('--base');
  assert.ok(index !== -1, 'must pass --base');
  assert.equal(check.args[index + 1], '9a3f21c');
});

test('the tests gate defaults its base to HEAD~1, never to nothing', () => {
  // The runner supplies the SHA it recorded before the turn, because a turn is not obliged to be one
  // commit: measured, `HEAD~1..HEAD` on a two-commit turn showed only the second commit and a
  // framework rewrite made in the first passed the fence green. `HEAD~1` survives only as the
  // standalone default for running the gate by hand on a one-commit turn.
  const check = gateSteps('tests', { acId: 'AC-F02-01' }).find((step) => step.name === 'check:tests');
  assert.equal(check.args[check.args.indexOf('--base') + 1], 'HEAD~1');
});

test('every gate step names a command and an argument array', () => {
  for (const stage of ['scaffold', 'tests']) {
    for (const step of gateSteps(stage, { acId: 'X', row: 'S1' })) {
      assert.equal(typeof step.name, 'string');
      assert.equal(typeof step.cmd, 'string');
      assert.ok(Array.isArray(step.args), `${step.name}: args must be an array`);
    }
  }
});

test('gateSteps rejects an unknown stage', () => {
  assert.throws(() => gateSteps('nope', { acId: 'X', row: 'S1' }), /unknown stage/);
});

test('gateSteps scopes the scaffold manifest check to the target ROW, not its wave', () => {
  // Some scope is needed at all because the unscoped check covers all 39 entries and is red until
  // the last wave, which the pre-turn gate reads as a fatal red HEAD.
  //
  // The scope is the row because a turn builds one row and the judge grades that turn's diff. Four
  // of the eight waves hold more than one row, so a wave-scoped POST-turn gate is red by
  // construction on every row of those waves but the last: measured on the live run, S6's gate
  // demanded `Support/ResourceTracker.cs` (S7) and `Support/ReadinessProbe.cs` (S8), and one row
  // per turn means the S6 turn had no legal way to produce them.
  const check = gateSteps('scaffold', { acId: 'S6', row: 'S6' }).find((step) => step.name === 'check:scaffold');
  assert.ok(check.args.includes('--through-row'));
  assert.equal(check.args[check.args.indexOf('--through-row') + 1], 'S6');
  assert.ok(
    !check.args.includes('--through-wave'),
    'the post-turn gate must not also pass a wave — check:scaffold refuses both scopes at once'
  );
});

test('gateSteps refuses a scaffold gate with no row, or a row the manifest does not know', () => {
  // Refused here rather than left to check-scaffold.mjs: an unknown scope reaching the gate comes
  // back as a red step, and the runner reports a red gate as a verdict on the agent's work.
  for (const row of [undefined, null, '', 'S99', 's6', 5]) {
    assert.throws(
      () => gateSteps('scaffold', { acId: 'S1', row }),
      /needs the target row id/,
      `row ${JSON.stringify(row)} must be refused`
    );
  }
  assert.throws(() => gateSteps('scaffold', { acId: 'S1' }), /needs the target row id/);
});

test('gateSteps names the rows it knows when it refuses one, so the message is actionable', () => {
  assert.throws(() => gateSteps('scaffold', { row: 'S99' }), /S1, S2, .*S14/);
});

test('the tests gate requires an acId', () => {
  assert.throws(() => gateSteps('tests', {}), /acId/);
});

// ── preGateSteps ──────────────────────────────────────────────────────────────────────
//
// The pre-turn gate asks whether the FOUNDATION is sound; the post-turn gate asks whether the work
// is correct. Handing the post-turn list to the pre-turn caller asks for output that does not exist
// yet: measured, `check-tests.mjs --ac AC-F01-02` on a tree without that scenario exits 1, so stage 1
// died at iteration 1 every time. These tests are the fence around that.

test('the tests pre-gate never asks for the scenario this turn has not written yet', () => {
  const names = preGateSteps('tests').map((step) => step.name);
  assert.deepEqual(names, ['sut reset', 'dotnet build', 'dotnet test']);
  assert.ok(
    !names.some((name) => name.startsWith('check:tests')),
    'check:tests looks for the target AC, which is this turn\u2019s output — it cannot be a precondition'
  );
  assert.ok(
    !names.includes('steps:inventory'),
    'the runner regenerates the inventory itself before the turn and checks it there'
  );
});

test('the tests pre-gate needs no acId, unlike the post-turn gate', () => {
  // gateSteps throws without one. The pre-gate must not, or the runner would have to invent an AC to
  // ask a question that is not about any AC.
  assert.throws(() => gateSteps('tests'), /needs an acId/);
  assert.doesNotThrow(() => preGateSteps('tests'));
  assert.doesNotThrow(() => preGateSteps('tests', {}));
});

test('the scaffold pre-gate checks through the PREVIOUS wave, not the target one', () => {
  const steps = preGateSteps('scaffold', { wave: 5 });
  assert.deepEqual(steps.map((step) => step.name), [
    'check:scaffold (through the previous wave)',
    'dotnet build',
  ]);
  // wave - 1. Several rows share a wave, so while any row of wave 5 is open, 1..4 are the complete
  // ones. Asking through 5 would demand the files this turn is about to create.
  assert.deepEqual(steps[0].args, [
    'scripts/check-scaffold.mjs',
    '--through-wave',
    '4',
    '--quiet',
  ]);
});

test('the two gates scope the same wave differently, and that is the point', () => {
  // S6, S7 and S8 all sit in wave 5 and are three separate turns. Before any of them the finished
  // tree is waves 1..4 — the pre-turn gate cannot ask for more, because a sibling of the target may
  // be untouched, half-built or already done and there is no way to tell which. After the turn the
  // finished tree is exactly the rows up to the target, which is more than waves 1..4 and less than
  // wave 5. One scope cannot express both.
  const before = preGateSteps('scaffold', { wave: 5 })[0].args;
  const after = gateSteps('scaffold', { acId: 'S7', row: 'S7' })[0].args;

  assert.deepEqual(before.slice(1, 3), ['--through-wave', '4']);
  assert.deepEqual(after.slice(1, 3), ['--through-row', 'S7']);
});

test('the scaffold pre-gate has no manifest check at all before wave 1', () => {
  const steps = preGateSteps('scaffold', { wave: 1 });
  assert.deepEqual(steps.map((step) => step.name), ['dotnet build']);
  assert.ok(
    !steps.some((step) => step.args?.includes('--through-wave')),
    'wave 1 creates the solution — there is no earlier wave to check, and `--through-wave 0` would be a lie'
  );
});

test('preGateSteps refuses a scaffold pre-gate with no usable wave', () => {
  // `Number.isInteger`, so the string a regex capture yields is rejected too: it would pass a bare
  // truthiness test and then reach check-scaffold as `--through-wave NaN`.
  for (const wave of [undefined, null, 0, -1, '3', 2.5, Number.NaN]) {
    assert.throws(
      () => preGateSteps('scaffold', { wave }),
      /preGateSteps: stage "scaffold" needs the target row's wave/,
      `wave ${String(wave)} must be refused`
    );
  }
  assert.throws(() => preGateSteps('scaffold'), /needs the target row's wave/);
});

test('preGateSteps rejects an unknown stage', () => {
  assert.throws(() => preGateSteps('nope'), /preGateSteps: unknown stage "nope"/);
});

test('every pre-gate step names a command and an argument array', () => {
  for (const steps of [preGateSteps('tests'), preGateSteps('scaffold', { wave: 3 })]) {
    assert.ok(steps.length > 0);
    for (const step of steps) {
      assert.equal(typeof step.name, 'string');
      assert.equal(typeof step.cmd, 'string');
      assert.ok(Array.isArray(step.args), `${step.name} must carry an argument array`);
    }
  }
});

// ── The scaffold gate runs only the steps that can say something (design 2026-08-20 §7.1) ──

test('a scaffold row before the smoke suite gets no SUT reset and no test run', () => {
  // Tests appear only in the last row of the stage. Before it, `dotnet test` reports zero tests --
  // the stage-0 prompt calls that a pass -- and `sut reset` restarts Docker to make that possible.
  const steps = gateSteps('scaffold', { row: 'S6' }).map((step) => step.name);
  assert.deepEqual(steps, ['check:scaffold', 'dotnet build', 'check:invariants']);
});

test('the row that builds the smoke suite gets the SUT reset and the whole suite, in that order', () => {
  // D-09: the reset comes BEFORE the run, so a red test means "the test is bad" and not "the database
  // is dirty". The order is the reason these steps are declared as data.
  const steps = gateSteps('scaffold', { row: 'S14' }).map((step) => step.name);
  assert.deepEqual(steps, ['check:scaffold', 'dotnet build', 'check:invariants', 'sut reset', 'dotnet test']);
});

test('the first scaffold row runs neither unit tests nor the suite — neither exists yet', () => {
  const steps = gateSteps('scaffold', { row: 'S1' }).map((step) => step.name);
  assert.deepEqual(steps, ['check:scaffold', 'dotnet build', 'check:invariants']);
});

test('no scaffold gate runs any test before the suite has one — MEASURED, not assumed', () => {
  // Reqnroll generates an assembly-level [SetUpFixture] whose [OneTimeSetUp] calls
  // TestRunnerManager.OnTestRunStartAsync, which fires ScenarioHooks's [BeforeTestRun] ->
  // ReadinessProbe.WaitUntilReady() with a 90 s budget. NUnit runs that fixture for ANY test run in
  // the assembly, so `dotnet test --filter TestCategory=Unit` waits for the SUT too. Measured with
  // Docker stopped: 96 s and RED, for a step meant to replace a ~50 s one.
  //
  // That is why no gate below S14 runs `dotnet test` in any form: before S14 there is no SUT step to
  // bring the container up, so every such gate would be red and three in a row end the run.
  for (const row of ['S1', 'S4', 'S6', 'S13']) {
    const steps = gateSteps('scaffold', { row }).map((step) => step.name);
    assert.ok(!steps.some((name) => name.startsWith('dotnet test')), `${row}: ${steps.join(', ')}`);
  }
});

test('check:invariants is scoped to the target row', () => {
  // Unscoped it is red by construction until the last row: I3 needs the services, I6 needs the steps.
  const check = gateSteps('scaffold', { row: 'S6' }).find((s) => s.name === 'check:invariants');
  const index = check.args.indexOf('--through-row');
  assert.ok(index !== -1, 'must pass --through-row');
  assert.equal(check.args[index + 1], 'S6');
});

test('the scaffold pre-gate never resets the SUT or runs the suite', () => {
  // A pre-gate asks about strictly EARLIER waves, and the only row that brings tests is the final
  // one -- so a scaffold pre-gate can never have a test to run. tests/manifest.test.mjs pins that.
  for (const wave of [1, 4, 7, 8]) {
    const steps = preGateSteps('scaffold', { wave }).map((step) => step.name);
    assert.ok(!steps.includes('sut reset'), `wave ${wave}: ${steps.join(', ')}`);
    assert.ok(!steps.includes('dotnet test'), `wave ${wave}: ${steps.join(', ')}`);
  }
});

test('the tests-stage pre-gate is untouched — it still resets before running', () => {
  assert.deepEqual(
    preGateSteps('tests', {}).map((step) => step.name),
    ['sut reset', 'dotnet build', 'dotnet test']
  );
});

// ── Skipping a pre-gate that would re-prove what the last one proved (D-23, D-24) ──────
//
// Pure, so the decision is tested rather than inferred from a paid run. Every "no" below is a gate
// that RUNS: this predicate may only ever answer yes when it is certain, because a pre-gate skipped
// when it was needed sends the agent onto a red foundation to debug someone else's problem.

test('the pre-gate is skipped only when the last green gate was this exact HEAD and nothing is dirty', () => {
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: 'abc123', dirty: false }), true);
});

test('a moved HEAD runs the gate', () => {
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: 'def456', dirty: false }), false);
});

test('a dirty tree runs the gate, even on a matching HEAD', () => {
  // Uncommitted work in framework/ is exactly what the gate would compile, and it is not what the
  // last green gate saw.
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: 'abc123', dirty: true }), false);
});

test('a fresh process runs the gate — there is no last green gate to lean on', () => {
  assert.equal(skipPreGate({ lastGreenSha: null, headSha: 'abc123', dirty: false }), false);
});

test('an unreadable or empty value on either side runs the gate', () => {
  // `git()` returns '' for a failure as well as for an empty result, so '' must never satisfy this.
  assert.equal(skipPreGate({ lastGreenSha: '', headSha: '', dirty: false }), false);
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: '', dirty: false }), false);
  assert.equal(skipPreGate({ lastGreenSha: '', headSha: 'abc123', dirty: false }), false);
  assert.equal(skipPreGate({ lastGreenSha: undefined, headSha: 'abc123', dirty: false }), false);
});
