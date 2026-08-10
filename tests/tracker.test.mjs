// tests/tracker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRows,
  countByStatus,
  pickTarget,
  setStatus,
  firstDone,
  validateTable,
  forbiddenStatusWrites,
  STATUSES,
} from '../loop/tracker.mjs';

const TRACKER = `# Tracker — stage 1 (tests)

> States: \`todo\` · \`review\` · \`rework\` · \`blocked\` · \`done\`

| ID | Group | Title | Status |
|---|---|---|---|
| AC-F01-01 | F-01 | a registered owner is visible in details and in the list | done |
| AC-F01-02 | F-01 | updated owner contacts are visible without a duplicate | rework |
| AC-F02-01 | F-02 | an added pet is visible in both details | todo |
| AC-F02-02 | F-02 | an added pet appears in the clinic-wide list | todo |

**Total:** 4 rows.
`;

test('parseRows reads every data row and ignores the header and separator', () => {
  const rows = parseRows(TRACKER);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['AC-F01-01', 'AC-F01-02', 'AC-F02-01', 'AC-F02-02']
  );
  assert.equal(rows[0].group, 'F-01');
  assert.equal(rows[0].status, 'done');
  assert.match(rows[0].title, /registered owner/);
});

test('parseRows does not treat the separator row as data', () => {
  // Subtler than it looks: `-` is inside the id character class, so `---` DOES match the id and
  // group groups. What rejects both the separator and the header row is the fourth group requiring
  // a literal status word — case-sensitively. That one column is the whole guard.
  const rows = parseRows('| ID | Group | Title | Status |\n|---|---|---|---|\n');
  assert.equal(rows.length, 0);
});

test('parseRows stops at the end of the tracker table and ignores any later table', () => {
  // Measured before the stop existed: `| some-test | integration | nobody | done |` in a different
  // table was parsed as a tracker row with the id `some-test`. That matters at runtime, not just on
  // disk — the "Open questions" section below the table is filled with free text while the loop is
  // running, so a row-count test on the pristine file could never catch the drift.
  const withDecoy = `${TRACKER}
| Test | Level | Owner | Result |
|---|---|---|---|
| some-test | integration | nobody | done |
`;
  const rows = parseRows(withDecoy);
  assert.equal(rows.length, 4);
  assert.ok(!rows.some((row) => row.id === 'some-test'), 'a row from a later table must not count');
});

test('countByStatus reports every status including the zeroes', () => {
  const counts = countByStatus(TRACKER);
  assert.deepEqual(counts, { todo: 2, review: 0, rework: 1, blocked: 0, done: 1 });
  for (const status of STATUSES) assert.ok(status in counts);
});

test('countByStatus narrows to one group when asked', () => {
  // The runner passes `--flow` through. Without this the plateau metric and the printed tally under
  // `--flow F-01` were dominated by rows the operator was not working on, so the number that stopped
  // the run was not the number on screen.
  assert.deepEqual(countByStatus(TRACKER, 'F-01'), {
    todo: 0,
    review: 0,
    rework: 1,
    blocked: 0,
    done: 1,
  });
  assert.deepEqual(countByStatus(TRACKER, 'F-02'), {
    todo: 2,
    review: 0,
    rework: 0,
    blocked: 0,
    done: 0,
  });
});

test('countByStatus with no group is unchanged, and an unknown group counts nothing', () => {
  // Both callers matter: the scaffold stage never passes a group, and `parseArgs` yields null rather
  // than undefined when `--flow` is absent — a filter that treated null as a group name would count
  // zero rows and the runner would read a finished stage.
  const whole = { todo: 2, review: 0, rework: 1, blocked: 0, done: 1 };
  assert.deepEqual(countByStatus(TRACKER), whole);
  assert.deepEqual(countByStatus(TRACKER, undefined), whole);
  assert.deepEqual(countByStatus(TRACKER, null), whole);
  assert.deepEqual(countByStatus(TRACKER, ''), whole);

  // A real but absent group is zeroes, not the whole tracker — every status key still present.
  const missing = countByStatus(TRACKER, 'F-09');
  assert.deepEqual(missing, { todo: 0, review: 0, rework: 0, blocked: 0, done: 0 });
  for (const status of STATUSES) assert.ok(status in missing);
});

