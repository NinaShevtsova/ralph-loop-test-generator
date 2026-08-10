// scripts/reset-run.mjs — put the loop back to the state a fresh clone would start from.
//
// The harness had no way to start over, and "start over" is not the same as "clone again": the
// trackers are COMMITTED, so a rerun inherits whatever statuses the last run wrote, while the journal,
// the step inventory and the verdicts are GITIGNORED, so they survive every checkout and reach the
// next run's first agent through the SessionStart hook. A rerun on a machine that has already run once
// therefore starts with the previous attempt's memory and none of its code — the worst of both, and
// silently.
//
//   node scripts/reset-run.mjs --yes             both stages
//   node scripts/reset-run.mjs --yes --stage tests   only the tests tracker, keeps framework/
//   node scripts/reset-run.mjs                   dry run: prints what it would do, changes nothing
//
// `--yes` is required because this deletes `framework/`, which is the loop's entire output.

import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, run } from './lib.mjs';
import { STAGES } from '../loop/config.mjs';
import { parseRows, setStatus, validateTable } from '../loop/tracker.mjs';

const ROOT = repoRoot(import.meta.url);
const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const stageArg = args[args.indexOf('--stage') + 1];
const stage = args.includes('--stage') ? stageArg : null;

if (stage && !STAGES[stage]) {
  console.error(`reset-run: unknown stage "${stage}" — use ${Object.keys(STAGES).join(' or ')}`);
  process.exit(2);
}

const stages = stage ? [stage] : Object.keys(STAGES);
const planned = [];

/**
 * Every row back to `todo`, written through `setStatus`.
 *
 * Not `git checkout <sha> -- loop/trackers/`, which was the obvious route: it pins the reset to a
 * commit that has to be looked up and stays correct only until someone edits a title. Rewriting the
 * statuses in place needs no history and cannot resurrect an old row list.
 */
function resetTracker(relative) {
  const path = join(ROOT, relative);
  if (!existsSync(path)) return null;

  let markdown = readFileSync(path, 'utf8');
  const rows = parseRows(markdown);
  const stale = rows.filter((row) => row.status !== 'todo');
  if (stale.length === 0) return null;

  for (const row of stale) markdown = setStatus(markdown, row.id, 'todo');

  // Validated before writing, not after. A tracker this script mangles is one nothing can recover,
  // and the runner would refuse to start on it with an error pointing at the file rather than here.
  const verdict = validateTable(markdown);
  if (!verdict.ok) {
    console.error(`reset-run: refusing to write ${relative} — ${verdict.problems.join('; ')}`);
    process.exit(1);
  }

  return { path, markdown, count: stale.length, relative };
}

for (const name of stages) {
  const reset = resetTracker(STAGES[name].tracker);
  if (reset) planned.push({ kind: 'tracker', ...reset });
}

// Runtime state, gitignored and therefore invisible to `git status` — which is exactly why it is easy
// to forget and why a "fresh" run inherits it.
for (const relative of ['loop/JOURNAL.md', 'loop/STEPS.md']) {
  if (existsSync(join(ROOT, relative))) planned.push({ kind: 'file', relative });
}

const verdicts = join(ROOT, 'loop/verdicts');
if (existsSync(verdicts)) {
  for (const name of readdirSync(verdicts)) {
    if (name !== '.gitkeep') planned.push({ kind: 'file', relative: `loop/verdicts/${name}` });
  }
}

// `framework/` is stage 0's output, so it goes only when stage 0 is being reset.
const wipeFramework = !stage || stage === 'scaffold';
if (wipeFramework && existsSync(join(ROOT, 'framework'))) planned.push({ kind: 'dir', relative: 'framework' });

if (planned.length === 0) {
  console.log('reset-run: already at a fresh state — nothing to do.');
  process.exit(0);
}

for (const item of planned) {
  const what =
    item.kind === 'tracker'
      ? `reset ${item.count} row(s) to todo in ${item.relative}`
      : `delete ${item.relative}`;
  console.log(`  ${what}`);
}

if (!confirmed) {
  console.log('\nreset-run: nothing changed. Add --yes to do it.');
  if (wipeFramework) console.log('reset-run: note that `framework/` is the loop\'s entire output.');
  process.exit(0);
}

for (const item of planned) {
  if (item.kind === 'tracker') writeFileSync(item.path, item.markdown);
  else rmSync(join(ROOT, item.relative), { recursive: true, force: true });
}

mkdirSync(verdicts, { recursive: true });

console.log(`\nreset-run: done — ${planned.length} item(s).`);

// The trackers are TRACKED, so resetting them leaves the tree dirty and the runner refuses to start.
// Saying so here is the difference between a reset that works and one that hands the operator a
// refusal they have to diagnose.
const dirty = run('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=normal']);
if (dirty.ok && dirty.stdout.trim() !== '') {
  console.log('reset-run: the trackers are committed files, so the tree is now dirty.');
  console.log('reset-run: commit them before running the loop — it refuses to start on a dirty tree.');
}
