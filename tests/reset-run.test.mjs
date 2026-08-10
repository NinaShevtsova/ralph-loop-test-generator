// tests/reset-run.test.mjs
//
// The harness had no way to start over, and "start over" is not "clone again". The trackers are
// COMMITTED, so a rerun inherits the statuses the last run wrote; the journal, the step inventory and
// the verdicts are GITIGNORED, so they survive every checkout and reach the next run's first agent
// through the SessionStart hook. A second run on a machine that has run once therefore begins with the
// previous attempt's memory and none of its code — and nothing said so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../scripts/lib.mjs';
import { countByStatus, validateTable, setStatus, parseRows } from '../loop/tracker.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A copy of the harness with a run's worth of state in it. Exact paths only — never a wildcard. */
function usedRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'reset-run-'));
  for (const part of ['loop', 'scripts', 'package.json']) {
    cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  }

  // The volatile files are removed before they are written, because tests/hook.test.mjs writes and
  // deletes the REAL loop/JOURNAL.md and node --test runs test FILES in parallel. Copying loop/
  // wholesale therefore races it: measured, the copy arrived as a directory and writeFileSync failed
  // with EISDIR — standalone the file passed 6/6, and only the full suite showed it.
  for (const volatile_ of ['loop/JOURNAL.md', 'loop/STEPS.md']) {
    rmSync(join(dir, volatile_), { recursive: true, force: true });
  }

  // A run's leavings: rows advanced, a journal, an inventory, verdict and base files, and output.
  //
  // Normalised to all-`todo` FIRST. The copy comes from the live repository, whose scaffold tracker
  // carries whatever the current run has accepted — so without this the fixture inherits it and the
  // assertions below measure today's progress instead of the reset. That is the defect class this
  // suite has already been fixed for twice, most recently in tests/trackers.test.mjs, and writing it
  // a third time is what the normalising loop exists to prevent.
  const tracker = join(dir, 'loop/trackers/scaffold.md');
  let markdown = readFileSync(tracker, 'utf8');
  for (const row of parseRows(markdown)) {
    if (row.status !== 'todo') markdown = setStatus(markdown, row.id, 'todo');
  }
  markdown = setStatus(setStatus(markdown, 'S1', 'done'), 'S2', 'rework');
  writeFileSync(tracker, markdown);

  const testsTracker = join(dir, 'loop/trackers/tests.md');
  let testsMd = readFileSync(testsTracker, 'utf8');
  for (const row of parseRows(testsMd)) {
    if (row.status !== 'todo') testsMd = setStatus(testsMd, row.id, 'todo');
  }
  writeFileSync(testsTracker, setStatus(testsMd, parseRows(testsMd)[0].id, 'done'));

  writeFileSync(join(dir, 'loop/JOURNAL.md'), '### Iteration 1\n**Did:** built wave 1.\n');
  writeFileSync(join(dir, 'loop/STEPS.md'), '**Total:** 3\n');
  mkdirSync(join(dir, 'loop/verdicts'), { recursive: true });
  writeFileSync(join(dir, 'loop/verdicts/.gitkeep'), '');
  writeFileSync(join(dir, 'loop/verdicts/S1.md'), 'VERDICT: PASS\n');
  writeFileSync(join(dir, 'loop/verdicts/S1.base'), 'deadbeef\n');
  mkdirSync(join(dir, 'framework/src'), { recursive: true });
  writeFileSync(join(dir, 'framework/src/Owner.cs'), 'class Owner {}\n');

  return dir;
}

const reset = (dir, args = []) => run(process.execPath, [join(dir, 'scripts/reset-run.mjs'), ...args], { cwd: dir });

