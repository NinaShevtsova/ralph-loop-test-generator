// tests/hook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot, run } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const HOOK = join(ROOT, '.claude/hooks/loop-memory.mjs');
const JOURNAL = join(ROOT, 'loop/JOURNAL.md');

/** Runs the hook the way Claude Code does: JSON on stdin, read stdout. */
const invoke = (env = {}) =>
  run(process.execPath, [HOOK], { cwd: ROOT, input: '{}', env: { ...process.env, ...env } });

/**
 * The environment a ralph AGENT turn runs in, and the only one the hook speaks to.
 *
 * Spelled out at every call site rather than folded into `invoke`, because it is the gate itself.
 * Defaulted, the tests below would all pass against a hook with no gates at all — the state this
 * suite exists to have left behind. `RALPH_STAGE` is what `runAgent` sets and nothing else does.
 */
const AGENT = { RALPH_STAGE: 'tests' };

/**
 * Swaps in a journal — or, for `null`, the absence of one — runs the body, and puts the real one
 * back whatever happens.
 *
 * `finally`, not a line after the assertions. `loop/JOURNAL.md` is the agent's own self-report and
 * the only record of what earlier turns tripped over; a failing assertion would otherwise leave a
 * test fixture in its place, and it is gitignored, so there is nothing to restore it from. Every
 * test that touches the journal goes through here for that reason — a save/restore written out by
 * hand around the assertions is the same bug four times over, and it only fires on the day
 * something is already broken.
 */
function withJournal(contents, body) {
  const had = existsSync(JOURNAL);
  const saved = had ? readFileSync(JOURNAL, 'utf8') : null;
  mkdirSync(join(ROOT, 'loop'), { recursive: true });
  if (contents === null) rmSync(JOURNAL, { recursive: true, force: true });
  else writeFileSync(JOURNAL, contents);
  try {
    body();
  } finally {
    rmSync(JOURNAL, { recursive: true, force: true });
    if (had) writeFileSync(JOURNAL, saved);
  }
}

/**
 * Writes a fixture inside the repository and removes it again, whatever happens.
 *
 * The removal is not tidiness. Measured: with `tests/fixtures/tracker-sample.md` left behind by a
 * finished test run, `node loop/ralph.mjs --stage tests --dry-run` reported
 * `start: not ready — commit or stash your changes`, and a real run dies at
 * `working tree is dirty — commit, stash, or pass --allow-dirty`. `npm test` must leave the tree
 * exactly as it found it, or the suite breaks the runner it exists to protect and blames the
 * operator for a file they never created.
 */
