// tests/telemetry.test.mjs — the run summary and the judge envelope.
//
// The envelope parser is the load-bearing half. It sits between `runJudge` and `parseVerdict`, and a
// bug in it does not produce a wrong number — it produces a wrong VERDICT, because the verdict is a
// field of the JSON object rather than the first line of the output. So most of what is below asks
// one question in different ways: can this function turn a PASS into something else, or a REJECT into
// a PASS.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseJudgeReply,
  addUsage,
  cell,
  summaryHeader,
  summaryRow,
  summaryTotals,
  summaryPath,
  usageLine,
} from '../loop/telemetry.mjs';
import { parseVerdict, isWellFormed } from '../loop/verdict.mjs';

const envelope = (result, extra = {}) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 41234,
    result,
    total_cost_usd: 0.2317,
    usage: {
      input_tokens: 12045,
      output_tokens: 380,
      cache_read_input_tokens: 98000,
      cache_creation_input_tokens: 1200,
    },
    ...extra,
  });

test('a JSON envelope yields the verdict text, not the envelope', () => {
  const { text } = parseJudgeReply(envelope('VERDICT: PASS\n'));
  assert.equal(parseVerdict(text), 'PASS');
  assert.ok(isWellFormed(text), 'the unwrapped text must still satisfy the strict first-line rule');
});

test('without unwrapping, the runner would read every verdict as REJECT', () => {
  // The regression this whole module exists to prevent. `{` is not a verdict line, and the strict
  // parser is right to say so — which is why the unwrapping has to happen before it, not inside it.
  const raw = envelope('VERDICT: PASS\n');
  assert.equal(parseVerdict(raw), 'REJECT');
  assert.equal(parseVerdict(parseJudgeReply(raw).text), 'PASS');
});

test('usage and cost come back as numbers, cache reads kept separate from fresh input', () => {
  const { usage } = parseJudgeReply(envelope('VERDICT: PASS\n'));
  assert.deepEqual(usage, {
    inputTokens: 12045,
    outputTokens: 380,
    cacheReadTokens: 98000,
    cacheWriteTokens: 1200,
    costUsd: 0.2317,
    durationMs: 41234,
  });
});

test('plain text output is returned unchanged, with no usage', () => {
  // JUDGE_CMD is documented as pluggable, and two of the tools this repository names do not speak the
  // envelope. Their output must reach `parseVerdict` byte for byte.
  const text = 'VERDICT: REJECT\n\n- [item 6] weak assertion\n';
  assert.deepEqual(parseJudgeReply(text), { text, usage: null });
});

test('usage is null rather than zeroes when nothing reported it', () => {
  // A zero cost is a claim about a run. "Nobody reported it" must not render as "it was free".
  const { usage } = parseJudgeReply(JSON.stringify({ result: 'VERDICT: PASS' }));
  assert.equal(usage, null);
});

test('a malformed envelope falls back to the raw text, which parses as REJECT', () => {
  // The safe direction: an unreadable reply closes the gate. It must never open it.
  for (const broken of ['{"result": ', '{"result": {"error": "boom"}}', '{}', '[]', 'null']) {
    const { text } = parseJudgeReply(broken);
    assert.equal(text, broken, `must pass through unchanged: ${broken}`);
    assert.equal(parseVerdict(text), 'REJECT');
  }
});

test('a non-string result is refused rather than stringified', () => {
  // `String({error: …})` is `[object Object]` — a first line that is not a verdict, read as REJECT,
  // and indistinguishable from a judge that genuinely rejected the work.
  const { text } = parseJudgeReply(JSON.stringify({ result: { error: 'rate limited' } }));
  assert.ok(!text.includes('[object Object]'));
});

test('stream-json takes the LAST result line, not the first object it sees', () => {
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }),
    JSON.stringify({ type: 'assistant', message: { content: 'thinking' } }),
    envelope('VERDICT: REJECT\n\n- [item 2] the birthDate claim has no assertion\n'),
  ].join('\n');

  const { text, usage } = parseJudgeReply(stream);
  assert.equal(parseVerdict(text), 'REJECT');
  assert.equal(usage.outputTokens, 380);
});

test('an empty reply stays empty, so the runner still stops on a silent judge', () => {
  // `ralph.mjs` treats an empty judge reply as a configuration fault and stops. Returning anything
  // else here — a `{}`, a placeholder — would hide that.
  assert.deepEqual(parseJudgeReply(''), { text: '', usage: null });
  assert.deepEqual(parseJudgeReply(null), { text: '', usage: null });
});

test('addUsage absorbs nulls, so a run that mixes tools still totals what it knows', () => {
  const one = parseJudgeReply(envelope('VERDICT: PASS')).usage;
  assert.equal(addUsage(null, null), null);
  assert.deepEqual(addUsage(null, one), one);
  assert.deepEqual(addUsage(one, null), one);
  assert.equal(addUsage(one, one).outputTokens, 760);
  assert.equal(addUsage(one, one).costUsd.toFixed(4), '0.4634');
});

