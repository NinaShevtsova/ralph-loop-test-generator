// tests/rubrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';
import { isWellFormed, parseVerdict, VERDICTS } from '../loop/verdict.mjs';

const ROOT = repoRoot(import.meta.url);
const scaffold = () => readFileSync(join(ROOT, 'loop/rubrics/scaffold.md'), 'utf8');
const conventions = () =>
  readFileSync(join(ROOT, 'docs/specs/petclinic/context-and-conventions.md'), 'utf8');

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

// ── T1: pinned by structure and by instruction, not by vocabulary ─────────────
//
// The mutation review replaced the whole of `loop/rubrics/tests.md` — 209 lines — with a keyword
// skeleton of numbered stubs, and the suite stayed green: every assertion was `assert.match(text,
// /token/)`, which proves a word is somewhere in the file and nothing more. This document and
// `loop/PROMPT.tests.md` are what made every judge rejection in this run possible, and they had the
// least real coverage in the suite.
//
// What follows pins what a skeleton cannot fake: which items live in which block, that every spec
// section the rubric cites resolves in the spec, that the verdict contract parses with the runner's
// own parser outside any fence, and that each of the 27 items states its rule rather than its
// keyword. The acceptance test for this work is that a keyword skeleton goes red.

/** The blocks, and exactly which item numbers belong to each. */
const BLOCKS = {
  'A. Coverage of the AC': [1, 2, 3, 4],
  'B. Anti-cheat — green about nothing': [5, 6, 7, 8, 9, 10],
  'C. Rules of §10': [11, 12, 13, 14, 15, 16, 17],
  'D. Usable by a human': [18, 19, 20, 21, 22],
  'E. Hygiene and reuse': [23, 24, 25, 26, 27],
};

/**
 * The rubric with its line endings normalised. The file is CRLF on this machine, and every check
 * below is about where text sits relative to a line, so a stray `\r` would decide whether a heading
 * matches — a property of the checkout, not of the document.
 */
const rubric = () => testsRubric().replace(/\r\n/g, '\n');

/** One item's body with runs of whitespace collapsed, so a rule that wraps still reads as a rule. */
const flat = (text, n) => item(text, n).replace(/\s+/g, ' ').trim();

/** Item numbers grouped by the block heading they appear under, in document order. */
function itemsByBlock(text) {
  const grouped = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const heading = /^## ([A-E]\. .+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      grouped.set(current, []);
      continue;
    }
    const numbered = /^(\d+)\.\s+/.exec(line);
    if (numbered) grouped.set(current, [...(grouped.get(current) ?? []), Number(numbered[1])]);
  }
  return grouped;
}

test('the tests rubric blocks hold exactly the items they are supposed to hold', () => {
  // Counting 27 items and finding five headings, which is all this file did before, passes just as
  // well for 27 items dumped under one heading. The judge weighs anti-cheat differently from
  // hygiene, and the block an item sits in is the only thing that says which it is. A merge that
  // lands item 17 — §10.9, the widest blast radius in §10 — under "Hygiene and reuse" changes what
  // the rubric means, and nothing else in the suite would see it.
  assert.deepEqual(Object.fromEntries(itemsByBlock(rubric())), BLOCKS);
});

test('the tests rubric numbers its items 1..27 with no gap and no repeat', () => {
  const numbers = Object.values(BLOCKS).flat();
  assert.deepEqual(numbers, Array.from({ length: 27 }, (_, i) => i + 1));
  assert.deepEqual(items(rubric()), numbers, 'the document order must be the numeric order');
});

/** Section numbers of the conventions file, each with the numbered rules inside it. */
function specSections() {
  const sections = new Map();
  let current = null;
  for (const line of conventions().split('\n')) {
    const heading = /^## (\d+)\. /.exec(line);
    if (heading) {
      current = Number(heading[1]);
      sections.set(current, new Set());
      continue;
    }
    const rule = /^(\d+)\. /.exec(line);
    if (rule && current !== null) sections.get(current).add(Number(rule[1]));
  }
  return sections;
}

