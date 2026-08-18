// loop/telemetry.mjs — what a run cost and what it decided, as data.
//
// The harness was built so it would not be WRONG. Nothing in it was built so a change to a prompt or
// a rubric could be shown to have made it BETTER: the judge's reply was parsed for one word and the
// rest — how many tokens it read, what it cost, how long the turn took, what it actually objected to
// — went nowhere. `loop/verdicts/<id>.md` is overwritten by the next attempt at the same row, so the
// rejection that a fixture would be built from is gone by the time anyone wants it.
//
// Everything here is pure, for the same reason `tracker.mjs` is: a number that steers a decision must
// not be able to drift because of a sloppy parser, and a run costs real money to reproduce.
//
// Three things are recorded, and they are NOT the same thing:
//
//   1. the judge's usage — available only when JUDGE_CMD reports it (`claude --output-format json`);
//   2. wall-clock per phase — always available, because the runner holds the clock itself;
//   3. the decision — verdict, gate result, and the first line of what was objected to.
//
// The AGENT's usage is deliberately absent, and that is a limitation rather than an oversight. Its
// stdio is inherited so a human can watch the turn, which is worth more than the number would be;
// capturing usage would mean `--output-format json` on the agent too, and then nobody sees anything
// until the turn is over. Duration and iteration count are what stand in for it.

/** Column order of the per-iteration table. Named once so the header and the rows cannot drift. */
const COLUMNS = ['iter', 'row', 'phase', 'outcome', 'judge', 'in', 'out', 'cost', 'sec', 'note'];

/**
 * The judge's stdout, split into the text the runner must parse and the usage it may record.
 *
 * `claude -p --output-format json` answers with an envelope — the verdict is `result`, and `usage`,
 * `total_cost_usd` and `duration_ms` sit beside it. `parseVerdict` reads the FIRST LINE of what it is
 * given, so handing it the envelope would read `{` and resolve to REJECT: every verdict, forever.
 *
 * The fallback is the whole point of the function. `JUDGE_CMD` is documented as pluggable and two of
 * the tools named in this repository do not speak this envelope, so anything that is not a recognised
 * envelope is returned UNCHANGED as text, with `usage: null`. Not `usage: {}` and not zeroes: a zero
 * cost is a claim about a run, and "nobody reported it" must not render as "it was free".
 *
 * The transformation is one-directional and cannot invent a verdict — it only ever unwraps a field
 * that is already a string. A malformed envelope falls back to the raw text, which `parseVerdict`
 * then reads as REJECT, which is the safe direction the whole design leans in.
 */
export function parseJudgeReply(stdout) {
  const raw = stdout ?? '';
  const envelope = lastEnvelope(raw);
  if (!envelope) return { text: raw, usage: null };

  return { text: envelope.result, usage: usageOf(envelope) };
}

/**
 * The last well-formed result envelope in the output, or `null`.
 *
 * The LAST one, because `--output-format stream-json` emits one JSON object per line and only the
 * final one carries the result; the whole-string parse below covers plain `--output-format json`,
 * which is a single object. Both are accepted so a change of output format does not silently turn
 * every verdict into a REJECT.
 *
 * A `result` that is not a string disqualifies the envelope. `claude` sets `result` to an error
 * OBJECT on some failures, and `String(anObject)` would hand `parseVerdict` the text
 * `[object Object]` — a first line that is not a verdict, read as REJECT, indistinguishable from a
 * judge that genuinely rejected the work.
 */
function lastEnvelope(raw) {
  const candidates = [raw, ...raw.split('\n').reverse()];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') return parsed;
    } catch {
      /* not this line */
    }
  }
  return null;
}

/**
 * The usage numbers of one envelope, or `null` when it carries none.
 *
 * Cache reads are kept separate from fresh input because they differ in price by an order of
 * magnitude, and the single most actionable fact about this loop's cost is how often the cache is
 * cold. Summing them into one "input" number would hide exactly that.
 */
function usageOf(envelope) {
  const usage = envelope.usage ?? {};
  const numbers = {
    inputTokens: int(usage.input_tokens),
    outputTokens: int(usage.output_tokens),
    cacheReadTokens: int(usage.cache_read_input_tokens),
    cacheWriteTokens: int(usage.cache_creation_input_tokens),
    costUsd: number(envelope.total_cost_usd),
    durationMs: int(envelope.duration_ms),
  };

  // An envelope with no numbers at all is `null`, not a row of zeroes — see `parseJudgeReply`.
  return Object.values(numbers).some((value) => value !== null) ? numbers : null;
}

const int = (value) => (Number.isInteger(value) ? value : null);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Adds two usage records. `null` is absorbed, so a run mixing tools still totals what it knows. */
export function addUsage(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;

  const sum = (a, b) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  return {
    inputTokens: sum(left.inputTokens, right.inputTokens),
    outputTokens: sum(left.outputTokens, right.outputTokens),
    cacheReadTokens: sum(left.cacheReadTokens, right.cacheReadTokens),
    cacheWriteTokens: sum(left.cacheWriteTokens, right.cacheWriteTokens),
    costUsd: sum(left.costUsd, right.costUsd),
    durationMs: sum(left.durationMs, right.durationMs),
  };
}

/**
 * One line of free text reduced to something that cannot break a markdown table.
 *
 * A judge's finding contains pipes, newlines and backticks as a matter of course, and one of them in
 * a cell turns the run summary into a file that renders as garbage and parses as nothing. The full
 * text is never in this file anyway — it is in `loop/verdicts/`, which the summary names.
 */
