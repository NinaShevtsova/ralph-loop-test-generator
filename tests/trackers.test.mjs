// tests/trackers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';
import { parseRows, countByStatus, pickTarget, validateTable } from '../loop/tracker.mjs';

const ROOT = repoRoot(import.meta.url);
const scaffold = () => readFileSync(join(ROOT, 'loop/trackers/scaffold.md'), 'utf8');

test('the scaffold tracker parses into exactly 14 rows', () => {
  assert.equal(parseRows(scaffold()).length, 14);
});

test('the scaffold tracker starts with everything todo', () => {
  assert.deepEqual(countByStatus(scaffold()), { todo: 14, review: 0, rework: 0, blocked: 0, done: 0 });
});

test('scaffold ids are S1..S14 in order', () => {
  const ids = parseRows(scaffold()).map((row) => row.id);
  assert.deepEqual(ids, Array.from({ length: 14 }, (_, i) => `S${i + 1}`));
});

test('scaffold groups are wave-1..wave-8 and never go backwards', () => {
  const waves = parseRows(scaffold()).map((row) => Number(row.group.replace('wave-', '')));
  assert.equal(Math.min(...waves), 1);
  assert.equal(Math.max(...waves), 8);
  for (let i = 1; i < waves.length; i += 1) {
    assert.ok(waves[i] >= waves[i - 1], `wave went backwards at row ${i}: ${waves[i - 1]} then ${waves[i]}`);
  }
});

test('every scaffold wave from 1 to 8 has at least one task', () => {
  const waves = new Set(parseRows(scaffold()).map((row) => row.group));
  for (let n = 1; n <= 8; n += 1) assert.ok(waves.has(`wave-${n}`), `wave-${n} has no task`);
});

test('the first scaffold target is S1 and needs an agent turn', () => {
  const target = pickTarget(scaffold());
  assert.equal(target.row.id, 'S1');
  assert.equal(target.phase, 'agent');
});

test('the scaffold tracker passes the validation the runner runs on every read', () => {
  // The runner validates on EVERY tracker read, so a tracker that fails this stops the loop at
  // startup. That makes it a property of the file, not of the parser, and it belongs here: the
  // details sections below the table, and the two-column table inside S14, must not be mistaken for
  // data rows, and the `**Total:**` line must agree with the row count.
  const verdict = validateTable(scaffold());
  assert.deepEqual(verdict, { ok: true, problems: [] }, `problems: ${JSON.stringify(verdict.problems)}`);
});

test('every scaffold task has a details section naming its files', () => {
  const text = scaffold();
  for (const row of parseRows(text)) {
    assert.match(text, new RegExp(`### ${row.id} —`), `no details section for ${row.id}`);
  }
});

const tests = () => readFileSync(join(ROOT, 'loop/trackers/tests.md'), 'utf8');

test('the tests tracker parses into exactly 20 rows', () => {
  assert.equal(parseRows(tests()).length, 20);
});

test('the tests tracker starts with everything todo', () => {
  assert.deepEqual(countByStatus(tests()), { todo: 20, review: 0, rework: 0, blocked: 0, done: 0 });
});

test('the tests tracker holds 4 + 10 + 6 rows grouped by flow, in that order', () => {
  const groups = parseRows(tests()).map((row) => row.group);
  assert.deepEqual(groups.slice(0, 4), Array(4).fill('F-01'));
  assert.deepEqual(groups.slice(4, 14), Array(10).fill('F-02'));
  assert.deepEqual(groups.slice(14, 20), Array(6).fill('F-03'));
});

test('AC ids are well formed, unique and sequential inside each flow', () => {
  const ids = parseRows(tests()).map((row) => row.id);
  assert.equal(new Set(ids).size, 20);
  for (const id of ids) assert.match(id, /^AC-F0[123]-\d{2}$/);
  assert.equal(ids[0], 'AC-F01-01');
  assert.equal(ids[4], 'AC-F02-01');
  assert.equal(ids[14], 'AC-F03-01');
  assert.equal(ids[19], 'AC-F03-06');
});

test('the first tests target is AC-F01-01 — the exemplar', () => {
  const target = pickTarget(tests());
  assert.equal(target.row.id, 'AC-F01-01');
  assert.equal(target.phase, 'agent');
});

test('the --flow filter selects the first row of that flow', () => {
  assert.equal(pickTarget(tests(), 'F-02').row.id, 'AC-F02-01');
  assert.equal(pickTarget(tests(), 'F-03').row.id, 'AC-F03-01');
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
  assert.equal(parseRows(withQuestion).length, 20, 'a table-shaped question must not add a row');
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
