// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// This sits the grader down and marks its exam.
//
// It takes the ten examples with known answers, sends each one to the real grader exactly
// as the loop would, and reports how many it got right. Run it after changing the grading
// rules: it is the only way to tell whether an edit made the grader sharper or blunter,
// instead of guessing.
//
// The grader is given a stripped-down copy of the project as its workspace — the
// specifications and the rulebook, but not the finished test code. Otherwise it could look
// up the real, correct version of a deliberately broken example and be confused by the
// mismatch, and the exam would measure that confusion instead of the rules.
//
// It spends real money, so it is never part of the ordinary test run, and there is a
// --dry-run mode that builds everything and sends nothing.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/eval-judge.mjs — runs the golden set through the real judge and scores it.
//
// The one thing the harness could not answer: did that edit to the rubric make the judge better or
// worse. `tests/rubrics.test.mjs` proves the document is well formed; nothing proved it still CATCHES
// anything. This does, by showing the judge ten diffs whose verdict is known — eight of them defects
// the loop exists to stop, two of them work it actually accepted.
//
//   npm run eval:judge -- --dry-run              builds every prompt, spends nothing
//   npm run eval:judge -- --only weak-count      one fixture, one judge call
//   npm run eval:judge                           all ten
//
// IT SPENDS MONEY. Ten calls to whatever JUDGE_CMD names, on inputs of 45-56 KB. Measured against
// `claude -p --model claude-opus-5`: $0.66 for one fixture, so budget the set at $6-7.
// It is never part of `npm test` for that reason, and `--dry-run` exists so the plumbing can be
// checked for free. Run `--only` once before running the set.
//
// The judge is given a SANDBOX as its working directory: the flow documents, the conventions, the
// rubric and the step inventory, and no framework. The rubric invites it to read files, and the
// framework on disk holds the ACCEPTED code — a mutant diff would then contradict the tree it is
// standing in, and the fixture would measure that confusion rather than the rubric.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { repoRoot, run, invocation, brokenInvocationMessage } from './lib.mjs';
import { FLOW_GROUPS, flowDocPath, flowGroupOfAc } from './flows.mjs';
import { FIXTURES, buildDiff, grade } from '../loop/judge-eval.mjs';
import { judgePrompt, runJudge } from '../loop/invoke.mjs';
import { stageConfig } from '../loop/config.mjs';
import { parseVerdict, isWellFormed } from '../loop/verdict.mjs';
import { parseJudgeReply, addUsage, usageLine } from '../loop/telemetry.mjs';

const ROOT = repoRoot(import.meta.url);
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'judge');

const argAt = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

/**
 * Everything the judge may read, and nothing else.
 *
 * `loop/STEPS.md` is REGENERATED first rather than copied as found: it is gitignored, so on a fresh
 * clone it does not exist at all, and rubric item 23 — "is this step a rewording of one that already
 * exists" — cannot be answered without it. A stale inventory would quietly retire that item for every
 * fixture at once.
 */
function buildSandbox() {
  const inventory = run(process.execPath, ['scripts/steps-inventory.mjs'], { cwd: ROOT });
  if (!inventory.ok) {
    console.error(inventory.out);
    console.error('eval:judge: could not regenerate loop/STEPS.md — rubric item 23 would be unanswerable');
    process.exit(2);
  }

  const dir = mkdtempSync(join(tmpdir(), 'judge-eval-'));
  mkdirSync(join(dir, 'docs/specs/petclinic'), { recursive: true });
  mkdirSync(join(dir, 'loop'), { recursive: true });

  cpSync(join(ROOT, 'docs/specs/petclinic/flows'), join(dir, 'docs/specs/petclinic/flows'), {
    recursive: true,
  });
  cpSync(
    join(ROOT, 'docs/specs/petclinic/context-and-conventions.md'),
    join(dir, 'docs/specs/petclinic/context-and-conventions.md')
  );
  cpSync(join(ROOT, 'loop/rubrics'), join(dir, 'loop/rubrics'), { recursive: true });
  cpSync(join(ROOT, 'loop/STEPS.md'), join(dir, 'loop/STEPS.md'));

  return dir;
}

/** The judge's input for one fixture — assembled by the same builder the runner uses. */
function promptFor(fixture, { rubric, steps }) {
  const group = flowGroupOfAc(fixture.ac);
  if (!FLOW_GROUPS[group]) {
    console.error(`eval:judge: fixture "${fixture.name}" names ${fixture.ac}, which is in no known flow`);
    process.exit(2);
  }

  return judgePrompt({
    rubric,
    acText: readFileSync(join(ROOT, flowDocPath(group)), 'utf8'),
    diff: buildDiff(fixture, readFileSync(join(FIXTURE_DIR, fixture.base), 'utf8')),
    report: fixture.report ?? '',
    steps,
    // No exemplar, for every fixture. The exemplar is whatever the run happened to accept first, so
    // including it would make the score depend on the state of the repository — and two runs of the
    // same eval a month apart could then differ for a reason that has nothing to do with the rubric.
    exemplar: null,
  });
}

function scorecard(results) {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map((r) => {
    const mark = r.caught ? 'ok  ' : r.escalated ? 'ESC ' : 'MISS';
    return `  ${mark} ${r.name.padEnd(width)}  expected ${r.expected.padEnd(6)} got ${r.actual}`;
  });

  const caught = results.filter((r) => r.caught).length;
  const falsePasses = results.filter((r) => r.expected === 'REJECT' && r.actual === 'PASS');
  const falseRejects = results.filter((r) => r.expected === 'PASS' && r.actual !== 'PASS');

  return {
    lines,
    caught,
    falsePasses,
    falseRejects,
    summary: `${caught}/${results.length} correct · ${falsePasses.length} defect(s) accepted · ${falseRejects.length} good scenario(s) rejected`,
  };
}

