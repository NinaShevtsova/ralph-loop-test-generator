// tests/trackers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';
import { parseRows, countByStatus, pickTarget, validateTable } from '../loop/tracker.mjs';
import { FLOW_GROUPS, flowDocPath, flowGroupOfAc } from '../scripts/flows.mjs';

const ROOT = repoRoot(import.meta.url);

/**
 * Every acceptance criterion the flow documents declare, read from their Test plan tables.
 *
 * `scripts/check-tests.mjs` finds a scenario's expected title with the same shape — a backticked
 * `AC-Fxx-yy: <title>` inside the flow document — so this reads the list the gate itself works from.
 */
function declaredAcs() {
  const found = [];
  for (const group of Object.keys(FLOW_GROUPS)) {
    const text = readFileSync(join(ROOT, flowDocPath(group)), 'utf8');
    for (const [, id] of text.matchAll(/`(AC-F\d{2}-\d{2}):\s*[^`]+`/g)) found.push(id);
  }
  return found;
}

const scaffold = () => readFileSync(join(ROOT, 'loop/trackers/scaffold.md'), 'utf8');

/*
 * Properties, not today's numbers.
 *
 * Every assertion in this file used to pin the shape as it stood — 14 rows, 20 rows, 4 + 10 + 6,
 * `ids[19] === 'AC-F03-06'`. Four of them went red during the run for no reason except that the loop
 * was working, and each was diagnosed mid-flight. They would go red again the day an acceptance
 * criterion is added, which is a thing the design is meant to make cheap.
 *
 * What replaces them holds for any number of rows: the tracker covers exactly what the flow documents
 * declare, the tally loses nobody, rows are grouped the way the runner slices them, and an id names
 * the flow of its own row.
 */
test('every scaffold row has a details section, and every details section has a row', () => {
  const text = scaffold();
  const rows = parseRows(text).map((row) => row.id);
  assert.ok(rows.length > 0, 'a tracker with no rows makes pickTarget throw');

  const sections = [...text.matchAll(/^### (S\d+) —/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...rows].sort(),
    [...sections].sort(),
    'a row without a section has no file list; a section without a row is work nobody will do'
  );
});

/*
 * The counts must ADD UP, not be a particular set of numbers.
 *
 * This asserted `{ todo: 14, done: 0 }` — true of a fresh checkout and false from the first accepted
 * turn onwards. It went red once the loop had built five rows, which is the file working, and a test
 * that fails because the thing it watches is succeeding teaches the next reader to ignore it. The
 * mutation review named this class: an earlier test asserted `20 todo` against the live tests tracker
 * for the same reason.
 *
 * What is true of this file forever is that every row carries one of the five known statuses and none
 * is lost in the tally — which is what the runner's progress metric actually depends on.
 */
test('every scaffold row is in a known status, and the tally loses none of them', () => {
  const counts = countByStatus(scaffold());
  assert.deepEqual(Object.keys(counts).sort(), ['blocked', 'done', 'review', 'rework', 'todo']);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const rows = parseRows(scaffold()).length;
  assert.equal(total, rows, `the tally sums to ${total} but the table has ${rows} rows`);
});

test('scaffold ids are S1..Sn in order, with no gaps', () => {
  const ids = parseRows(scaffold()).map((row) => row.id);
  assert.deepEqual(ids, Array.from({ length: ids.length }, (_, i) => `S${i + 1}`));
});

test('scaffold waves never go backwards down the table', () => {
  // Order, not count. pickTarget walks the table top to bottom, so a wave that went backwards would
  // send a turn to build on a wave that has not been built yet.
  const waves = parseRows(scaffold()).map((row) => Number(row.group.replace('wave-', '')));
  for (let i = 1; i < waves.length; i += 1) {
    assert.ok(waves[i] >= waves[i - 1], `wave went backwards at row ${i}: ${waves[i - 1]} then ${waves[i]}`);
  }
});

test('scaffold waves run from 1 upwards with no empty wave in between', () => {
  // A gap would make preGateSteps ask for `--through-wave N - 1` on a wave nobody builds.
  const waves = [...new Set(parseRows(scaffold()).map((row) => Number(row.group.replace('wave-', ''))))];
  assert.deepEqual(waves, Array.from({ length: waves.length }, (_, i) => i + 1));
});

/*
 * Same reason: this asserted the target is `S1`, which stops being true the moment S1 is accepted.
 * `pickTarget`'s ordering is pinned properly against fixtures in `tracker.test.mjs`; what belongs
 * here is that the LIVE file always yields something the runner can act on — a real row, in a phase
 * the loop knows, never a target that is already finished.
 */
test('the live scaffold tracker always yields an actionable target, or none because it is finished', () => {
  const target = pickTarget(scaffold());
  if (target === null) {
    const rows = parseRows(scaffold());
    assert.equal(countByStatus(scaffold()).done, rows.length, 'no target, so every row must be done');
    return;
  }
  assert.ok(['agent', 'judge', 'blocked'].includes(target.phase), `unknown phase ${target.phase}`);
  assert.notEqual(target.row.status, 'done', 'pickTarget returned a row that is already finished');
  assert.ok(
    parseRows(scaffold()).some((row) => row.id === target.row.id),
    'the target is not a row of this table'
  );
});

test('the scaffold tracker passes the validation the runner runs on every read', () => {
  // The runner validates on EVERY tracker read, so a tracker that fails this stops the loop at
  // startup. That makes it a property of the file, not of the parser, and it belongs here: the
  // details sections below the table, and the two-column table inside S14, must not be mistaken for
  // data rows, and the `**Total:**` line must agree with the row count.
  const verdict = validateTable(scaffold());
  assert.deepEqual(verdict, { ok: true, problems: [] }, `problems: ${JSON.stringify(verdict.problems)}`);
});

const tests = () => readFileSync(join(ROOT, 'loop/trackers/tests.md'), 'utf8');

test('the tests tracker covers exactly the acceptance criteria the flow documents declare', () => {
  // The invariant that matters, and the one nothing checked before: a criterion with no row is never
  // generated, and a row with no criterion sends a turn to read a flow document that does not
  // describe it. Both are silent — the runner reports a finished stage either way.
  const rows = parseRows(tests()).map((row) => row.id);
  const declared = declaredAcs();

  assert.ok(declared.length > 0, 'no Test plan entries found — the extraction itself is broken');
  assert.deepEqual(
    [...rows].sort(),
    [...declared].sort(),
    'the tracker and the flow documents disagree about which criteria exist'
  );
});

/*
 * Fixed here BEFORE it broke, unlike its scaffold twin. This asserted `{ todo: 20 }`, which goes red
 * on the first accepted acceptance criterion — the same defect, waiting for stage 1 to start. The
 * scaffold version was left until the loop actually made progress and then had to be diagnosed
 * mid-run, which is the more expensive way to learn it.
 */
test('every tests row is in a known status, and the tally loses none of them', () => {
  const counts = countByStatus(tests());
  assert.deepEqual(Object.keys(counts).sort(), ['blocked', 'done', 'review', 'rework', 'todo']);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const rows = parseRows(tests()).length;
  assert.equal(total, rows, `the tally sums to ${total} but the table has ${rows} rows`);
});

test('tests rows are contiguous per flow, in the order scripts/flows.mjs declares', () => {
  // Contiguity is what makes `--flow` a slice rather than a filter: pickTarget walks the table in file
  // order, so interleaved rows would have a run jump between flows mid-slice.
  const groups = parseRows(tests()).map((row) => row.group);
  const firstAppearance = [...new Set(groups)];

  assert.deepEqual(
    firstAppearance,
    Object.keys(FLOW_GROUPS).filter((group) => groups.includes(group)),
    'flows appear in an order flows.mjs does not declare'
  );
  for (const group of firstAppearance) {
    const at = groups.map((g, i) => (g === group ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(at, Array.from({ length: at.length }, (_, i) => at[0] + i), `${group} is interleaved`);
  }
});

test('every AC id names the flow of its own row, and numbering runs from 01 with no gaps', () => {
  const rows = parseRows(tests());
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'duplicate AC id');

  for (const row of rows) {
    assert.match(row.id, /^AC-F\d{2}-\d{2}$/, `${row.id} is not a well-formed AC id`);
    // The id is the ONLY link between a scenario and its data: TestDataProvider derives the flow from
    // it, and check-tests.mjs derives the feature and data files the same way. An id whose flow part
    // disagrees with its row's group sends both to the wrong file.
    assert.equal(flowGroupOfAc(row.id), row.group, `${row.id} sits in group ${row.group}`);
  }

  for (const group of new Set(rows.map((row) => row.group))) {
    const numbers = rows.filter((row) => row.group === group).map((row) => Number(row.id.slice(-2)));
    assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1), `${group} numbering`);
  }
});

/*
 * The THIRD and fourth instances of the same defect, found only when the loop finished.
 *
 * These asserted that the live tracker's first target is `AC-F01-01` and that `--flow F-02` selects
 * `AC-F02-01` — true of a fresh checkout, false from the first accepted criterion, and finally red
 * once all twenty were done and `pickTarget` began returning null. Two others in this file were fixed
 * for exactly this reason earlier; nobody looked for the rest, which is the difference between fixing
 * a class and fixing an instance, written down twice and then demonstrated a third time.
 *
 * `pickTarget`'s ordering belongs in `tracker.test.mjs`, against fixtures whose statuses are chosen by
 * the test. What is true of the live file forever is that the slice filter never leaves its slice.
 */
test('the --flow filter never selects a row outside its flow', () => {
  for (const flow of ['F-01', 'F-02', 'F-03']) {
    const target = pickTarget(tests(), flow);
    if (target === null) {
      const rows = parseRows(tests()).filter((row) => row.group === flow);
      assert.ok(rows.length > 0, `${flow} has no rows at all`);
      assert.ok(rows.every((row) => row.status === 'done'), `${flow} yielded no target but is not finished`);
      continue;
    }
    assert.equal(target.row.group, flow, `--flow ${flow} selected a row from ${target.row.group}`);
    assert.notEqual(target.row.status, 'done', 'pickTarget returned a row that is already finished');
  }
});

test('every flow the tracker names is one the runner knows', () => {
  // The tracker and FLOW_GROUPS must agree, or `--flow` on a real group throws rather than filtering.
  const groups = new Set(parseRows(tests()).map((row) => row.group));
  for (const group of groups) {
    assert.ok(FLOW_GROUPS[group], `the tracker names ${group}, which flows.mjs does not know`);
  }
});

test('the tests tracker passes the validation the runner runs on every read', () => {
  const verdict = validateTable(tests());
  assert.deepEqual(verdict, { ok: true, problems: [] }, `problems: ${JSON.stringify(verdict.problems)}`);
});

test('the Open questions section cannot be mistaken for tracker rows', () => {
  // The agent and the runner write free text into that section while the loop is running, so it is the
  // one part of this file that changes shape unpredictably. A four-column line there whose last cell
  // read like a status used to become a phantom row and corrupt the metric.
  const withQuestion = tests().replace(
    '_None._',
    '| AC-F02-03 | F-02 | needs a decision on the shared pet type | blocked |'
  );
  const before = parseRows(tests()).length;
  assert.equal(parseRows(withQuestion).length, before, 'a table-shaped question must not add a row');
  assert.equal(validateTable(withQuestion).ok, true, 'nor make the file invalid');
  assert.equal(countByStatus(withQuestion).blocked, 0, 'nor change the metric');
});

test('every tracker title appears in that flow Test plan table', () => {
  const flowFile = {
    'F-01': 'F-01-owner-lifecycle.md',
    'F-02': 'F-02-owner-pet-lifecycle.md',
    'F-03': 'F-03-pet-visit-flow.md',
  };
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  for (const row of parseRows(tests())) {
    const doc = readFileSync(join(ROOT, 'docs/specs/petclinic/flows', flowFile[row.group]), 'utf8');
    const planned = new RegExp(String.raw`\`${row.id}:\s*([^\`]+)\``).exec(doc)?.[1];
    assert.ok(planned, `${row.id}: no Test plan row found in ${flowFile[row.group]}`);
    assert.equal(
      norm(row.title),
      norm(planned),
      `${row.id}: tracker title diverges from the Test plan table`
    );
  }
});