test('every spec section the tests rubric cites resolves in the conventions file', () => {
  // The rubric tells the judge that every bare § reference is to
  // docs/specs/petclinic/context-and-conventions.md. A citation that does not resolve sends the
  // judge to read nothing, and it fails in the silent direction: the judge cannot report "that
  // section does not exist", it simply has less to go on and rejects when uncertain.
  const sections = specSections();
  const cited = [...testsRubric().matchAll(/§(\d+)(?:\.(\d+))?/g)];
  assert.ok(cited.length >= 10, `the rubric leans on the spec; found only ${cited.length} citations`);

  for (const [ref, section, rule] of cited) {
    const n = Number(section);
    assert.ok(sections.has(n), `${ref} cites section ${n}, which the conventions file does not have`);
    if (rule !== undefined) {
      assert.ok(
        sections.get(n).has(Number(rule)),
        `${ref} cites rule ${rule} of section ${n}, which does not exist there`
      );
    }
  }
});

test('the §10 items cite the §10 rule they are the rubric side of', () => {
  // Existence is not enough. §10.1 and §10.9 give near-opposite instructions about the same seeded
  // pet type — take the first element, except in the two ACs that must create their own — and an
  // item pointing at the wrong one reads as authority for the wrong rule.
  const expected = { 3: '§3', 9: '§7', 11: '§10.1', 12: '§10.4', 16: '§10.8', 17: '§10.9' };
  const text = rubric();
  for (const [n, ref] of Object.entries(expected)) {
    assert.ok(
      item(text, Number(n)).includes(ref),
      `item ${n} must cite ${ref} — it is that rule's entry in the rubric`
    );
  }

  // Items 13, 14 and 15 carry §10.5, §10.6 and the data rule without citing a number, so this is a
  // floor rather than a per-item requirement.
  const blockC = BLOCKS['C. Rules of §10'].map((n) => item(text, n)).join('\n');
  const rules = new Set([...blockC.matchAll(/§10\.(\d+)/g)].map((m) => m[1]));
  assert.ok(rules.size >= 4, `block C must carry the §10 rules by number, found ${rules.size}`);
});

/** The lines of `text` that are not inside a fenced code block. */
function outsideFences(text) {
  const kept = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inside = !inside;
      continue;
    }
    if (!inside) kept.push(line);
  }
  return kept;
}

test('the verdict contract stands outside every fence and parses with the runner own parser', () => {
  // `text.includes('VERDICT: PASS')` is satisfied by the worked example inside the fence at the
  // bottom of the file — which is the one place the judge must NOT copy the line from, because a
  // fenced first line is read as REJECT. The parser is strict on purpose (verdict.test.mjs pins
  // that), so a decorated line silently throws away a genuine PASS and costs an iteration.
  const bare = outsideFences(rubric()).map((line) => line.trim());
  for (const verdict of VERDICTS) {
    const line = `VERDICT: ${verdict}`;
    assert.ok(bare.includes(line), `${line} must appear as a bare line, outside any code fence`);
    assert.equal(parseVerdict(line), verdict, 'and the runner must parse it back to itself');
    assert.equal(isWellFormed(line), true);
  }

  // The worked example still has to exist — it is where the judge learns the finding format — so
  // this is not "no fenced verdict", it is "not ONLY a fenced verdict".
  assert.match(testsRubric(), /```[\s\S]*VERDICT: REJECT[\s\S]*```/);
});

test('the tests rubric tells the judge that nothing may precede the verdict line', () => {
  // The contract is worth nothing without this sentence: an LLM's default is a line of preamble, and
  // the runner reads the first non-empty line. Each decoration named is one habit ruled out.
  const text = rubric();
  assert.match(text, /first line of your reply must be exactly/i);
  assert.match(text, /Nothing may precede it/i);
  for (const decoration of [/code fence/i, /bold/i, /blockquote/i, /heading/i, /full stop/i]) {
    assert.match(text, decoration, `the rubric must name ${decoration} as a way to lose the verdict`);
  }
  assert.ok(
    text.includes('SPEC UNCLEAR'),
    'and the space-instead-of-underscore spelling, which parses as REJECT'
  );
});