function report({ results, usage, judgeCmd, startedAt, seconds }) {
  const card = scorecard(results);
  return [
    `# Judge eval ${startedAt}`,
    '',
    `- judge: \`${judgeCmd}\``,
    `- result: **${card.summary}**`,
    `- wall clock: ${Math.round(seconds)} s`,
    `- usage: ${usage ? usageLine(usage) : 'not reported by this JUDGE_CMD'}`,
    '',
    '| fixture | item | expected | got | outcome |',
    '|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.item ?? '—'} | ${r.expected} | ${r.actual} | ` +
        `${r.caught ? 'caught' : r.escalated ? 'escalated' : '**missed**'} |`
    ),
    '',
    '## What each fixture is',
    '',
    ...FIXTURES.map((f) => `- \`${f.name}\` (${f.ac}${f.item ? `, item ${f.item}` : ''}) — ${f.why}`),
    '',
    '## First finding of each reply',
    '',
    ...results.flatMap((r) => [`### ${r.name} — ${r.actual}`, '', '```', r.excerpt || '(nothing)', '```', '']),
  ].join('\n');
}

if (invocation(import.meta.url, process.argv[1]) === 'broken') {
  console.error(
    brokenInvocationMessage(import.meta.url, process.argv[1], 'the judge would not have been evaluated at all.')
  );
  process.exit(2);
}

if (invocation(import.meta.url, process.argv[1]) === 'cli') {
  const only = argAt('--only');
  const dryRun = process.argv.includes('--dry-run');
  const keep = process.argv.includes('--keep');

  const selected = only ? FIXTURES.filter((f) => f.name === only) : FIXTURES;
  if (selected.length === 0) {
    console.error(`eval:judge: no fixture named "${only}" — ${FIXTURES.map((f) => f.name).join(', ')}`);
    process.exit(2);
  }

  // The judge command comes from the same resolver the runner uses, so an operator who overrides
  // JUDGE_CMD is evaluating the judge they actually run.
  const { judgeCmd } = stageConfig('tests', process.env);
  const sandbox = buildSandbox();
  const rubric = readFileSync(join(ROOT, 'loop/rubrics/tests.md'), 'utf8');
  const steps = readFileSync(join(ROOT, 'loop/STEPS.md'), 'utf8');

  const prompts = selected.map((fixture) => ({ fixture, prompt: promptFor(fixture, { rubric, steps }) }));

  console.log(`eval:judge: ${selected.length} fixture(s), judge \`${judgeCmd}\``);
  console.log(`eval:judge: sandbox ${sandbox}`);
  for (const { fixture, prompt } of prompts) {
    console.log(`  ${fixture.name.padEnd(34)} ${prompt.length} chars, expects ${fixture.expect}`);
  }

  if (dryRun) {
    if (!keep) rmSync(sandbox, { recursive: true, force: true });
    console.log('eval:judge: --dry-run — every prompt built, nothing spent.');
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results = [];
  let usage = null;

  for (const { fixture, prompt } of prompts) {
    process.stdout.write(`eval:judge: ${fixture.name} … `);
    const judged = await runJudge(judgeCmd, prompt, { root: sandbox });
    const reply = parseJudgeReply(judged.out);
    usage = addUsage(usage, reply.usage);

    // A judge that did not complete is NOT a miss. Scoring it as one would blame the rubric for a
    // rate limit, and the number this file exists to make trustworthy is the one that would move.
    if (!judged.ok || reply.text.trim() === '') {
      console.log(`did not complete — ${judged.why}`);
      console.error('eval:judge: aborting; a partial scorecard is worse than none');
      if (!keep) rmSync(sandbox, { recursive: true, force: true });
      process.exit(2);
    }

    const verdict = parseVerdict(reply.text);
    const scored = { ...grade(fixture, verdict), item: fixture.item };
    scored.excerpt = reply.text.split('\n').slice(0, 12).join('\n');
    // Reported, never repaired. A judge that decorates its first line has its real verdict thrown
    // away by the runner too, and an eval that quietly read past the decoration would score a judge
    // the loop cannot actually use.
    if (!isWellFormed(reply.text)) {
      scored.excerpt = `[first line is not a bare verdict — the runner reads this as REJECT]\n${scored.excerpt}`;
    }

    results.push(scored);
    console.log(`${verdict} ${scored.caught ? '(caught)' : scored.escalated ? '(escalated)' : '(MISSED)'}`);
  }

  if (!keep) rmSync(sandbox, { recursive: true, force: true });

  const seconds = (Date.now() - startedMs) / 1000;
  const card = scorecard(results);
  console.log('');
  for (const line of card.lines) console.log(line);
  console.log(`\neval:judge: ${card.summary}`);

  const out = argAt('--out') ?? `loop/evals/${startedAt.replace(/[:.]/g, '-').replace(/Z$/, '')}.md`;
  mkdirSync(join(ROOT, 'loop', 'evals'), { recursive: true });
  writeFileSync(join(ROOT, out), report({ results, usage, judgeCmd, startedAt, seconds }));
  console.log(`eval:judge: wrote ${out}`);

  // The two failure directions are not the same fault and the exit code says which. A defect accepted
  // is the failure this loop is built around; a good scenario rejected costs iterations and, if the
  // judge does it consistently, stops runs at the plateau stop with nothing wrong with the work.
  if (card.falsePasses.length > 0) {
    console.error(`eval:judge: FAIL — accepted ${card.falsePasses.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  if (card.falseRejects.length > 0) {
    console.error(`eval:judge: FAIL — rejected ${card.falseRejects.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

export { promptFor, scorecard, report };