test('pickTarget skips done rows and returns the first actionable one', () => {
  const target = pickTarget(TRACKER);
  assert.equal(target.row.id, 'AC-F01-02');
  assert.equal(target.phase, 'agent');
});

test('pickTarget honours the group filter', () => {
  const target = pickTarget(TRACKER, 'F-02');
  assert.equal(target.row.id, 'AC-F02-01');
  assert.equal(target.phase, 'agent');
});

test('pickTarget returns the judge phase for a row left in review by a crashed run', () => {
  const withReview = setStatus(TRACKER, 'AC-F01-02', 'review');
  const target = pickTarget(withReview);
  assert.equal(target.row.id, 'AC-F01-02');
  assert.equal(target.phase, 'judge');
});

test('pickTarget reports blocked instead of silently skipping to the next row', () => {
  const withBlocked = setStatus(TRACKER, 'AC-F01-02', 'blocked');
  const target = pickTarget(withBlocked);
  assert.equal(target.row.id, 'AC-F01-02');
  assert.equal(target.phase, 'blocked');
});

test('pickTarget returns null when everything is done', () => {
  let md = TRACKER;
  for (const id of ['AC-F01-02', 'AC-F02-01', 'AC-F02-02']) md = setStatus(md, id, 'done');
  assert.equal(pickTarget(md), null);
});

test('setStatus changes only the target row and keeps the table intact', () => {
  const updated = setStatus(TRACKER, 'AC-F02-01', 'review');
  const rows = parseRows(updated);
  assert.equal(rows.find((r) => r.id === 'AC-F02-01').status, 'review');
  assert.equal(rows.find((r) => r.id === 'AC-F02-02').status, 'todo');
  assert.equal(rows.length, 4);
  assert.match(updated, /^# Tracker/);
  assert.match(updated, /\*\*Total:\*\* 4 rows\./);
});

test('setStatus preserves the title verbatim', () => {
  const updated = setStatus(TRACKER, 'AC-F01-01', 'rework');
  const row = parseRows(updated).find((r) => r.id === 'AC-F01-01');
  assert.equal(row.title, 'a registered owner is visible in details and in the list');
});

test('setStatus throws on an unknown status rather than writing garbage', () => {
  assert.throws(() => setStatus(TRACKER, 'AC-F02-01', 'finished'), /unknown status/);
});

test('setStatus throws on an unknown id rather than silently doing nothing', () => {
  assert.throws(() => setStatus(TRACKER, 'AC-F09-99', 'done'), /no tracker row/);
});

test('setStatus rewrites the tracker table, never a status-shaped row in the prose below it', () => {
  // The runner and the agent fill the "Open questions" section with free text, and a question
  // formatted as a table row used to be a legitimate target for the writer.
  const withDecoy = `${TRACKER}
| AC-F02-01 | F-02 | a question that happens to be formatted as a table row | blocked |
`;
  const updated = setStatus(withDecoy, 'AC-F02-01', 'done');

  assert.equal(parseRows(updated).find((row) => row.id === 'AC-F02-01').status, 'done');
  assert.match(
    updated,
    /\| AC-F02-01 \| F-02 \| a question that happens to be formatted as a table row \| blocked \|/,
    'the row below the table must be left exactly as it was'
  );
});

test('setStatus still throws when the id exists only below the table', () => {
  // The sharper half of the same bug: a phantom row could satisfy the found check on its own, so a
  // missing real row would be accepted as updated and the loop would believe it recorded a status
  // it never wrote.
  const withDecoy = `${TRACKER}
| AC-F09-99 | F-09 | only in the prose below the table | todo |
`;
  assert.throws(() => setStatus(withDecoy, 'AC-F09-99', 'done'), /no tracker row/);
});

test('firstDone returns the earliest done row — the judge exemplar', () => {
  assert.equal(firstDone(TRACKER).id, 'AC-F01-01');
});

test('firstDone returns null before anything has been accepted', () => {
  const fresh = setStatus(TRACKER, 'AC-F01-01', 'todo');
  assert.equal(firstDone(fresh), null);
});

test('firstDone returns the EARLIEST done row, not the most recent one', () => {
  // The exemplar is meant to be the anchor every later iteration copies. If this returned the last
  // accepted row instead, each iteration would copy the previous one and the style would drift —
  // which is the thing the design added an exemplar to prevent. A `find` -> `findLast` mutation used
  // to survive the whole suite, because the fixture had exactly one `done` row.
  const two = setStatus(TRACKER, 'AC-F02-01', 'done');
  assert.equal(firstDone(two).id, 'AC-F01-01');
});

test('parseRows preserves file order, not id order', () => {
  // pickTarget's contract calls file order "the only dependency mechanism": the scaffold tracker is
  // sorted by wave. Sorting rows by id inside parseRows used to survive the whole suite, and on that
  // tracker an id sort gives S1, S10, S11, S12, S13, S14, S2 — wave order destroyed.
  const shuffled = `| ID | Group | Title | Status |
|---|---|---|---|
| S10 | wave-6 | later wave, earlier line | todo |
| S2 | wave-2 | earlier wave, later line | todo |
`;
  assert.deepEqual(parseRows(shuffled).map((row) => row.id), ['S10', 'S2']);
});

test('parseRows accepts a row indented by a space, the way markdown renders it', () => {
  // Markdown renders one to three leading spaces identically, so the file looks correct. The row
  // used to be skipped silently while the table-stop check accepted the same line.
  const indented = `| ID | Group | Title | Status |
|---|---|---|---|
| S1 | wave-1 | flush left | todo |
 | S2 | wave-2 | indented one space | todo |
`;
  assert.deepEqual(parseRows(indented).map((row) => row.id), ['S1', 'S2']);
});

test('parseRows handles CRLF line endings', () => {
  // This repository has core.autocrlf=true and no .gitattributes, so a fresh Windows checkout of
  // loop/trackers/*.md has CRLF. Without the trailing \s* in ROW the real trackers parsed to ZERO
  // rows, and the runner then reported the stage complete.
  const crlf = TRACKER.split('\n').join('\r\n');
  const rows = parseRows(crlf);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].id, 'AC-F01-01');
  assert.equal(rows[0].status, 'done');
  assert.deepEqual(countByStatus(crlf), { todo: 2, review: 0, rework: 1, blocked: 0, done: 1 });
});