export function cell(text, limit = 90) {
  const flat = (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
  const safe = flat.replace(/\|/g, '\\|').replace(/`/g, "'");
  return safe.length > limit ? `${safe.slice(0, limit - 1)}…` : safe;
}

/** The summary's header, written once when the first iteration is recorded. */
export function summaryHeader({ startedAt, stage, flow, branch, agentCmd, judgeCmd, stops }) {
  return [
    `# Run ${startedAt} — stage \`${stage}\`${flow ? `, slice \`${flow}\`` : ''}`,
    '',
    `- branch: \`${branch}\``,
    `- agent: \`${agentCmd}\``,
    `- judge: \`${judgeCmd}\``,
    `- stops: MAX_ITER=${stops.maxIter} · K_FAILURES=${stops.kFailures} · NO_IMPROVEMENT=${stops.noImprovement}`,
    '',
    `| ${COLUMNS.join(' | ')} |`,
    `|${COLUMNS.map(() => '---').join('|')}|`,
    '',
  ].join('\n');
}

/**
 * One iteration, as a table row.
 *
 * `outcome` is the runner's own word for how the turn ended — `refused`, `gate red`, or the verdict —
 * and it is deliberately not the same column as `judge`. A turn the runner refused never reached the
 * judge at all, and a summary that showed an empty verdict cell for it would read as a judge that
 * answered nothing rather than one that was never called.
 */
export function summaryRow({
  iteration,
  row,
  phase,
  outcome,
  verdict = '',
  usage = null,
  seconds = null,
  note = '',
}) {
  const values = [
    String(iteration),
    row,
    phase,
    outcome,
    verdict || '—',
    usage === null ? '—' : tokens(usage),
    usage?.outputTokens ?? '—',
    usage?.costUsd === null || usage === null ? '—' : `$${usage.costUsd.toFixed(4)}`,
    seconds === null ? '—' : seconds.toFixed(0),
    cell(note),
  ];
  return `| ${values.join(' | ')} |`;
}

/**
 * `10895 (+98k cached)` — everything billed as fresh input, then what came from the cache.
 *
 * `inputTokens` ALONE was the number here, and against a real judge call it is a lie by omission.
 * Measured on `claude -p --model claude-opus-5 --output-format json`: `input_tokens: 2`,
 * `cache_read_input_tokens: 0`, `cache_creation_input_tokens: 10893` — Claude Code writes almost the
 * whole prompt into the cache, so the column that is supposed to say how much the judge read printed
 * `2` for a 56,000-character input. A cache WRITE is fresh input that also gets stored; it is billed
 * above the input rate, not below it, so it belongs on this side of the parenthesis and not inside it.
 */
const tokens = (usage) => {
  const fresh =
    usage.inputTokens === null && usage.cacheWriteTokens === null
      ? null
      : (usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const head = fresh === null ? '—' : String(fresh);
  if (!usage.cacheReadTokens) return head;
  return `${head} (+${Math.round(usage.cacheReadTokens / 1000)}k cached)`;
};

/**
 * Every usage number spelled out, each named for what it is billed as.
 *
 * All four, and never a subset. The three input numbers are priced differently — a cache write above
 * the input rate, a cache read roughly a tenth of it — so collapsing them loses the single most
 * actionable fact about this loop's cost, which is how often the cache is cold. Measured against the
 * real judge: a 56,000-character prompt reported 2 input tokens and 10,893 cache-write tokens, so a
 * line quoting only `input` would have described that call as almost free.
 */
export function usageLine(usage) {
  const n = (value) => (value === null || value === undefined ? '—' : value);
  return (
    `${n(usage.inputTokens)} in · ${n(usage.cacheWriteTokens)} cache-write · ` +
    `${n(usage.cacheReadTokens)} cache-read · ${n(usage.outputTokens)} out` +
    `${usage.costUsd === null || usage.costUsd === undefined ? '' : ` · $${usage.costUsd.toFixed(4)}`}`
  );
}

/**
 * The block appended when a run ends. Totals are written HERE and nowhere else, so a run killed with
 * Ctrl-C keeps every row it earned and simply has no totals — an honest missing number rather than a
 * total that counts half a run.
 */
export function summaryTotals({ iterations, rows, usage, wallSeconds, reason, counts }) {
  const outcomes = new Map();
  for (const outcome of rows) outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);

  return [
    '',
    `**Ended:** ${reason}`,
    '',
    `- iterations: ${iterations}`,
    ...(counts
      ? [
          `- rows at the end: ${counts.done} done · ${counts.review} review · ${counts.rework} rework · ` +
            `${counts.blocked} blocked · ${counts.todo} todo`,
        ]
      : []),
    `- outcomes: ${[...outcomes].map(([name, n]) => `${n} ${name}`).join(' · ') || 'none'}`,
    `- judge usage: ${usage ? usageLine(usage) : 'not reported by this JUDGE_CMD'}`,
    `- wall clock: ${Math.round(wallSeconds)} s`,
    '',
    '> The agent\'s token usage is not captured: its stdio is inherited so the run can be watched.',
    '> Iterations and wall clock stand in for it.',
    '',
  ].join('\n');
}

/**
 * The file one run writes to. One file per run rather than one appended log, because the point of the
 * artefact is to be diffed against another run — and two runs in one file cannot be.
 *
 * The timestamp is passed in rather than taken here so the name is a pure function of its inputs and
 * a test does not have to freeze the clock.
 */
export function summaryPath(startedAt, stage, flow) {
  const stamp = startedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `loop/runs/${stamp}-${stage}${flow ? `-${flow}` : ''}.md`;
}
