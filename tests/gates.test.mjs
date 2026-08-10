// tests/gates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gateSteps, preGateSteps } from '../loop/gates.mjs';

test('the scaffold gate runs the manifest check, then build, then reset and test', () => {
  const steps = gateSteps('scaffold', { acId: 'S1', row: 'S1' });
  assert.deepEqual(
    steps.map((step) => step.name),
    ['check:scaffold', 'dotnet build', 'sut reset', 'dotnet test']
  );
});

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
    'sut reset',
    'dotnet test',
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
  assert.deepEqual(steps.map((step) => step.name), ['dotnet build', 'sut reset', 'dotnet test']);
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
