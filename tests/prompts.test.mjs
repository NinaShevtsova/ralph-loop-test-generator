// tests/prompts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const read = (name) => readFileSync(join(ROOT, 'loop', name), 'utf8');

test('the scaffold prompt tells the agent the turn is cold and state lives on disk', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /one turn/i);
  assert.match(text, /on disk/i);
});

test('the scaffold prompt forbids writing done and requires review', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /`review`/);
  assert.ok(/never.*`done`|`done`.*runner/is.test(text), 'must state that only the runner writes done');
});

test('the scaffold prompt names the gate commands', () => {
  const text = read('PROMPT.scaffold.md');
  for (const command of ['scripts/check-scaffold.mjs', 'dotnet build', 'npm run sut -- reset', 'dotnet test']) {
    assert.ok(text.includes(command), `missing gate command: ${command}`);
  }
  // The wave flag is the whole point: an unscoped manifest check is red until the last wave, and the
  // runner reads a red gate as a reason to stop. A prompt that omits it teaches the agent to run a
  // check that cannot pass.
  assert.match(text, /--through-wave/);
});

test('both prompts explain the rework state the runner sends them', () => {
  // The runner writes `rework` and appends judge findings stage-agnostically, so a prompt that never
  // mentions it hands the agent an input it has no instruction for.
  for (const file of ['PROMPT.scaffold.md', 'PROMPT.tests.md']) {
    const text = read(file);
    assert.match(text, /rework/, `${file} never mentions rework`);
    assert.ok(/findings/.test(text), `${file} never mentions the judge's findings`);
  }
});

test('the scaffold prompt carries the blocked escape hatch', () => {
  assert.match(read('PROMPT.scaffold.md'), /`blocked`/);
});

test('the scaffold prompt requires a journal entry even on a turn with no progress', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /JOURNAL\.md/);
  assert.match(text, /no progress/i);
});

test('the scaffold prompt forbids push and branch switching', () => {
  const text = read('PROMPT.scaffold.md');
  assert.match(text, /git push/);
  assert.ok(/checkout|switch/.test(text), 'must forbid branch switching');
});
test('the tests prompt forbids reading the openapi contract — D-16', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /openapi\.yaml/);
  assert.ok(/do not read|forbidden|never read/i.test(text), 'must forbid reading the contract');
});

test('the tests prompt makes the step inventory mandatory reading', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /loop\/STEPS\.md/);
  assert.ok(/before writing any step|mandatory/i.test(text), 'STEPS.md must be mandatory reading');
});

test('the tests prompt requires exactly one scenario per turn', () => {
  assert.match(read('PROMPT.tests.md'), /exactly one/i);
});

test('the tests prompt names the fence: only Features, StepDefinitions, Data', () => {
  const text = read('PROMPT.tests.md');
  for (const dir of ['Features/', 'StepDefinitions/', 'Data/']) {
    assert.ok(text.includes(dir), `missing fenced directory: ${dir}`);
  }
});

test('the tests prompt forbids done and requires review', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /`review`/);
  assert.ok(/never.*`done`|`done`.*runner/is.test(text), 'must state that only the runner writes done');
});

test('the tests prompt names the AC commit trailer', () => {
  assert.match(read('PROMPT.tests.md'), /AC:\s*AC-F/);
});

test('the tests prompt forbids Scenario Outline', () => {
  assert.match(read('PROMPT.tests.md'), /Scenario Outline/);
});

test('the tests prompt requires the gate to run the whole suite', () => {
  const text = read('PROMPT.tests.md');
  assert.match(text, /dotnet test/);
  assert.ok(/whole suite|all scenarios|every scenario/i.test(text), 'must require the full suite');
});

// ── B1: the gate is ordered before the commit, and the prompt says why ────────────────
//
// These assert the ORDERING and the REASON, not that the words appear. The mutation review replaced
// the whole of this file with a nine-line bag of the tokens its tests grep for and all 278 tests
// still passed; a keyword pin on a prompt proves the vocabulary is present, not that any instruction
// survives.

test('the tests prompt runs check-tests.mjs BEFORE the commit, in that order on the page', () => {
  // `check-tests.mjs` reads the union of the working tree and everything committed since `--base`,
  // which defaults to `HEAD`. Uncommitted, that union is exactly the turn's own files — measured, the
  // agent's pre-commit run exits 0 with 15 checks. The prompt's step 4 also forbids committing with a
  // red gate, so an ordering that put the check after the commit would leave the agent's only legal
  // moves `blocked` or disobedience.
  const text = read('PROMPT.tests.md');
  const gate = text.indexOf('scripts/check-tests.mjs');
  const commit = text.indexOf('commit **once**');
  assert.ok(gate !== -1, 'the prompt must name the gate command');
  assert.ok(commit !== -1, 'the prompt must name the commit step');
  assert.ok(gate < commit, 'the gate command must be ordered before the commit, not after it');
});

test('the tests prompt says the gate reads the working tree, so the agent knows why the order matters', () => {
  // A bare ordering is a rule to be broken under pressure; the reason is what survives a rewrite. And
  // an agent that re-runs the same command after committing sees `the turn changed nothing since
  // HEAD` — a red gate on a correct turn — with nothing to tell it that is not a verdict on its work.
  const text = read('PROMPT.tests.md');
  assert.ok(
    /before the commit, not after/i.test(text),
    'the prompt must say the check runs before the commit'
  );
  assert.ok(/working tree/i.test(text), 'and that the check reads the working tree');
  assert.ok(
    /changed nothing since/i.test(text),
    'and what the same command answers once the work is committed'
  );
});

test('the tests prompt still forbids committing with a red gate', () => {
  // The other half of the ordering: the check is worth nothing if a red result may be committed over.
  assert.ok(/committing with a red gate/i.test(read('PROMPT.tests.md')));
});
