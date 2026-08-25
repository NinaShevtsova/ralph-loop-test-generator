// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// All the loop's settings in one place, so nothing important is buried in the code.
//
// It says which AI command runs as the worker and which as the grader, and it holds the
// three limits that guarantee the loop cannot run forever: the most turns it may take, how
// many failed turns in a row end it, and how many turns without progress count as stuck.
//
// You can override any of these from the command line or with environment variables. A
// nonsense value — a limit that is not a plain number, an empty command — is refused here,
// before a single token is paid for. A limit that quietly becomes "no limit" is the exact
// accident this file exists to prevent.
// ══════════════════════════════════════════════════════════════════════════════════════

// loop/config.mjs — the stage table and argument parsing. Pure, so the stops are proven by tests
// rather than by a paid run.

// Re-exported, not redeclared. The flow groups and the paths derived from them live in
// scripts/flows.mjs so that the gate CLIs and the runner read one definition; these three are
// re-exported here because the runner and the prompt builder have always imported them from this
// module, and a third copy of a formula is how the last one drifted.
export { FLOW_GROUPS, flowDocPath, featurePath, dataPath } from '../scripts/flows.mjs';

// The two tracker paths come from there too, because `scripts/checks.mjs` exempts exactly these
// files from the stage-1 diff fence. Spelled out here as well, the fence and the runner could
// disagree about which file the runner writes — and the fence would then refuse it.
import { SCAFFOLD_TRACKER, TESTS_TRACKER } from '../scripts/flows.mjs';

export const STAGES = {
  scaffold: {
    tracker: SCAFFOLD_TRACKER,
    prompt: 'loop/PROMPT.scaffold.md',
    rubric: 'loop/rubrics/scaffold.md',
    // NOT 8, and no longer 14-with-6-judge-only either. That arithmetic assumed a turn could deliver
    // its whole wave, leaving the other rows to be graded without an agent turn. Batching is now
    // refused — a diff spanning several rows cannot be attributed to one of them, and a real run
    // deadlocked a row the judge could not reach — so every row costs one agent turn AND one judge
    // call. 14 rows, 14 iterations minimum, and this ceiling leaves room for ten reworks across them.
    //
    // That is roughly 75% more agent turns than the batched shape cost. It buys the property the
    // whole arrangement rests on: the judge is shown exactly the work of the row it is grading.
    maxIter: 24,
    kFailures: 3,
    noImprovement: 3,
  },
  tests: {
    tracker: TESTS_TRACKER,
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
//
// The model IDS, not the aliases `sonnet` and `opus`. An alias floats: the same command a month later
// is a different generator AND a different grader, both changed at once and neither announced. Every
// number in `loop/runs/` is then a measurement of an unknown, and the whole reason those files are
// committed — comparing this run against the last one — quietly stops holding. An operator who wants
// the newest model overrides AGENT_CMD / JUDGE_CMD, which is a decision with a date on it rather than
// a drift. Pinned on 2026-08-18, the day the telemetry that depends on them was added.
//
// `--output-format json`, not `text`, and that is what makes the judge's cost recordable at all: the
// envelope carries `usage` and `total_cost_usd` beside the verdict. `loop/telemetry.mjs` unwraps it
// and falls back to raw text for any JUDGE_CMD that does not speak it, so the two pluggable tools
// this repository documents keep working unchanged.
// `--output-format stream-json --verbose` is what makes the agent's cost recordable. The stream emits
// one JSON object per line AS THE TURN RUNS, so the runner relays the text to the console and takes
// `usage` and `total_cost_usd` from the final object — the trade that used to be "watch it or price it"
// is no longer a trade. `--verbose` is required by the CLI for this format under `--print`.
const DEFAULT_AGENT_CMD =
  'claude -p --model claude-sonnet-5 --permission-mode auto --output-format stream-json --verbose';
const DEFAULT_JUDGE_CMD =
  'claude -p --model claude-opus-5 --permission-mode plan --output-format json';

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