test('a finding with a pipe cannot break the table it is written into', () => {
  const text = 'AC: "a | b". Test: `HaveCountGreaterThan(0)`.\nsecond line';
  const value = cell(text);
  assert.ok(!value.includes('\n'), 'a cell is one line');
  assert.ok(!/(?<!\\)\|/.test(value), 'every pipe is escaped');
  assert.ok(!value.includes('`'), 'backticks are replaced, they would fence the cell');
});

test('a long finding is truncated rather than allowed to widen the table', () => {
  assert.equal(cell('x'.repeat(500)).length, 90);
});

test('the header and every row have the same number of columns', () => {
  const header = summaryHeader({
    startedAt: '2026-08-18T10:00:00.000Z',
    stage: 'tests',
    flow: 'F-02',
    branch: 'feat/api-tests',
    agentCmd: 'claude -p',
    judgeCmd: 'claude -p --output-format json',
    stops: { maxIter: 30, kFailures: 3, noImprovement: 3 },
  });

  const columns = (line) => line.split('|').length;
  const headerLine = header.split('\n').find((line) => line.startsWith('| iter'));

  const row = summaryRow({
    iteration: 4,
    row: 'AC-F02-01',
    phase: 'agent',
    outcome: 'judged',
    verdict: 'PASS',
    usage: parseJudgeReply(envelope('VERDICT: PASS')).usage,
    seconds: 612.4,
  });

  assert.equal(columns(row), columns(headerLine));
  assert.equal(columns(summaryRow({ iteration: 1, row: 'S1', phase: 'agent', outcome: 'gate red' })), columns(headerLine));
});

test('a row with no usage prints em dashes, never zeroes', () => {
  const row = summaryRow({ iteration: 1, row: 'S1', phase: 'agent', outcome: 'gate red' });
  assert.ok(!/\| 0 \|/.test(row), `a missing number must not read as zero: ${row}`);
  assert.ok(row.includes('—'));
});

test('the input column counts cache WRITES as fresh input, not as cache', () => {
  // Measured against the real judge on 2026-08-19: a 56,000-character prompt came back as
  // `input_tokens: 2`, `cache_read_input_tokens: 0`, `cache_creation_input_tokens: 10893`. Claude
  // Code writes almost the whole prompt into the cache, so a column quoting `input_tokens` alone
  // described that call as 2 tokens. A cache write is billed ABOVE the input rate, so it belongs with
  // the fresh half.
  const measured = {
    inputTokens: 2,
    outputTokens: 2135,
    cacheReadTokens: 0,
    cacheWriteTokens: 10893,
    costUsd: 0.6641,
    durationMs: 54000,
  };
  const row = summaryRow({ iteration: 1, row: 'AC-F02-01', phase: 'agent', outcome: 'judged', verdict: 'REJECT', usage: measured });
  assert.match(row, /\| 10895 \|/, `the input column hides the cache write: ${row}`);
});

test('usageLine names all four numbers, because they are priced differently', () => {
  const line = usageLine({
    inputTokens: 2,
    outputTokens: 2135,
    cacheReadTokens: 98000,
    cacheWriteTokens: 10893,
    costUsd: 0.6641,
    durationMs: 1,
  });
  for (const part of ['2 in', '10893 cache-write', '98000 cache-read', '2135 out', '$0.6641']) {
    assert.ok(line.includes(part), `${part} is missing from: ${line}`);
  }
});

test('the totals block says so when no tool reported usage', () => {
  const totals = summaryTotals({
    iterations: 3,
    rows: ['judged', 'gate red', 'judged'],
    usage: null,
    wallSeconds: 900,
    reason: 'every row is done',
    counts: { done: 2, review: 0, rework: 0, blocked: 0, todo: 0 },
  });

  assert.match(totals, /not reported by this JUDGE_CMD/);
  assert.match(totals, /2 judged · 1 gate red/);
  assert.match(totals, /iterations: 3/);
  assert.match(totals, /2 done/);
});

test('the totals name the agent usage as absent, rather than leaving it to be assumed', () => {
  // The one number this file cannot give. Saying nothing would let a reader total the judge's cost
  // and call it the run's cost — wrong by roughly an order of magnitude.
  const totals = summaryTotals({
    iterations: 1,
    rows: ['judged'],
    usage: null,
    wallSeconds: 10,
    reason: 'done',
    counts: null,
  });
  assert.match(totals, /agent's token usage is not captured/);
});

test('the summary path is a legal filename on win32 and carries stage and slice', () => {
  const path = summaryPath('2026-08-18T10:20:30.123Z', 'tests', 'F-02');
  assert.equal(path, 'loop/runs/2026-08-18T10-20-30-123-tests-F-02.md');
  // `:` is not legal in a Windows filename, and this repository runs on win32.
  assert.ok(!path.slice('loop/runs/'.length).includes(':'));
  assert.equal(summaryPath('2026-08-18T10:20:30.123Z', 'scaffold'), 'loop/runs/2026-08-18T10-20-30-123-scaffold.md');
});