test('setStatus preserves the line ending of the row it rewrites', () => {
  const crlf = TRACKER.split('\n').join('\r\n');
  const updated = setStatus(crlf, 'AC-F02-01', 'review');
  const rewritten = updated.split('\n').find((line) => line.includes('AC-F02-01'));
  assert.ok(rewritten.endsWith('\r'), `expected the CRLF ending to survive, got ${JSON.stringify(rewritten)}`);
  assert.equal(parseRows(updated).find((row) => row.id === 'AC-F02-01').status, 'review');
});

test('the scan anchors on the tracker header, so a decoy table above it cannot capture it', () => {
  // Measured before the anchor existed: a preamble table ending in a bare `done` cell gave one row
  // and pickTarget -> null, so the runner exited 0 on a tracker whose rows were all still todo.
  const withPreamble = `# Tracker

| Note | Owner | Detail | Result |
|---|---|---|---|
| x | y | a decoy above the real table | done |

${TRACKER}`;
  const rows = parseRows(withPreamble);
  assert.equal(rows.length, 4);
  assert.ok(!rows.some((row) => row.id === 'x'), 'the decoy above the header must not be counted');
});

// ── validateTable ─────────────────────────────────────────────────────────────

test('validateTable accepts a well-formed tracker', () => {
  assert.deepEqual(validateTable(TRACKER), { ok: true, problems: [] });
});

