// tests/judge-eval.test.mjs — the golden set, checked without spending anything.
//
// `scripts/eval-judge.mjs` costs real money and is run by hand. Everything about the set that CAN be
// established for free is established here, because a fixture that has silently gone stale does not
// report itself as stale: it shows the judge a defect-free diff, the judge passes it, and the
// scorecard reads as a judge that got worse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';
import { FIXTURES, buildDiff, normalizeHunks, grade } from '../loop/judge-eval.mjs';

const ROOT = repoRoot(import.meta.url);
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'judge');
const baseOf = (fixture) => readFileSync(join(FIXTURE_DIR, fixture.base), 'utf8');

test('every fixture names a base diff that exists', () => {
  for (const fixture of FIXTURES) {
    assert.ok(existsSync(join(FIXTURE_DIR, fixture.base)), `${fixture.name}: missing ${fixture.base}`);
  }
});

test('every substitution still applies exactly once to its base', () => {
  // The whole point of storing mutants as substitutions rather than as copies: regenerate the base
  // diff and the ones that no longer apply say so here, loudly, for free.
  for (const fixture of FIXTURES) {
    assert.doesNotThrow(() => buildDiff(fixture, baseOf(fixture)), `${fixture.name}`);
  }
});

test('a substitution that no longer matches is a hard failure, not a silent pass-through', () => {
  assert.throws(
    () => buildDiff({ name: 'x', base: 'f0201-accepted.diff', replace: [['nothing like this', 'y']] }, 'body'),
    /matches 0 time\(s\)/
  );
  assert.throws(
    () => buildDiff({ name: 'x', base: 'b', replace: [['a', 'y']] }, 'a a'),
    /matches 2 time\(s\)/
  );
});

test('every mutant really differs from the diff it was built from', () => {
  // A substitution can apply and change nothing — `replace([x, x])`. Then the fixture grades the
  // ACCEPTED diff while claiming to grade a defect, and a correct judge scores as a broken one.
  for (const fixture of FIXTURES.filter((f) => f.replace?.length)) {
    assert.notEqual(buildDiff(fixture, baseOf(fixture)), baseOf(fixture), `${fixture.name}`);
  }
});

test('fixture names are unique — the scorecard is keyed by them', () => {
  const names = FIXTURES.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
});

test('every fixture expects PASS or REJECT, and both are represented', () => {
  // A set of defects alone scores "reject everything" as a perfect rubric — which in the loop means
  // every row grinds to the iteration ceiling with nothing wrong with the work.
  for (const fixture of FIXTURES) {
    assert.ok(['PASS', 'REJECT'].includes(fixture.expect), `${fixture.name}: ${fixture.expect}`);
  }
  assert.ok(FIXTURES.some((f) => f.expect === 'PASS'), 'no false-positive control');
  assert.ok(FIXTURES.filter((f) => f.expect === 'REJECT').length >= 5, 'too few defects to measure anything');
});

test('every rubric item a fixture cites exists in the rubric', () => {
  // An item deleted or renumbered in the rubric must not leave a fixture pointing at nothing.
  const rubric = readFileSync(join(ROOT, 'loop/rubrics/tests.md'), 'utf8');
  const items = new Set([...rubric.matchAll(/^(\d+)\.\s+/gm)].map((m) => Number(m[1])));

  for (const fixture of FIXTURES.filter((f) => f.item)) {
    assert.ok(items.has(fixture.item), `${fixture.name} cites item ${fixture.item}, which the rubric has not`);
  }
});

test('every fixture AC is a real acceptance criterion of the tracker', () => {
  const tracker = readFileSync(join(ROOT, 'loop/trackers/tests.md'), 'utf8');
  for (const fixture of FIXTURES) {
    assert.ok(tracker.includes(fixture.ac), `${fixture.name}: ${fixture.ac} is in no tracker row`);
  }
});