function withFixture(relativePath, contents, body) {
  const path = join(ROOT, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  try {
    body();
  } finally {
    rmSync(path, { force: true });
  }
}

const SAMPLE_TRACKER = [
  '| ID | Group | Title | Status |',
  '|---|---|---|---|',
  '| AC-F01-01 | F-01 | first | done |',
  '| AC-F01-02 | F-01 | second | todo |',
  '| AC-F01-03 | F-01 | third | blocked |',
  '',
  '**Total:** 3',
  '',
  '## Open questions',
  '',
  '| AC-F09-99 | F-09 | a phantom row in the prose | done |',
  '',
].join('\n');

test('the hook stays silent and exits 0 when there is no journal', () => {
  // `AGENT`, so the stage gate lets this through and the JOURNAL gate is what is being measured.
  // Without it this passes against a hook that has no journal check at all.
  withJournal(null, () => {
    const result = invoke(AGENT);
    assert.equal(result.ok, true);
    assert.equal(result.out.trim(), '');
  });
});

test('a journal of nothing but whitespace is the silent path too', () => {
  // The `if (!journal)` guard, which nothing else reaches. A run that opened the journal and then
  // stopped before its first turn leaves exactly this file behind.
  withJournal('   \n\n', () => {
    const result = invoke(AGENT);
    assert.equal(result.ok, true);
    assert.equal(result.out.trim(), '');
  });
});

test('the hook prints measured facts and the journal, and separates them', () => {
  withJournal('### Iteration 1 — AC-F01-01\n**Did:** wrote the exemplar.\n', () => {
    const result = invoke({ ...AGENT, RALPH_TRACKER: 'loop/trackers/tests.md' });
    assert.equal(result.ok, true);
    assert.match(result.out, /Facts/i);
    assert.match(result.out, /Journal/i);
    assert.match(result.out, /branch/i);
    assert.match(result.out, /wrote the exemplar/);
    assert.ok(result.out.indexOf('Facts') < result.out.indexOf('Journal'), 'facts must come first');
  });
});

test('the hook reports the tracker counts when told which tracker to read', () => {
  // A FIXTURE, not `loop/trackers/tests.md`. Asserting `20 todo` against the live tracker makes this
  // test fail the first time the loop is actually used — that file is runtime state and the count is
  // SUPPOSED to change. The fixture also lets the assertion be exact instead of a three-way
  // alternation hoping to match whichever format the hook happened to pick.
  const fixture = 'tests/fixtures/tracker-sample.md';

  withFixture(fixture, SAMPLE_TRACKER, () => {
    withJournal('### Iteration 1\n**Did:** x\n', () => {
      const result = invoke({ ...AGENT, RALPH_TRACKER: fixture });
      assert.match(result.out, /1 todo/);
      assert.match(result.out, /1 done/);
      assert.match(result.out, /AC-F01-03/, 'a blocked row must be named — a human has to answer it');
      // The phantom row below the table is NOT a row. Counting it would report 2 done, which is the
      // measured difference between `tracker.mjs` and a plain line-by-line regex.
      assert.doesNotMatch(result.out, /2 done/);
    });
  });
});

test('a tracker whose rows will not parse is named, not quietly left out', () => {
  // 0 rows is the state `pickTarget` throws on and `validateTable` rejects — a status cell written
  // as `` `todo` `` or `**todo**` is enough, and the agent under review is the party that writes
  // those cells. Silence here reads exactly like "no tracker was named", and printing the counts
  // would read as a finished stage: `countByStatus` returns all zeroes for a table it cannot parse.
  const fixture = 'tests/fixtures/tracker-broken.md';
  const broken = [
    '| ID | Group | Title | Status |',
    '|---|---|---|---|',
    '| AC-F01-01 | F-01 | first | `todo` |',
    '| AC-F01-02 | F-01 | second | **todo** |',
    '',
    '**Total:** 2',
    '',
  ].join('\n');

  withFixture(fixture, broken, () => {
    withJournal('### Iteration 1\n**Did:** x\n', () => {
      const result = invoke({ ...AGENT, RALPH_TRACKER: fixture });
      assert.equal(result.ok, true, 'a malformed tracker must not crash the session start');
      assert.match(result.out, /0 rows parsed/, 'the broken table must be named');
      assert.doesNotMatch(
        result.out,
        /0 todo · 0 review/,
        'all-zero counts read as a finished stage — they must not be printed for a table that did not parse'
      );
    });
  });

  // The other direction, so this test cannot pass by simply never producing counts: the same hook,
  // the same journal, a tracker that DOES parse, and the counts appear.
  withFixture('tests/fixtures/tracker-sample.md', SAMPLE_TRACKER, () => {
    withJournal('### Iteration 1\n**Did:** x\n', () => {
      const result = invoke({ ...AGENT, RALPH_TRACKER: 'tests/fixtures/tracker-sample.md' });
      assert.match(result.out, /1 todo/);
      assert.doesNotMatch(result.out, /0 rows parsed/);
    });
  });
});

test('a git that cannot run is reported as a failure, never as an empty repository', () => {
  // The fail-open class that cost task 21 five separate fixes, in the one block whose heading tells
  // the agent to trust what it says. Written as `git(...) || '(no history yet)'`, a git that could
  // not run at all announced that the repository had no commits.
  const emptyDir = mkdtempSync(join(tmpdir(), 'no-git-'));

  // Windows resolves PATH case-insensitively; Node's `process.env` object does not. Spreading it
  // yields `Path`, and adding `PATH` next to it leaves the original in place — the child finds git
  // after all and the test passes for the wrong reason.
  const stripped = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^path$/i.test(key)) stripped[key] = value;
  }
  stripped.PATH = emptyDir;
  Object.assign(stripped, AGENT);

  try {
    withJournal('### Iteration 1\n**Did:** x\n', () => {
      // Both directions. With a normal PATH the hook reports a real branch; only then does the
      // failure text below mean anything. Anchored on the branch LINE rather than on the absence of
      // the words anywhere in the output — `git log --oneline -3` is in that output too, and a
      // future commit subject mentioning git would otherwise fail this test for no reason.
      const healthy = invoke(AGENT);
      assert.match(
        healthy.out,
        /branch `[^`]+` · working tree (?:clean|dirty)/,
        'git works here — the probe itself must be sound'
      );

      const result = run(process.execPath, [HOOK], { cwd: ROOT, input: '{}', env: stripped });
      assert.equal(result.status, 0, 'a broken git must still not crash the session start');
      assert.match(result.out, /branch `\(git failed\)`/, 'the branch line must name the failure');
      assert.match(result.out, /working tree \*\*unknown/, 'and so must the working-tree line');
      assert.match(result.out, /the history is unknown/, 'and so must the history');
      assert.doesNotMatch(
        result.out,
        /no commits yet|no history yet/,
        'a git that did not run has not told us the repository is empty'
      );
    });
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('the hook never crashes a session start, even when the journal cannot be read', () => {
  // Its own comment states the stake — "a hook that throws fails EVERY session start in this
  // repository, interactive ones included" — and guarded only the dynamic import. Measured with the
  // reads unguarded: exit 1 and a raw `EISDIR` stack trace, from the hook whose entire promise to
  // an ordinary interactive session is silence.
  const had = existsSync(JOURNAL);
  const saved = had ? readFileSync(JOURNAL, 'utf8') : null;

  try {
    rmSync(JOURNAL, { recursive: true, force: true });
    mkdirSync(JOURNAL, { recursive: true }); // a directory: readFileSync raises EISDIR

    const result = invoke(AGENT);
    assert.equal(result.status, 0, 'a non-zero exit surfaces an error at every session start');
    assert.equal(result.stdout.trim(), '', 'nothing was read, so nothing may be poured into context');
    assert.match(result.stderr, /cannot read/, 'and it must not be silent about why');
    assert.doesNotMatch(result.stderr, /at readFileSync/, 'a stack trace is not a diagnosis');
  } finally {
    rmSync(JOURNAL, { recursive: true, force: true });
    if (had) writeFileSync(JOURNAL, saved);
  }
});

test('the hook tells the agent to trust the facts over the journal', () => {
  withJournal('### Iteration 1\n**Did:** x\n', () => {
    const result = invoke({ ...AGENT, RALPH_TRACKER: 'loop/trackers/tests.md' });
    assert.match(result.out, /trust the facts/i);
  });
});

// ── The two gates ────────────────────────────────────────────────────────────────
//
// Measured, not assumed: a plain `claude -p` in this repository DOES fire SessionStart. So this hook
// runs for the judge and for every ordinary interactive session, not only for an agent turn, and a
// journal sitting on disk was its only previous gate. The three tests below are the whole reason the
// judge's verdict can still be called independent.

test('an interactive session gets nothing, even with a journal sitting there', () => {
  // `RALPH_STAGE` unset — the measured environment of a plain `claude -p`. This is also every
  // ordinary session a human opens in this repository after a real run has left a journal behind.
  withJournal('### Iteration 1\n**Did:** something the operator never asked about\n', () => {
    const result = invoke();
    assert.equal(result.status, 0);
    assert.equal(result.out.trim(), '', 'an unmarked session must receive nothing at all');
  });
});

test('the judge gets nothing, even with the whole agent environment around it', () => {
  // The NEGATIVE gate, tested on its own. `RALPH_STAGE` and `RALPH_TRACKER` are both set here, so the
  // positive gate would let this through — only `RALPH_JUDGE` turns it away. Tested independently
  // because belt-and-braces that is never exercised separately is decoration: today the judge is also
  // covered by `RALPH_STAGE` being absent from the runner's own environment, and one refactor that
  // writes `process.env.RALPH_STAGE = stage` removes that cover silently.
  withFixture('tests/fixtures/tracker-sample.md', SAMPLE_TRACKER, () => {
    withJournal('### Iteration 1\n**Did:** wrote the exemplar and it is perfect\n', () => {
      const result = invoke({
        ...AGENT,
        RALPH_TRACKER: 'tests/fixtures/tracker-sample.md',
        RALPH_JUDGE: '1',
      });
      assert.equal(result.status, 0);
      assert.equal(result.out.trim(), '', 'the judge must never be shown the agent’s self-report');
    });
  });
});

test('an agent turn gets through both gates', () => {
  // The positive control. Without it the two tests above pass against a hook that prints nothing to
  // anyone — which is silent, compliant, and useless.
  withJournal('### Iteration 1\n**Did:** wrote the exemplar.\n', () => {
    const result = invoke(AGENT);
    assert.equal(result.status, 0);
    assert.match(result.out, /wrote the exemplar/, 'the agent turn is the one session that is served');
    assert.match(result.out, /trust the facts/i);
  });
});

test('settings.json registers the hook on SessionStart', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));
  const commands = settings.hooks.SessionStart.flatMap((entry) => entry.hooks).map((h) => h.command);
  assert.ok(
    commands.some((command) => command.includes('loop-memory.mjs')),
    'no SessionStart hook runs loop-memory.mjs'
  );
});

test('the suite leaves no fixture behind that would make the runner refuse to start', () => {
  // The runner's preflight reads `git status --porcelain --untracked-files=normal` and dies on any
  // output. A fixture left in the tree by a finished test run is indistinguishable from work an
  // operator forgot to commit, and it is the SUITE that would be at fault. Measured with the
  // cleanup missing: `?? tests/fixtures/`, then
  // `start: not ready — commit or stash your changes` on the very next dry run.
  //
  // Checked on the filesystem, not through `git status`: the journal is gitignored, so an assertion
  // phrased against porcelain output could never have failed for it, and a check that cannot bark
  // is worse than no check. Runs last because `node:test` keeps declaration order within a file.
  for (const leftover of ['tests/fixtures/tracker-sample.md', 'tests/fixtures/tracker-broken.md']) {
    assert.equal(existsSync(join(ROOT, leftover)), false, `${leftover} survived its test`);
  }
});