test('validateTable catches a status cell that would make its row vanish', () => {
  // The agent is the party that writes `review` into this file, and both prompts show it in
  // backticks. Measured: any of these made parseRows return one row fewer, after which the runner
  // announced every row was done and exited 0 with that work never done.
  for (const cell of ['`review`', '**review**', 'Review', 'review ✅', 'done (judge PASS)']) {
    const mangled = TRACKER.replace('| AC-F02-01 | F-02 | an added pet is visible in both details | todo |',
      `| AC-F02-01 | F-02 | an added pet is visible in both details | ${cell} |`);
    assert.equal(parseRows(mangled).length, 3, `${cell}: the row is invisible to the parser`);

    const verdict = validateTable(mangled);
    assert.equal(verdict.ok, false, `${cell}: must be reported`);
    assert.ok(
      verdict.problems.some((problem) => problem.includes('not a valid row')),
      `${cell}: the problem must name the malformed row, got ${JSON.stringify(verdict.problems)}`
    );
  }
});

test('validateTable cross-checks the parsed count against the declared Total', () => {
  // The second, independent detector: it holds even if the row regex is wrong in some way nobody
  // anticipated.
  const short = TRACKER.replace('| AC-F02-02 | F-02 | an added pet appears in the clinic-wide list | todo |\n', '');
  const verdict = validateTable(short);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.includes('**Total:** 4') && problem.includes('3 row')));
});

test('validateTable catches a duplicate id', () => {
  // With a duplicate, pickTarget can hand the runner a later row while setStatus rewrites the first.
  // Measured: the runner then re-targeted the same criterion every iteration, paying for an agent
  // turn and a judge call each time, until the no-improvement stop fired with a false plateau.
  //
  // The duplicate must go INSIDE the table. An earlier version of this fixture appended it after the
  // blank line that precedes `**Total:**`, which put it outside — four rows parsed, the duplicate was
  // never seen, and `ok === false` held only because of the Total mismatch. The duplicate branch was
  // covered by nothing, and relaxing the assertion to `ok === false` would have gone green while
  // exercising nothing at all.
  const LAST = '| AC-F02-02 | F-02 | an added pet appears in the clinic-wide list | todo |\n';
  const duplicated = TRACKER
    .replace(LAST, `${LAST}| AC-F02-01 | F-02 | a duplicate of an earlier row | todo |\n`)
    .replace('**Total:** 4 rows.', '**Total:** 5 rows.');

  // Guard the fixture itself, so this test cannot pass for the wrong reason again.
  assert.equal(parseRows(duplicated).length, 5, 'the duplicate must land inside the table');

  const verdict = validateTable(duplicated);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.includes('duplicate id AC-F02-01')));
  assert.equal(
    verdict.problems.length,
    1,
    `the duplicate must be the ONLY problem, got ${JSON.stringify(verdict.problems)}`
  );
});

test('validateTable reports a missing header rather than an empty table', () => {
  const verdict = validateTable('# Tracker\n\nno table here at all\n');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.includes('no tracker table found')));
});

test('pickTarget throws rather than reporting success when nothing parsed', () => {
  assert.throws(() => pickTarget('# Tracker\n\nno table\n'), /no tracker rows parsed/);
  assert.throws(() => pickTarget(''), /no tracker rows parsed/);
});

test('pickTarget throws for a group with no rows instead of reporting it complete', () => {
  assert.throws(() => pickTarget(TRACKER, 'F-09'), /no tracker rows in group F-09/);
});

// ── forbiddenStatusWrites ─────────────────────────────────────────────────────
//
// The agent writes its own row and the runner writes `done` on a judge verdict. Nothing deterministic
// checked what ELSE the agent wrote: check-scaffold.mjs has no tracker check, the runner's left-behind
// probe watches only `framework/`, and validateTable inspects the table's structure rather than the
// truth of its statuses. A turn that flipped an unrelated row to `done` passed every gate, and
// pickTarget skips a `done` row — the stage then reports complete with a task never built.

test('forbiddenStatusWrites reports nothing when the turn left the tracker alone', () => {
  assert.deepEqual(forbiddenStatusWrites(TRACKER, TRACKER, 'AC-F02-01'), []);
});

test('forbiddenStatusWrites allows the two endings the prompts offer a turn', () => {
  // `review` — "you finished and your gate was green"; `blocked` — "a question you have no right to
  // answer alone". Those are the only two words either prompt gives the agent.
  for (const ending of ['review', 'blocked']) {
    assert.deepEqual(forbiddenStatusWrites(TRACKER, setStatus(TRACKER, 'AC-F02-01', ending), 'AC-F02-01'), []);
  }
});

