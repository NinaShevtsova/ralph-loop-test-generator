// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// A "gate" is the fixed list of checks the loop runs around every turn: reset the test
// database, build the project, run the whole test suite, run the automatic file checks.
//
// This file holds those lists — and nothing else. Writing them as a plain list rather than
// as code means their ORDER can be tested, and the order carries meaning: the database is
// reset BEFORE the tests, because only then does a failing test mean "this test is wrong"
// rather than "the last run left rubbish behind".
//
// There are two lists, not one. The "before" gate asks what must already be healthy before
// the AI is let in — sending a worker onto a broken foundation only makes it debug someone
// else's problem. The "after" gate asks whether this turn's own work is sound.
// ══════════════════════════════════════════════════════════════════════════════════════

// loop/gates.mjs — the gate pipelines, as data.
//
// Declaring the steps rather than hard-coding a chain of calls means the ORDER is unit-tested. The
// order is load-bearing: design D-09 puts `sut reset` before `dotnet test` in stage 1, because only
// a clean database makes a red test mean "the test is bad" rather than "the previous turn left
// rubbish". And `dotnet test` runs the WHOLE suite — that is the only thing which catches an
// iteration that changed a shared step and broke an already-accepted scenario.

import { SCAFFOLD_ROWS } from '../scripts/manifest.scaffold.mjs';

const SOLUTION = 'framework/ApiTests.sln';

/**
 * The ordered gate steps for one stage. Each step is { name, cmd, args }.
 *
 * Which identifier scopes the gate differs by stage, because the two stages' rows are different
 * things: stage 1's row IS an acceptance criterion (`acId`, which check:tests takes), stage 0's is a
 * structural task with no AC (`row`, which scopes the manifest).
 *
 * `base` is the ref check:tests fences the turn's changes against. The RUNNER supplies the real
 * value — the SHA it recorded before the turn — because a turn is not obliged to be one commit and
 * `HEAD~1` would then fence only the last of two. Measured on exactly that shape: commit 1 rewriting
 * `Support/ResourceTracker.cs` and commit 2 adding the feature file passed the fence green.
 * `HEAD~1` survives only as the standalone default, for running the gate by hand on a one-commit turn.
 */
export function gateSteps(stage, { acId, row, base = 'HEAD~1' } = {}) {
  if (stage === 'scaffold') {
    // The ROW, not its wave. Some scope is needed at all because an unscoped manifest check is red by
    // construction until the last wave, and the runner's pre-turn gate treats a red HEAD as fatal —
    // measured with wave 1 built, the unscoped check reported 37 problems.
    //
    // The scope is the row because a turn builds one row (design §6.2 — the judge grades a diff, and
    // a diff spanning several rows cannot be attributed to one of them). Four of the eight waves hold
    // more than one row, so a wave-scoped POST-turn gate is red by construction on the first row of
    // each of them: measured on the live run, S6's gate demanded S7's and S8's files and the turn had
    // no legal way to produce them.
    //
    // Validated against the manifest, not against a `S\d+` shape: an id the manifest does not know
    // would reach check-scaffold.mjs as a scope it must refuse, and the runner would report that as a
    // red gate — a verdict on the agent's work for what is a wiring fault.
    if (!SCAFFOLD_ROWS.includes(row)) {
      throw new Error(
        `gateSteps: stage "scaffold" needs the target row id, got ${JSON.stringify(row)} — ` +
          `the manifest knows ${SCAFFOLD_ROWS.join(', ')}`
      );
    }
    return [
      {
        name: 'check:scaffold',
        cmd: process.execPath,
        args: ['scripts/check-scaffold.mjs', '--through-row', row, '--quiet'],
      },
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      { name: 'sut reset', cmd: process.execPath, args: ['scripts/sut.mjs', 'reset'] },
      { name: 'dotnet test', cmd: 'dotnet', args: ['test', SOLUTION, '--nologo'] },
    ];
  }

  if (stage === 'tests') {
    if (!acId) throw new Error('gateSteps: stage "tests" needs an acId');
    return [
      { name: 'sut reset', cmd: process.execPath, args: ['scripts/sut.mjs', 'reset'] },
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      { name: 'dotnet test', cmd: 'dotnet', args: ['test', SOLUTION, '--nologo'] },
      {
        name: 'check:tests',
        cmd: process.execPath,
        args: [
          'scripts/check-tests.mjs',
          '--ac', acId,
          '--base', base,
          '--report', `loop/verdicts/${acId}.report.md`,
          '--quiet',
        ],
      },
      { name: 'steps:inventory', cmd: process.execPath, args: ['scripts/steps-inventory.mjs'] },
    ];
  }

  throw new Error(`gateSteps: unknown stage "${stage}"`);
}

/**
 * The steps that must be green on the CURRENT HEAD, before an agent is let in.
 *
 * Deliberately NOT `gateSteps`. Two differences, both load-bearing:
 *
 *   - the tests stage drops `check:tests --ac`, because the scenario it looks for is this turn's
 *     output. It also drops `steps:inventory`: the runner regenerates that itself before the turn and
 *     checks the result there.
 *   - the scaffold stage checks `--through-wave wave - 1`, not `wave`. The target wave is what this
 *     turn is about to build. Several rows share a wave (wave 5 has three), so while any row of wave
 *     N is still open, waves 1..N-1 are the complete ones.
 *
 * That last one is also why this builder stays WAVE-scoped while `gateSteps` moved to the row. The
 * pre-turn question is "what is already finished", and at that moment the finished thing is a set of
 * whole waves: the rows of the target's own wave are in no defined state — a sibling may be `done`,
 * `todo`, or half-built by a turn that ended red. `--through-row <the row before the target>` would
 * demand a sibling that the loop has not reached, which is the same fault in the other direction.
 */
export function preGateSteps(stage, { wave } = {}) {
  if (stage === 'scaffold') {
    if (!Number.isInteger(wave) || wave < 1) {
      throw new Error(`preGateSteps: stage "scaffold" needs the target row's wave, got ${wave}`);
    }
    return [
      // Nothing to check before wave 1 — it is the wave that creates the solution.
      ...(wave > 1
        ? [
            {
              name: 'check:scaffold (through the previous wave)',
              cmd: process.execPath,
              args: ['scripts/check-scaffold.mjs', '--through-wave', String(wave - 1), '--quiet'],
            },
          ]
        : []),
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      { name: 'sut reset', cmd: process.execPath, args: ['scripts/sut.mjs', 'reset'] },
      { name: 'dotnet test', cmd: 'dotnet', args: ['test', SOLUTION, '--nologo'] },
    ];
  }

  if (stage === 'tests') {
    return [
      { name: 'sut reset', cmd: process.execPath, args: ['scripts/sut.mjs', 'reset'] },
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      { name: 'dotnet test', cmd: 'dotnet', args: ['test', SOLUTION, '--nologo'] },
    ];
  }

  throw new Error(`preGateSteps: unknown stage "${stage}"`);
}

/**
 * Runs the pipeline and returns { green, failedAt, log }. Stops at the first red step: running
 * `dotnet test` after a failed build only produces a second, less informative error.
 */
export function runGate(steps, { root, run }) {
  const log = [];
  for (const step of steps) {
    const result = run(step.cmd, step.args, { cwd: root });
    log.push(`--- ${step.name} ${result.ok ? 'OK' : 'FAIL'}\n${result.out}`);
    if (!result.ok) return { green: false, failedAt: step.name, log: log.join('\n') };
  }
  return { green: true, failedAt: null, log: log.join('\n') };
}
