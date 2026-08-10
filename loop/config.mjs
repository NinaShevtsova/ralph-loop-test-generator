// loop/config.mjs — the stage table and argument parsing. Pure, so the stops are proven by tests
// rather than by a paid run.

// Re-exported, not redeclared. The flow groups and the paths derived from them live in
// scripts/flows.mjs so that the gate CLIs and the runner read one definition; these three are
// re-exported here because the runner and the prompt builder have always imported them from this
// module, and a third copy of a formula is how the last one drifted.
export { FLOW_GROUPS, flowDocPath, featurePath, dataPath } from '../scripts/flows.mjs';

export const STAGES = {
  scaffold: {
    tracker: 'loop/trackers/scaffold.md',
    prompt: 'loop/PROMPT.scaffold.md',
    rubric: 'loop/rubrics/scaffold.md',
    // NOT 8. The runner spends one iteration per tracker ROW, not per wave: a wave whose tasks are all
    // set to `review` closes its target row in the same iteration and then needs one judge-only
    // iteration for each remaining row. Measured against the real 14-row tracker: 14 iterations
    // minimum, 8 with an agent turn and 6 judge-only, and 22 with one rework per wave.
    maxIter: 24,
    kFailures: 3,
    noImprovement: 3,
  },
  tests: {
    tracker: 'loop/trackers/tests.md',
    prompt: 'loop/PROMPT.tests.md',
    rubric: 'loop/rubrics/tests.md',
    // 20 ACs plus room for rework. A ceiling, NOT a budget: a healthy run ends itself at ~24
    // because every row becomes `done`. Lowering it saves nothing and kills legitimate reworks.
    maxIter: 30,
    kFailures: 3,
    // The reference uses 2, but here a rework after REJECT is a NORMAL turn, not a fault.
    // A hard AC is entitled to two reworks before the loop calls it a plateau.
    noImprovement: 3,
  },
};

// D-17: the agent's per-iteration job is narrow and mechanical, so Sonnet is the default; the judge
// needs real judgement and is called once per iteration on a small input, so Opus.
// `--permission-mode plan` is what makes the judge structurally read-only.
const DEFAULT_AGENT_CMD = 'claude -p --model sonnet --permission-mode auto';
const DEFAULT_JUDGE_CMD = 'claude -p --model opus --permission-mode plan --output-format text';

/** Reads the runner's flags. Never throws — validation is the runner's job, with better messages. */
export function parseArgs(argv) {
  const valueOf = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1] ?? null;
  };

  return {
    stage: valueOf('--stage'),
    flow: valueOf('--flow'),
    dryRun: argv.includes('--dry-run'),
    allowDirty: argv.includes('--allow-dirty'),
  };
}

/**
 * A stop defined by garbage is a stop that does not exist: `MAX_ITER=abc` yields NaN, and
 * `i >= NaN` is always false — the loop's only real ceiling vanishes silently and it spins for
 * real money. So every override is validated, and a bad one throws before the first token.
 */
function stop(name, raw, fallback) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (text === '') return fallback;

  // A plain decimal integer and nothing else. `Number()` alone was too generous in two measured ways:
  // it turned a whitespace-only value into 0, silently replacing the ceiling with "do nothing" — the
  // exact vanishing this guard exists to prevent — and it accepted `0x10` as 16 and `1e2` as 100,
  // which are truthful integers and surprising ceilings.
  //
  // `0` stays valid on purpose. The iteration ceiling is checked before the agent is called, so
  // MAX_ITER=0 must mean "spend nothing" rather than be rejected as nonsense.
  if (!/^\d+$/.test(text)) {
    throw new Error(`${name}=${raw} — must be a plain non-negative decimal integer`);
  }
  return Number(text);
}

/**
 * A command override, or the fallback when there is nothing usable.
 *
 * `??` alone let an EMPTY string through, and `spawn('')` throws `ERR_INVALID_ARG_VALUE` out of the
 * promise executor — measured for both wrappers — so `AGENT_CMD=` reached the runner as an unhandled
 * rejection and exit 1, after the iteration counter, the journal header, the recorded base and the
 * step inventory had all already run. An empty value is not an instruction; it is what a shell
 * leaves behind when `AGENT_CMD=$SOMETHING_UNSET` expands, and `stop()` above already reads an empty
 * override as "use the fallback". Trimmed, so a whitespace-only value cannot become a `bin` of `''`.
 */
const command = (raw, fallback) => {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  return text === '' ? fallback : text;
};

/** The resolved configuration for one stage, env overrides applied. */
export function stageConfig(stage, env = process.env) {
  const base = STAGES[stage];
  if (!base) {
    throw new Error(`unknown stage: ${stage} — use one of ${Object.keys(STAGES).join(', ')}`);
  }

  return {
    stage,
    ...base,
    maxIter: stop('MAX_ITER', env.MAX_ITER, base.maxIter),
    kFailures: stop('K_FAILURES', env.K_FAILURES, base.kFailures),
    noImprovement: stop('NO_IMPROVEMENT', env.NO_IMPROVEMENT, base.noImprovement),
    agentCmd: command(env.AGENT_CMD, DEFAULT_AGENT_CMD),
    judgeCmd: command(env.JUDGE_CMD, DEFAULT_JUDGE_CMD),
  };
}