test('forbiddenStatusWrites allows a rework row to finish at review, or the loop could not rework anything', () => {
  // The correction to the obvious reading of "a judged row carries a verdict, so leave it alone". A
  // `rework` row is exactly the row the agent is sent BACK into: pickTarget returns it with phase
  // `agent` and the prompt tells that turn to end at `review`. Forbidding this would refuse every
  // second attempt at every row, and three refusals trip K_FAILURES. Measured: with `rework: []` in
  // AGENT_MAY_WRITE this test goes red, and so does the runner's own rework turn in ralph.test.mjs.
  assert.equal(parseRows(TRACKER).find((row) => row.id === 'AC-F01-02').status, 'rework');
  for (const ending of ['review', 'blocked']) {
    assert.deepEqual(forbiddenStatusWrites(TRACKER, setStatus(TRACKER, 'AC-F01-02', ending), 'AC-F01-02'), []);
  }
});

test('forbiddenStatusWrites refuses a turn that advanced a row other than its target', () => {
  // This test used to assert the opposite, on the evidence of a run where a turn delivered S2 and S3
  // together and both were accepted. That was luck. The next batch deadlocked: a turn delivered S6, S7
  // and S8 in one commit, the judge was asked about S6 and reported real defects in S7's and S8's
  // FILES, the agent's rework touched only those files — and the diff then contained no `UniqueData.cs`
  // at all. The judge's own words: "there is nothing in this diff by which S6 can be judged, and a row
  // moved to review by a commit that does not touch its files is not reviewable." Each further rework
  // moves the diff further from the target's work, so the row can never be judged again.
  //
  // The judge grades a DIFF. A diff spanning several rows cannot be attributed to one of them, which
  // is why design §6.2 says one row per turn and why this is a refusal rather than a preference.
  const batched = setStatus(setStatus(TRACKER, 'AC-F02-01', 'review'), 'AC-F02-02', 'review');
  assert.deepEqual(forbiddenStatusWrites(TRACKER, batched, 'AC-F02-01'), [
    { id: 'AC-F02-02', from: 'todo', to: 'review' },
  ]);
  // The target's own advance is still fine — only the passenger is refused.
  assert.deepEqual(
    forbiddenStatusWrites(TRACKER, setStatus(TRACKER, 'AC-F02-01', 'review'), 'AC-F02-01'),
    []
  );
});

test('forbiddenStatusWrites treats a row the RUNNER set to done as unchanged, not as tampering', () => {
  // The exact case observed in the run. The runner writes `done` at the end of an iteration and never
  // commits it, so the next turn finds that word already in the file and `git add -A` folds it into the
  // turn's own commit. The snapshot is read from the same file, after the runner wrote it, so `done`
  // is on BOTH sides and there is nothing to object to. A check that compared against the committed
  // tracker instead would refuse every second iteration of every run.
  const beside = setStatus(TRACKER, 'AC-F02-01', 'review');
  assert.equal(parseRows(TRACKER).find((row) => row.id === 'AC-F01-01').status, 'done');
  assert.deepEqual(forbiddenStatusWrites(TRACKER, beside, 'AC-F02-01'), []);
});

test('forbiddenStatusWrites refuses an agent-written done, and names the row and the transition', () => {
  // The accept-direction hole itself: `done` on a row nobody judged. pickTarget then skips it for the
  // rest of the run.
  assert.deepEqual(forbiddenStatusWrites(TRACKER, setStatus(TRACKER, 'AC-F02-02', 'done'), 'AC-F02-02'), [
    { id: 'AC-F02-02', from: 'todo', to: 'done' },
  ]);
  // From `rework` too — a row the judge has already rejected is not the turn's to accept.
  assert.deepEqual(forbiddenStatusWrites(TRACKER, setStatus(TRACKER, 'AC-F01-02', 'done'), 'AC-F01-02'), [
    { id: 'AC-F01-02', from: 'rework', to: 'done' },
  ]);
});