test('reset-run changes nothing without --yes, and says what it would do', () => {
  // The dry run is the default because the wipe takes `framework/`, which is the loop's entire output
  // and the only thing in the repository no rerun can cheaply reproduce.
  const dir = usedRepo();
  try {
    const result = reset(dir);
    assert.equal(result.ok, true, result.out);
    assert.match(result.out, /delete framework/);
    assert.match(result.out, /nothing changed/);

    assert.ok(existsSync(join(dir, 'framework/src/Owner.cs')), 'the dry run must not delete anything');
    assert.ok(existsSync(join(dir, 'loop/JOURNAL.md')));
    assert.equal(countByStatus(readFileSync(join(dir, 'loop/trackers/scaffold.md'), 'utf8')).done, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset-run --yes returns every row to todo and clears the state a checkout would not', () => {
  const dir = usedRepo();
  try {
    const result = reset(dir, ['--yes']);
    assert.equal(result.ok, true, result.out);

    const markdown = readFileSync(join(dir, 'loop/trackers/scaffold.md'), 'utf8');
    assert.deepEqual(countByStatus(markdown), { todo: 14, review: 0, rework: 0, blocked: 0, done: 0 });
    assert.equal(validateTable(markdown).ok, true, 'a tracker this script mangles is unrecoverable');
    assert.equal(parseRows(markdown).length, 14, 'resetting statuses must not lose a row');

    for (const gone of ['framework', 'loop/JOURNAL.md', 'loop/STEPS.md']) {
      assert.ok(!existsSync(join(dir, gone)), `${gone} survived the reset`);
    }
    assert.deepEqual(readdirSync(join(dir, 'loop/verdicts')), ['.gitkeep'], 'verdicts must go, .gitkeep must stay');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset-run refuses --stage tests, and changes nothing when it does', () => {
  // This test asserted the opposite until the mode was found to be broken by construction. It resets
  // the tracker to 20 todo and leaves the 20 generated scenarios on disk, because `framework/` is
  // stage 0's output and the flag exists to spare it — but check-tests.mjs requires the scenario count
  // to equal the done count plus one, so the first turn is rejected with "20 scenarios against 0 done
  // rows" and K_FAILURES stops the run after three, having built nothing and spent three agent turns.
  //
  // Refusing in the script rather than warning in the runbook: a reader copies the command out of a
  // document, not the caveat beside it.
  const dir = usedRepo();
  try {
    const before = readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8');

    const result = reset(dir, ['--yes', '--stage', 'tests']);
    assert.equal(result.status, 2, result.out);
    assert.match(result.out, /--stage tests is not supported/);
    assert.match(result.out, /20 scenarios against 0 done rows/, 'the refusal must say why');
    assert.match(result.out, /npm run reset -- --yes/, 'and what to do instead');

    // A refusal that had already deleted something would be worse than no refusal at all.
    assert.equal(readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8'), before, 'tracker untouched');
    assert.ok(existsSync(join(dir, 'framework/src/Owner.cs')), 'framework untouched');
    assert.ok(existsSync(join(dir, 'loop/JOURNAL.md')), 'journal untouched');
    assert.ok(existsSync(join(dir, 'loop/verdicts/S1.md')), 'verdicts untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset-run refuses a stage it does not know, rather than resetting everything', () => {
  const dir = usedRepo();
  try {
    const result = reset(dir, ['--yes', '--stage', 'scafold']);
    assert.equal(result.status, 2, result.out);
    assert.match(result.out, /unknown stage "scafold"/);
    assert.ok(existsSync(join(dir, 'framework/src/Owner.cs')), 'a typo must not wipe the framework');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset-run says the tree is now dirty, because the trackers are committed files', () => {
  // Without this the operator resets, runs, and is refused with "working tree is dirty" pointing at a
  // file the reset itself wrote.
  const dir = usedRepo();
  try {
    run('git', ['init', '-q', '.'], { cwd: dir });
    run('git', ['add', '-A'], { cwd: dir });
    run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: dir });

    const result = reset(dir, ['--yes']);
    assert.match(result.out, /the tree is now dirty/);
    assert.match(result.out, /refuses to start on a dirty tree/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reset-run on an already-fresh harness reports nothing to do', () => {
  const dir = usedRepo();
  try {
    reset(dir, ['--yes']);
    const second = reset(dir, ['--yes']);
    assert.match(second.out, /already at a fresh state/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