// ── Why the runner's "did this turn commit the work?" test is scoped to stage 1 ────────
//
// The runner asks, for stage `tests` only, whether the committed diff mentions the target row id.
// It cannot ask that for stage 0, and this is the measurement that says why — so that a later rename
// of the scaffold ids forces someone to revisit the scoping instead of silently making it possible.

test('stage-1 row ids are long enough to search a diff for', () => {
  for (const row of parseRows(tests())) {
    assert.match(row.id, /^AC-F\d{2}-\d{2}$/, `${row.id} is not the AC-Fxx-yy shape the check relies on`);
    // The id is a Gherkin tag and a JSON key, so it cannot be absent from an honest turn, and it is
    // specific enough that its presence in a diff means something.
    assert.equal(row.id.length, 9);
  }
  const ids = parseRows(tests()).map((row) => row.id);
  const prefixes = ids.filter((a) => ids.some((b) => b !== a && b.startsWith(a)));
  assert.deepEqual(prefixes, [], 'no stage-1 id may be a prefix of another, or a match would be ambiguous');
});

test('stage-0 row ids are NOT, which is why the same check is not applied to them', () => {
  const ids = parseRows(scaffold()).map((row) => row.id);
  // Two characters. Searching a diff for `S1` would match `S10`..`S14`, and any two-character run in
  // ordinary code or prose besides.
  assert.equal(Math.min(...ids.map((id) => id.length)), 2);
  const prefixes = ids.filter((a) => ids.some((b) => b !== a && b.startsWith(a)));
  assert.deepEqual(
    prefixes,
    ['S1'],
    'S1 is a prefix of S10..S14 — a diff-mentions-the-id test would be a coin flip for stage 0'
  );
});