test('the accepted fixtures carry the AC tag the judge is asked about', () => {
  for (const fixture of FIXTURES) {
    const diff = buildDiff(fixture, baseOf(fixture));
    assert.ok(
      diff.includes(fixture.ac),
      `${fixture.name}: the diff never mentions ${fixture.ac}, so it cannot be graded against it`
    );
  }
});

test('the injection fixture carries both an instruction to the judge and a real defect', () => {
  // Either half alone measures the wrong thing. Without the instruction it is an ordinary
  // missing-claim fixture; without the defect a PASS would be correct and a REJECT would be right for
  // the wrong reason, and the scorecard could not tell them apart.
  const fixture = FIXTURES.find((f) => f.name === 'injected-approval');
  const diff = buildDiff(fixture, baseOf(fixture));
  assert.match(diff, /VERDICT: PASS/, 'the injected instruction is missing');
  assert.ok(!diff.includes('inside the owner details should show its birth date'), 'the defect is missing');
});

test('a CRLF checkout of the fixtures does not break the substitutions', () => {
  // `core.autocrlf=true` and no `.gitattributes`: a fresh checkout of a `.diff` gets CRLF endings,
  // while the substitutions are written with LF in a source file. Measured by converting one fixture
  // before `buildDiff` normalised — every multi-line substitution matched 0 times and four tests
  // failed. They failed LOUDLY, which is the design working; but the fixtures would have been usable
  // only on the machine that wrote them, which is not.
  const CR = String.fromCharCode(13);
  for (const fixture of FIXTURES) {
    // Normalised before it is converted. On a checkout that ALREADY has CRLF, doubling the endings
    // would build `\r\r\n` and this test would fail on an artefact of its own making.
    const lf = baseOf(fixture).split(`${CR}\n`).join('\n');
    const crlf = lf.split('\n').join(`${CR}\n`);
    const built = buildDiff(fixture, crlf);
    assert.ok(!built.includes(CR), `${fixture.name}: the judge must be shown LF`);
    assert.equal(built, buildDiff(fixture, lf), `${fixture.name}: the checkout changed the fixture`);
  }
});

test('normalizeHunks leaves an untouched diff byte-identical', () => {
  // The strongest available check that the recomputation agrees with git: run it over diffs git
  // itself produced and require no change at all.
  for (const base of ['f0201-accepted.diff', 'f0301-accepted.diff']) {
    const text = readFileSync(join(FIXTURE_DIR, base), 'utf8');
    assert.equal(normalizeHunks(text), text, `${base} was rewritten by its own normalizer`);
  }
});

test('normalizeHunks repairs the counts after a line is added or removed', () => {
  const diff = [
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1,2 +1,4 @@',
    ' context',
    '-gone',
    '+one',
    '+two',
    '+three',
    '',
  ].join('\n');

  assert.match(normalizeHunks(diff), /@@ -1,2 \+1,4 @@/);

  const shortened = diff.replace('+two\n', '');
  assert.match(normalizeHunks(shortened), /@@ -1,2 \+1,3 @@/);
});

test('normalizeHunks keeps every body line, in order', () => {
  const text = readFileSync(join(FIXTURE_DIR, 'f0201-accepted.diff'), 'utf8');
  const bodies = (value) => value.split('\n').filter((line) => /^[+-]/.test(line) && !/^[+-]{3} /.test(line));
  assert.deepEqual(bodies(normalizeHunks(text)), bodies(text));
});

test('grade separates a catch from an escalation', () => {
  const mutant = { name: 'm', expect: 'REJECT' };
  assert.deepEqual(grade(mutant, 'REJECT'), { name: 'm', expected: 'REJECT', actual: 'REJECT', caught: true, escalated: false });
  assert.deepEqual(grade(mutant, 'PASS'), { name: 'm', expected: 'REJECT', actual: 'PASS', caught: false, escalated: false });

  // Not a catch — the defect is not fixed by routing it to a human — but not an acceptance either.
  const escalated = grade(mutant, 'SPEC_UNCLEAR');
  assert.equal(escalated.caught, false);
  assert.equal(escalated.escalated, true);
});
