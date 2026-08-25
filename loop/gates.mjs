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

import {
  SCAFFOLD_ROWS,
  SMOKE_SUITE_ENTRY,
  rowNeeds,
} from '../scripts/manifest.scaffold.mjs';

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
    /*
     * Only the steps that can say something about THIS row.
     *
     * Tests enter the suite in the last row of the stage, so before it `dotnet test` reports zero
     * tests -- which the stage-0 prompt itself calls a pass -- and `sut reset` restarts Docker and
     * waits for readiness to make that possible. Measured: ~25 of ~27 stage-0 gate runs did exactly
     * that, at ~27 s of Docker restart and ~12 s of test host each.
     *
     * The boundary comes from the MANIFEST (`rowNeeds`), not from a wave number. A wave number would
     * be a magic constant here and in the manifest both, and this file stays pure data with no
     * filesystem access -- which is what makes the step ORDER unit-testable.
     */
    const needsSuite = rowNeeds(row, SMOKE_SUITE_ENTRY);
    if (needsSuite === null) {
      throw new Error(
        `gateSteps: the manifest cannot place row ${JSON.stringify(row)} against the smoke suite — ` +
          'SMOKE_SUITE_ENTRY has drifted from the manifest'
      );
    }

    return [
      {
        name: 'check:scaffold',
        cmd: process.execPath,
        args: ['scripts/check-scaffold.mjs', '--through-row', row, '--quiet'],
      },
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      // Scoped like check:scaffold, and for the same reason: unscoped it is red by construction until
      // the last row, because I3 needs the services to exist and I6 needs the 22 steps.
      {
        name: 'check:invariants',
        cmd: process.execPath,
        args: ['scripts/check-invariants.mjs', '--through-row', row, '--quiet'],
      },
      /*
       * No filtered unit run here, and that is a MEASURED correction rather than an omission.
       *
       * Reqnroll generates an assembly-level `[SetUpFixture]` (`obj/.../NUnit.AssemblyHooks.*.cs`)
       * whose `[OneTimeSetUp]` calls `TestRunnerManager.OnTestRunStartAsync`, which fires
       * `ScenarioHooks`'s `[BeforeTestRun]` -> `ReadinessProbe.WaitUntilReady()` on a 90 s budget.
       * NUnit runs that fixture for ANY test run in the assembly, so `--filter TestCategory=Unit`
       * waits for the SUT as well. Measured with Docker stopped: 96 s and RED.
       *
       * Worse, no gate below S14 has a `sut reset` step to bring the container up, so on a
       * from-scratch run every such gate would be red and `K_FAILURES=3` would end the run at S6.
       *
       * Task 11 turns the fix into a stage-0 requirement — readiness moves to `[BeforeScenario]`,
       * memoised, so a run with no scenarios never touches the network. Once a rebuilt framework
       * satisfies that, this step can come back, and `UNIT_TEST_ENTRY` in the manifest is the
       * boundary it will use. It is not imported here until then: an import used only by a comment
       * reads as a check that is being made.
       */
      // D-09: the reset before the run, so a red test means the test is bad rather than the database
      // being dirty.
      ...(needsSuite
        ? [
            { name: 'sut reset', cmd: process.execPath, args: ['scripts/sut.mjs', 'reset'] },
            { name: 'dotnet test', cmd: 'dotnet', args: ['test', SOLUTION, '--nologo'] },
          ]
        : []),
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
      /*
       * No `sut reset` and no `dotnet test`, and that is not a shortcut.
       *
       * A pre-gate asks what is already complete, which is the waves BEFORE the target's own. The only
       * row that brings executable tests into the suite is the LAST row of the stage, so a scaffold
       * pre-gate can never have a test to run — tests/manifest.test.mjs pins that fact so this comment
       * cannot quietly stop being true. What remains is the question the pre-gate exists for: are the
       * finished waves' files there, and does the tree still compile.
       */
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

/**
 * Whether the pre-gate can be skipped because the last green gate already proved this exact tree.
 *
 * A green POST-gate for row N checked the manifest through row N and compiled the tree. The pre-gate
 * for row N+1 asks for the manifest through the wave BEFORE N+1's own — strictly earlier rows — and
 * compiles the same tree. On an unmoved HEAD with nothing uncommitted under `framework/`, that is a
 * subset of what has just been proven, so running it again costs a build and answers nothing new.
 *
 * Pure, and it answers `false` for everything it is not certain about. Every input this cannot vouch
 * for — a fresh process with nothing remembered, an empty string from a failed `git` probe, a dirty
 * tree — RUNS the gate. A pre-gate skipped when it was needed sends the agent onto a red foundation,
 * which is the one thing the pre-gate exists to prevent.
 */
export function skipPreGate({ lastGreenSha, headSha, dirty } = {}) {
  if (dirty) return false;
  if (typeof lastGreenSha !== 'string' || lastGreenSha === '') return false;
  if (typeof headSha !== 'string' || headSha === '') return false;
  return lastGreenSha === headSha;
}