test('forbiddenStatusWrites refuses any rewrite of a row that already carries a verdict', () => {
  // `done` is the runner's word on an independent PASS; `blocked` holds a question a human is being
  // asked. Rewriting either rewrites history — including "helpfully" reopening them.
  for (const [id, from] of [['AC-F01-01', 'done']]) {
    for (const to of STATUSES.filter((status) => status !== from)) {
      assert.deepEqual(forbiddenStatusWrites(TRACKER, setStatus(TRACKER, id, to), id), [{ id, from, to }]);
    }
  }

  const blocked = setStatus(TRACKER, 'AC-F02-02', 'blocked');
  for (const to of STATUSES.filter((status) => status !== 'blocked')) {
    assert.deepEqual(forbiddenStatusWrites(blocked, setStatus(blocked, 'AC-F02-02', to), 'AC-F02-02'), [
      { id: 'AC-F02-02', from: 'blocked', to },
    ]);
  }
});

test('forbiddenStatusWrites refuses a rewrite of a row already waiting for the judge', () => {
  // A `review` row is one whose agent finished and whose judge has not run. Moving it back to `todo`
  // would hide finished work from the judge; moving it to `done` would grade it without one.
  const waiting = setStatus(TRACKER, 'AC-F02-01', 'review');
  assert.deepEqual(forbiddenStatusWrites(waiting, setStatus(waiting, 'AC-F02-01', 'todo'), 'AC-F02-01'), [
    { id: 'AC-F02-01', from: 'review', to: 'todo' },
  ]);
  assert.deepEqual(forbiddenStatusWrites(waiting, setStatus(waiting, 'AC-F02-01', 'done'), 'AC-F02-01'), [
    { id: 'AC-F02-01', from: 'review', to: 'done' },
  ]);
});

test('forbiddenStatusWrites reports every offending row, not only the first', () => {
  const twice = setStatus(setStatus(TRACKER, 'AC-F02-01', 'done'), 'AC-F01-01', 'todo');
  assert.deepEqual(forbiddenStatusWrites(TRACKER, twice, 'AC-F02-01'), [
    { id: 'AC-F01-01', from: 'done', to: 'todo' },
    { id: 'AC-F02-01', from: 'todo', to: 'done' },
  ]);
});

test('forbiddenStatusWrites reports a row that vanished or appeared', () => {
  // validateTable's `**Total:**` cross-check catches most of this, but only while the declared total is
  // left alone — a turn that deletes a row AND edits the total walks through it, and a deleted row is a
  // task nobody ever builds. `to: null` and `from: null` also tell the runner these two cannot be put
  // back the way a changed status can.
  const LAST = '| AC-F02-02 | F-02 | an added pet appears in the clinic-wide list | todo |\n';
  const removed = TRACKER.replace(LAST, '').replace('**Total:** 4 rows.', '**Total:** 3 rows.');
  assert.deepEqual(forbiddenStatusWrites(TRACKER, removed, 'AC-F02-02'), [
    { id: 'AC-F02-02', from: 'todo', to: null },
  ]);

  const added = TRACKER.replace(LAST, `${LAST}| AC-F02-03 | F-02 | invented by the turn | done |\n`);
  assert.deepEqual(forbiddenStatusWrites(TRACKER, added, 'AC-F02-01'), [
    { id: 'AC-F02-03', from: null, to: 'done' },
  ]);
});

test('forbiddenStatusWrites reads CRLF on both sides, so a Windows checkout is not a blanket refusal', () => {
  // parseRows needs its trailing `\s*` for CRLF; without it the real trackers parse to ZERO rows. Here
  // that would make every row look as though it had vanished and then reappeared — a run that refuses
  // its first turn and every one after it.
  const crlf = TRACKER.split('\n').join('\r\n');
  assert.deepEqual(forbiddenStatusWrites(crlf, crlf, 'AC-F02-01'), []);
  assert.deepEqual(forbiddenStatusWrites(crlf, setStatus(crlf, 'AC-F02-01', 'review'), 'AC-F02-01'), []);
  assert.deepEqual(forbiddenStatusWrites(crlf, setStatus(crlf, 'AC-F02-01', 'done'), 'AC-F02-01'), [
    { id: 'AC-F02-01', from: 'todo', to: 'done' },
  ]);
});
