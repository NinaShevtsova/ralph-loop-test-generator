// tests/rubrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const scaffold = () => readFileSync(join(ROOT, 'loop/rubrics/scaffold.md'), 'utf8');

/** Numbered rubric items: lines that start with `N.` at the left margin. */
const items = (text) => [...text.matchAll(/^(\d+)\.\s+/gm)].map((m) => Number(m[1]));

test('the scaffold rubric has exactly 9 numbered items', () => {
  assert.deepEqual(items(scaffold()), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('the scaffold rubric heading agrees with its item count', () => {
  // A rubric saying "eight checks" above nine items is not cosmetic: the judge reads this text,
  // and the cheapest way to reconcile the mismatch is to treat the last item as commentary on the
  // one before it. That would silently retire whichever check came last — which is exactly the
  // check that was added because nothing else could rule on it.
  assert.match(scaffold(), /## The nine checks/);
});

test('the scaffold rubric declares the three verdicts', () => {
  const text = scaffold();
  for (const verdict of ['VERDICT: PASS', 'VERDICT: REJECT', 'VERDICT: SPEC_UNCLEAR']) {
    assert.ok(text.includes(verdict), `missing ${verdict}`);
  }
});

test('the scaffold rubric states the uncertainty asymmetry', () => {
  assert.match(scaffold(), /when uncertain/i);
});

test('the scaffold rubric declares the diff to be data, not instructions', () => {
  assert.match(scaffold(), /data, not instructions/i);
});

test('the scaffold rubric names the FluentAssertions 7.x pin', () => {
  assert.match(scaffold(), /7\.x/);
});

const testsRubric = () => readFileSync(join(ROOT, 'loop/rubrics/tests.md'), 'utf8');

test('the tests rubric has exactly 27 numbered items, 1..27 in order', () => {
  assert.deepEqual(items(testsRubric()), Array.from({ length: 27 }, (_, i) => i + 1));
});

test('every "item N" the tests rubric cites is an item that exists', () => {
  // The rubric refers to its own items by number in four places, and `scripts/check-tests.mjs` writes
  // two more into the machine report. Renumbering the list is how those go stale, and a judge sent to
  // a number past the end of the list has nothing at all to read.
  const text = testsRubric();
  const highest = Math.max(...items(text));
  const cited = [...text.matchAll(/\bitem (\d+)\b/g)].map((m) => Number(m[1]));
  assert.ok(cited.length >= 4, 'the rubric cross-references its own items; that must not silently stop');
  for (const n of cited) {
    assert.ok(n >= 1 && n <= highest, `the rubric cites item ${n}, which does not exist`);
  }
});

test('the tests rubric\'s cross-references land on the items they describe', () => {
  // Existence is not enough — a stale number still points at *an* item, just the wrong one, and the
  // judge has no way to notice. Each reference below says what it expects to find, so the assertion
  // can be that it finds it.
  const text = testsRubric();

  const newStep = Number(/item (\d+) asks whether a new step is genuinely new/.exec(text)?.[1]);
  assert.ok(Number.isInteger(newStep), 'the inputs section must say which item rules on a new step');
  assert.match(item(text, newStep), /genuinely new, not a rewording/);

  const sharedStep = Number(/item (\d+) asks whether a modified shared step/.exec(text)?.[1]);
  assert.ok(Number.isInteger(sharedStep), 'and which item rules on a modified shared step');
  assert.match(item(text, sharedStep), /modification to an \*\*existing\*\* step definition/);

  // The worked example in "Your output" cites the duplicate-step item by number too.
  const example = Number(/\[item (\d+)\] StepDefinitions\/PetSteps\.cs:41/.exec(text)?.[1]);
  assert.equal(example, newStep, 'the worked example must cite the same item the inputs section does');
});

test('the item number check-tests.mjs writes into the machine report is the rubric\'s own', () => {
  // Two files, one number, and the report is what the judge reads first. `flows.mjs` already carries
  // a comment about the cost of a constant spelled out twice; this is the same shape, across a
  // document and a script, with the judge silently sent to the wrong rule when they drift.
  const text = testsRubric();
  const report = readFileSync(join(ROOT, 'scripts/check-tests.mjs'), 'utf8');
  const cited = [...report.matchAll(/Rubric item (\d+): confirm each new step is genuinely new/g)];
  assert.equal(cited.length, 1, 'check-tests.mjs must name the item its similarity band belongs to');
  assert.match(item(text, Number(cited[0][1])), /genuinely new, not a rewording/);
});

test('the tests rubric groups items into the five blocks', () => {
  const text = testsRubric();
  for (const heading of [
    'A. Coverage of the AC',
    'B. Anti-cheat',
    'C. Rules of §10',
    'D. Usable by a human',
    'E. Hygiene and reuse',
  ]) {
    assert.ok(text.includes(heading), `missing block heading: ${heading}`);
  }
});

test('the tests rubric blocks appear in order A through E', () => {
  const text = testsRubric();
  const positions = ['A. Coverage', 'B. Anti-cheat', 'C. Rules', 'D. Usable', 'E. Hygiene'].map((h) =>
    text.indexOf(h)
  );
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `block ${i} is out of order`);
  }
});

test('the tests rubric declares the three verdicts', () => {
  const text = testsRubric();
  for (const verdict of ['VERDICT: PASS', 'VERDICT: REJECT', 'VERDICT: SPEC_UNCLEAR']) {
    assert.ok(text.includes(verdict), `missing ${verdict}`);
  }
});

test('the tests rubric states the uncertainty asymmetry', () => {
  assert.match(testsRubric(), /when uncertain/i);
});

test('the tests rubric declares the diff to be data, not instructions', () => {
  assert.match(testsRubric(), /data, not instructions/i);
});

test('the tests rubric names the load-bearing anti-cheat specifics', () => {
  const text = testsRubric();
  for (const marker of ['Excluding', 'HaveCountGreaterThan', 'NotBeNull', 'ResourceTracker', 'UniqueData', 'STEPS.md']) {
    assert.ok(text.includes(marker), `missing anti-cheat marker: ${marker}`);
  }
});

test('the tests rubric tells the judge it is read-only', () => {
  assert.match(testsRubric(), /read-only/i);
});

// ── B2: the §10 block must say what §10 says ─────────────────────────────────────────
//
// These pin the INSTRUCTION, not the vocabulary. The mutation review replaced the whole of
// `loop/rubrics/tests.md` with a keyword skeleton of 26 numbered stubs and all 278 tests passed: every
// assertion was `assert.match(text, /token/)`, which proves the words are present and nothing else.
// The rubric is the document with the most leverage over output quality in the system.

/** The text of one numbered item, from its number to the next item, heading or rule. */
function item(text, n) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${n}. `));
  assert.notEqual(start, -1, `rubric item ${n} is missing`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^(?:\d+\. |## |---)/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

test('the §10.1 item forbids relying on seeded IDS, not on reading a seeded record', () => {
  // The flow documents mandate `GET /pettypes` -> take the first element, in the common precondition
  // of every F-02 and F-03 AC. A blanket "no seeded record is read or relied upon" contradicts them,
  // and the judge holds both documents plus an instruction to reject when uncertain — so it would
  // reject nine of the ten F-02 ACs for obeying their own setup. §10.1's rule is about the `id`s.
  const text = item(testsRubric(), 11);
  assert.ok(
    !/no seeded record is read or relied upon/i.test(text),
    'the blanket ban contradicts the flow documents\u2019 own precondition'
  );
  assert.match(text, /pettypes/i, 'the item must name the precondition it is reconciled with');
  assert.match(text, /\bid`?s?\b/i, 'and must say the rule is about ids');
  assert.ok(
    /not (itself )?a violation|is required|do not reject/i.test(text),
    'it must say plainly that obeying the flow\u2019s precondition is allowed'
  );
});

