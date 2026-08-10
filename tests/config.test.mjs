// tests/config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGES,
  parseArgs,
  stageConfig,
  FLOW_GROUPS,
  flowDocPath,
  featurePath,
} from '../loop/config.mjs';
import * as flows from '../scripts/flows.mjs';

test('both stages are declared', () => {
  assert.deepEqual(Object.keys(STAGES), ['scaffold', 'tests']);
});

test('stage scaffold carries its own tracker, prompt, rubric and stops', () => {
  const s = STAGES.scaffold;
  assert.equal(s.tracker, 'loop/trackers/scaffold.md');
  assert.equal(s.prompt, 'loop/PROMPT.scaffold.md');
  assert.equal(s.rubric, 'loop/rubrics/scaffold.md');
  assert.equal(s.maxIter, 24);
  assert.equal(s.kFailures, 3);
  assert.equal(s.noImprovement, 3);
});

test('stage tests carries its own tracker, prompt, rubric and stops', () => {
  const s = STAGES.tests;
  assert.equal(s.tracker, 'loop/trackers/tests.md');
  assert.equal(s.prompt, 'loop/PROMPT.tests.md');
  assert.equal(s.rubric, 'loop/rubrics/tests.md');
  assert.equal(s.maxIter, 30);
  assert.equal(s.kFailures, 3);
  assert.equal(s.noImprovement, 3);
});

test('parseArgs reads the stage', () => {
  assert.equal(parseArgs(['--stage', 'tests']).stage, 'tests');
});

test('parseArgs defaults the stage to null so the runner can refuse to guess', () => {
  assert.equal(parseArgs([]).stage, null);
});

test('parseArgs reads the flow slice and the flags', () => {
  const args = parseArgs(['--stage', 'tests', '--flow', 'F-02', '--dry-run', '--allow-dirty']);
  assert.equal(args.flow, 'F-02');
  assert.equal(args.dryRun, true);
  assert.equal(args.allowDirty, true);
});

test('parseArgs leaves flags false when absent', () => {
  const args = parseArgs(['--stage', 'scaffold']);
  assert.equal(args.dryRun, false);
  assert.equal(args.allowDirty, false);
  assert.equal(args.flow, null);
});

test('stageConfig applies env overrides for the stops', () => {
  const config = stageConfig('tests', { MAX_ITER: '5', K_FAILURES: '1', NO_IMPROVEMENT: '2' });
  assert.equal(config.maxIter, 5);
  assert.equal(config.kFailures, 1);
  assert.equal(config.noImprovement, 2);
});

test('stageConfig falls back to the stage defaults when env is empty', () => {
  const config = stageConfig('scaffold', {});
  assert.equal(config.maxIter, 24);
});

test('stageConfig rejects a non-integer stop rather than silently disabling it', () => {
  assert.throws(() => stageConfig('tests', { MAX_ITER: 'abc' }), /MAX_ITER/);
  assert.throws(() => stageConfig('tests', { K_FAILURES: '-1' }), /K_FAILURES/);
  assert.throws(() => stageConfig('tests', { NO_IMPROVEMENT: '1.5' }), /NO_IMPROVEMENT/);
});

test('stageConfig treats a whitespace-only override as unset rather than as zero', () => {
  // Number(' ') is 0, so a whitespace value used to become a ceiling of zero — a stop defined by
  // garbage silently vanishing, which is the one thing this guard exists to stop.
  assert.equal(stageConfig('tests', { MAX_ITER: ' ' }).maxIter, 30);
  assert.equal(stageConfig('tests', { K_FAILURES: '	' }).kFailures, 3);
});

test('stageConfig rejects an integer written in a non-decimal form', () => {
  // Measured: Number() accepted both, so 0x10 became a ceiling of 16 and 1e2 became 100.
  assert.throws(() => stageConfig('tests', { MAX_ITER: '0x10' }), /decimal/);
  assert.throws(() => stageConfig('tests', { MAX_ITER: '1e2' }), /decimal/);
});

test('stageConfig accepts zero, which means spend nothing', () => {
  // Deliberately valid: the ceiling is checked before the agent is called, so MAX_ITER=0 must leave no
  // token behind rather than be rejected.
  assert.equal(stageConfig('tests', { MAX_ITER: '0' }).maxIter, 0);
});

test('stageConfig rejects an unknown stage', () => {
  assert.throws(() => stageConfig('framework', {}), /unknown stage/);
});

test('stageConfig carries the default agent and judge commands', () => {
  const config = stageConfig('tests', {});
  assert.match(config.agentCmd, /--model sonnet/);
  assert.match(config.judgeCmd, /--model opus/);
  assert.match(config.judgeCmd, /--permission-mode plan/);
});

test('stageConfig lets env override both commands', () => {
  const config = stageConfig('tests', { AGENT_CMD: 'codex exec', JUDGE_CMD: 'copilot -p' });
  assert.equal(config.agentCmd, 'codex exec');
  assert.equal(config.judgeCmd, 'copilot -p');
});

test('stageConfig reads an empty command override as absent, not as a command', () => {
  // C5. `??` let an EMPTY string through, and `spawn('')` throws `ERR_INVALID_ARG_VALUE` out of the
  // promise executor — measured for both wrappers — so `AGENT_CMD=` arrived as an unhandled rejection
  // and exit 1, after the iteration counter, the journal header, the recorded base and the step
  // inventory had all already run. An empty value is what a shell leaves behind when an unset variable
  // expands; `stop()` in the same file has always read one as "use the fallback".
  for (const blank of ['', '   ', '\t\n']) {
    const config = stageConfig('tests', { AGENT_CMD: blank, JUDGE_CMD: blank });
    assert.match(config.agentCmd, /--model sonnet/, `AGENT_CMD=${JSON.stringify(blank)} must fall back`);
    assert.match(config.judgeCmd, /--model opus/, `JUDGE_CMD=${JSON.stringify(blank)} must fall back`);
  }
});

test('stageConfig trims a command override rather than passing whitespace to spawn', () => {
  const config = stageConfig('tests', { AGENT_CMD: '  codex exec  ' });
  assert.equal(config.agentCmd, 'codex exec');
});

test('FLOW_GROUPS maps every flow group to its slug', () => {
  assert.deepEqual(FLOW_GROUPS, {
    'F-01': 'F01-owner-lifecycle',
    'F-02': 'F02-owner-pet-lifecycle',
    'F-03': 'F03-pet-visit-flow',
  });
});

// Re-exported from scripts/flows.mjs, not redeclared here — asserted on identity, because an
// innocent-looking `export function flowDocPath` added back into config.mjs would satisfy any test
// that only compared strings, and that is exactly how the previous three copies accumulated.
// tests/flows.test.mjs owns the behaviour; this owns the fact that there is one of it.
test('the flow group table and its paths are re-exported, not a second copy', () => {
  assert.equal(FLOW_GROUPS, flows.FLOW_GROUPS);
  assert.equal(flowDocPath, flows.flowDocPath);
  assert.equal(featurePath, flows.featurePath);
});