test('no rubric item is a stub', () => {
  // A numbered line with a phrase after it satisfies every count in this file and instructs nobody.
  // The shortest real item is 89 characters — item 25, the hygiene list — so 80 is a floor no
  // genuine item is near and no stub can clear.
  const text = rubric();
  for (const n of items(text)) {
    const body = item(text, n).trim();
    assert.ok(body.length >= 80, `item ${n} is ${body.length} characters — that is a stub, not a rule`);
  }
});

/**
 * What each item has to SAY, one entry per item: the specifics the judge cited during this run —
 * identifiers, section numbers, worked examples, the numbers in the failure modes — rather than the
 * item's vocabulary. Checked inside the body of the numbered item that owns it, which is the part a
 * bag of tokens cannot satisfy.
 */
const OBLIGATIONS = {
  1: [/same order/i, /When/, /merged or reordered/i],
  2: [/every/i, /\bsix\b/i, /AC-F02-01/, /named field/i],
  3: [/data values/i, /auxiliary condition/i, /never the only assertion/i],
  4: [/one to one/i, /Given/, /one `When`/],
  5: [/Excluding/, /justified by the AC/i, /BeEquivalentTo/],
  6: [/cannot fail/i, /NotBeNull/, /HaveCountGreaterThan\(0\)/, /exactly one element/i],
  7: [/saved API response/i, /literal/i, /matches the response of step/i],
  8: [/try/, /catch/, /swallow/i],
  9: [/404/, /no body/i, /dead code/i],
  10: [/polling loop/i, /retry/i, /ReadinessProbe/],
  11: [/creates the records it acts on/i, /pettypes/i, /10 owners and 13 pets/],
  12: [/relative, never absolute/i, /grew by one/i, /AC-F02-01/],
  13: [/UniqueData/, /400/, /500/],
  14: [/ResourceTracker/, /teardown/i, /`Given` steps/],
  15: [/JSON file under this AC/i, /hard-coded/i, /step definition/i],
  16: [/exactly its own AC/i, /other ACs/i, /invisible in the trace/i],
  17: [/AC-F01-04/, /AC-F02-10/, /POST \/pettypes/, /cascade/i, /teardown/i],
  18: [/because/, /EnsureStatus/, /entity ids/i],
  19: [/`Given` steps or hooks/, /error/i, /failure/i],
  20: [/yyyy-MM-dd/, /InvariantCulture/, /50 years/i],
  21: [/domain language/i, /title is out of scope/i, /gives 404/],
  22: [/only assert/i, /ScenarioState/],
  23: [/genuinely new, not a rewording/i, /STEPS\.md/, /similarity band/i],
  24: [/existing\*\* step definition/i, /already accepted/i, /Widening/i],
  25: [/commented-out/i, /TODO/, /unused step definition/i],
  26: [/US-06/, /absence/i, /AC-F02-09/],
  27: [/repeats across ACs/i, /one shared step/i, /drift/i],
};

test('every rubric item states its rule, not merely its vocabulary', () => {
  // This is the assertion a keyword skeleton dies on. The review's skeleton carried every token the
  // old tests grepped for, because those tokens were searched for across the whole file; here each
  // obligation is checked inside the body of the item that owns it, so a token in the wrong slot is
  // worth nothing.
  const text = rubric();
  assert.deepEqual(
    Object.keys(OBLIGATIONS).map(Number),
    items(text),
    'every item must be pinned, and a new item must arrive with its obligation'
  );
  for (const [n, patterns] of Object.entries(OBLIGATIONS)) {
    const body = flat(text, Number(n));
    for (const pattern of patterns) {
      assert.match(body, pattern, `rubric item ${n} no longer states ${pattern}`);
    }
  }
});