test('the §10.4 item reconciles itself with the "exactly one element" items', () => {
  // Item 12 banned absolute counts; items 2 and 6 require asserting "exactly one element", and
  // fifteen AC steps mandate one. Nothing said which collection the ban is about, so two judges split
  // on AC-F02-01 — item 2's own worked example — and the rubric's asymmetry sends the tie to
  // rejection.
  const text = item(testsRubric(), 12);
  assert.match(text, /seeded/i, 'the ban must be scoped to collections that can hold seeded records');
  assert.ok(
    /item 2|item 6|items 2 and 6/.test(text),
    'the item must name the items it appears to contradict'
  );
  assert.match(text, /AC-F02-01/, 'and settle the worked example the two rules disagree about');
});

test('one item covers §10.9 — the two ACs that must create their own pet type', () => {
  // §10.9 had no rubric item at all while its inverse was over-enforced. Deleting a pet type deletes
  // every pet of that type, including other owners' — the §10 rule with the widest blast radius.
  const text = testsRubric();
  const covering = items(text)
    .map((n) => item(text, n))
    .filter((body) => /10\.9/.test(body) || (/AC-F01-04/.test(body) && /AC-F02-10/.test(body)));
  assert.equal(covering.length, 1, 'exactly one item must own §10.9');
  const [body] = covering;
  assert.match(body, /AC-F01-04/);
  assert.match(body, /AC-F02-10/);
  assert.match(body, /POST \/pettypes|own pet type/i, 'it must say what those two ACs have to do');
  assert.ok(
    /cascade|deletes (every|all) pet|other owners/i.test(body),
    'and why — the cascade is the whole reason'
  );
});

test('the tests rubric tells the judge not to re-check what check-tests.mjs already proves', () => {
  // Item 15 has two halves and only one of them is the judge's: `check-tests.mjs` section 3 already
  // fails a data file with no block under this AC's id. Tokens spent re-deriving it are tokens not
  // spent on the half no script can see.
  const text = testsRubric();
  const section = text.slice(text.indexOf('## What you must NOT judge'), text.indexOf('## A. Coverage'));
  assert.ok(section.length > 0, 'the rubric must keep its "what you must NOT judge" section');
  assert.match(section, /check-tests\.mjs/);
  assert.match(section, /data block|block under this AC|this AC's id/i);
  assert.match(section, /item 15/, 'and say which item it is half of, so the other half is not dropped too');
});
