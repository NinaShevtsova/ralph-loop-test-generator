// loop/gates.mjs — the gate pipelines, as data.
//
// Declaring the steps rather than hard-coding a chain of calls means the ORDER is unit-tested. The
// order is load-bearing: design D-09 puts `sut reset` before `dotnet test` in stage 1, because only
// a clean database makes a red test mean "the test is bad" rather than "the previous turn left
// rubbish". And `dotnet test` runs the WHOLE suite — that is the only thing which catches an
// iteration that changed a shared step and broke an already-accepted scenario.

const SOLUTION = 'framework/ApiTests.sln';

/**
 * The ordered gate steps for one stage. Each step is { name, cmd, args }.
 *
 * `base` is the ref check:tests fences the turn's changes against. The RUNNER supplies the real
 * value — the SHA it recorded before the turn — because a turn is not obliged to be one commit and
 * `HEAD~1` would then fence only the last of two. Measured on exactly that shape: commit 1 rewriting
 * `Support/ResourceTracker.cs` and commit 2 adding the feature file passed the fence green.
 * `HEAD~1` survives only as the standalone default, for running the gate by hand on a one-commit turn.
 */
export function gateSteps(stage, { acId, wave, base = 'HEAD~1' } = {}) {
  if (stage === 'scaffold') {
    // The wave matters: stage 0 builds in eight of them, so an unscoped manifest check is red by
    // construction until the last one, and the runner's pre-turn gate treats a red HEAD as fatal.
    // Measured with wave 1 built, the unscoped check reported 37 problems — stage 0 would have died at
    // iteration 2 with the prompt telling the agent that state was expected.
    if (!Number.isInteger(wave) || wave < 1) {
      throw new Error(`gateSteps: stage "scaffold" needs the target row's wave, got ${wave}`);
    }
    return [
      {
        name: 'check:scaffold',
        cmd: process.execPath,
        args: ['scripts/check-scaffold.mjs', '--through-wave', String(wave), '--quiet'],
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
