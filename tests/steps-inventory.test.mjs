// tests/steps-inventory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSteps,
  normalize,
  similarity,
  isReordering,
  renderInventory,
} from '../scripts/steps-inventory.mjs';

const SOURCE = `
using Reqnroll;

[Binding]
public sealed class OwnerSteps(ScenarioState state, OwnersService owners)
{
    [Given("an owner is registered")]
    public void GivenAnOwnerIsRegistered() { }

    [When("the owner details are opened")]
    public void WhenTheOwnerDetailsAreOpened() { }

    [Then("the owner details show exactly {int} pets")]
    public void ThenTheOwnerDetailsShowExactlyPets(int count) { }

    [Then(@"the owners list contains exactly one entry for the owner")]
    public void ThenTheOwnersListContainsTheOwner() { }

    [StepDefinition("the clinic API is available")]
    public void TheClinicApiIsAvailable() { }
}
`;

test('extractSteps finds Given, When, Then and StepDefinition attributes', () => {
  const steps = extractSteps(SOURCE);
  assert.equal(steps.length, 5);
  assert.deepEqual(steps[0], { kind: 'Given', text: 'an owner is registered' });
  assert.equal(steps[2].text, 'the owner details show exactly {int} pets');
});

test('extractSteps handles the verbatim string form @"..."', () => {
  const steps = extractSteps(SOURCE);
  assert.ok(steps.some((s) => s.text === 'the owners list contains exactly one entry for the owner'));
});

test('extractSteps ignores method names and other attributes', () => {
  const steps = extractSteps('[Binding]\n[Obsolete("gone")]\npublic class X { }');
  assert.equal(steps.length, 0);
});

test('extractSteps returns an empty array for empty input', () => {
  assert.deepEqual(extractSteps(''), []);
  assert.deepEqual(extractSteps(null), []);
});

test('extractSteps sees a step that SHARES its attribute list, in either position', () => {
  // The parser required `)]`, so a step attribute with anything beside it was invisible. Measured:
  // `[Given("a new owner is registered"), Scope(Tag = "F01")]` returned []. `Scope` is a first-class
  // Reqnroll attribute, so this is not an exotic spelling — and such a file vanished from
  // loop/STEPS.md AND from the duplicate gate at once, while check-tests.mjs section 5 still printed
  // its unconditional green `0 step(s) compared`. A parser that sees nothing must not report clean.
  assert.deepEqual(extractSteps('[Given("a new owner is registered"), Scope(Tag = "F01")]'), [
    { kind: 'Given', text: 'a new owner is registered' },
  ]);
  assert.deepEqual(extractSteps('[Scope(Tag = "F01"), Given("a new owner is registered")]'), [
    { kind: 'Given', text: 'a new owner is registered' },
  ]);
});

test('extractSteps finds EVERY step in one attribute list, not just the first', () => {
  // The reason the leading `[`/`,` is a lookbehind rather than a consumed character: consuming the
  // separator would eat the comma the next attribute needs to be recognised by.
  assert.deepEqual(
    extractSteps('[Given("a"), When("b"), Then("c")]').map((step) => step.text),
    ['a', 'b', 'c']
  );
});

test('extractSteps reads a C# 11 raw string, on one line or several', () => {
  assert.deepEqual(extractSteps('[Given("""a new owner is registered""")]'), [
    { kind: 'Given', text: 'a new owner is registered' },
  ]);
  // A multi-line raw string carries the indentation C# strips at compile time, so the capture is
  // trimmed. The quoted forms are NOT trimmed — their whitespace is what Reqnroll matches on.
  assert.deepEqual(extractSteps('[Given("""\n    a new owner is registered\n    """)]'), [
    { kind: 'Given', text: 'a new owner is registered' },
  ]);
  assert.deepEqual(extractSteps('[Given(" padded ")]'), [{ kind: 'Given', text: ' padded ' }]);
});

test('extractSteps still refuses a bare method call that merely looks like a step', () => {
  // The counterweight to loosening the brackets. Neither of these is an attribute, and admitting
  // them would inflate the inventory with helper calls and invent duplicates that do not exist.
  assert.deepEqual(extractSteps('Given("a helper call");'), []);
  assert.deepEqual(extractSteps('foo(a, Given("x"));'), []);
  assert.deepEqual(extractSteps('[Binding]\n[Obsolete("gone")]\npublic class X { }'), []);
});

test('normalize strips Gherkin parameters, punctuation and stop words but KEEPS word order', () => {
  assert.equal(normalize('The owner details show exactly {int} pets!'), 'owner details show exactly pets');
  // Order is preserved on purpose. Sorting the tokens is what made a reversed relationship
  // indistinguishable from a rewording.
  assert.notEqual(normalize('the pet is added to the owner'), normalize('the owner is added to the pet'));
});

test('normalize makes wording variants of the same sentence identical', () => {
  assert.equal(normalize('an owner is registered'), normalize('the owner is registered'));
});

test('normalize drops the concrete value a parameter matches', () => {
  // A parameterised step and the Gherkin line that uses it must normalise to the same thing, or the
  // use counter never counts a single parameterised step — and those are the most-reused ones.
  assert.equal(
    normalize('the owner details show exactly {int} pets'),
    normalize('the owner details show exactly 1 pets')
  );
  assert.equal(normalize('a pet named {string} is added'), normalize('a pet named "Fluffy" is added'));
});

test('similarity is 1 for identical sentences', () => {
  assert.equal(similarity('an owner is registered', 'an owner is registered'), 1);
});

test('similarity is high for a near-duplicate the judge should never have to see', () => {
  const score = similarity('an owner is registered', 'the owner is registered');
  assert.ok(score >= 0.9, `expected >= 0.9, got ${score}`);
});

test('similarity scores a perfect-tense rewording as the duplicate it is', () => {
  // The reuse mechanism's most likely input, and it used to lose on it. `been` was a stop word and
  // `has` was not, so the rewording gained a token the original lacked. Measured at 0.33 — below the
  // 0.90 hard fail AND below the 0.65 band floor, so it was not merely permitted, it never reached
  // the judge as data either. The commonest rewording an LLM produces was the one the gate was
  // blindest to.
  for (const [left, right] of [
    ['an owner is registered', 'an owner has been registered'],
    ['the owner is deleted', 'the owner has been deleted'],
    ['the visit is recorded', 'the visit has been recorded'],
  ]) {
    const score = similarity(left, right);
    assert.ok(score >= 0.9, `"${left}" vs "${right}" must fail the gate as a duplicate, got ${score}`);
  }
});

test('similarity is in the reportable band for a reworded near-duplicate', () => {
  // Measured: 0.67. The band floor in the module header and in check-tests.mjs is 0.65 for this
  // reason — it is a measured constant, not a round number chosen in advance.
  const score = similarity('an owner is registered', 'a pet owner is registered');
  assert.ok(score >= 0.65 && score < 0.9, `expected 0.65..0.9, got ${score}`);
});

// Every one of these is the same relationship stated backwards, so none may ever be hard-failed as a
// duplicate. Seven of ten scored exactly 1.0 under the original sorted bag of words.
const REVERSED_PAIRS = [
  ['the pet is added to the owner', 'the owner is added to the pet'],
  ['the owner has a pet', 'the pet has an owner'],
  ['the first visit is before the second visit', 'the second visit is before the first visit'],
  ['the visit is moved from the pet to the owner', 'the visit is moved from the owner to the pet'],
  // The repeated-frame family. These still score above 0.90 — measured 0.9167 and 0.9286 — because
  // the two sides are anagrams and the swap disturbs one adjacent pair out of six. No textual measure
  // fixes it: a longer frame only pushes the score higher. `isReordering` is what keeps them out of
  // the gate's hands.
  ['the count of pets exceeds the count of owners', 'the count of owners exceeds the count of pets'],
  [
    'the name of the owner is shown before the name of the pet',
    'the name of the pet is shown before the name of the owner',
  ],
];

test('similarity alone cannot be trusted to spare a reversed relationship', () => {
  // Deliberately records the limitation rather than asserting it away. Four of these six drop below
  // the gate on the score; two do not, and that is exactly why isReordering exists.
  const scored = REVERSED_PAIRS.map(([left, right]) => similarity(left, right));
  assert.ok(scored.some((score) => score < 0.9), 'the short reversals must fall below the gate');
  assert.ok(
    scored.some((score) => score >= 0.9),
    'and the repeated-frame reversals must not — if they now do, this test and isReordering need revisiting'
  );
});

test('isReordering catches every reversed relationship, including the repeated-frame ones', () => {
  for (const [left, right] of REVERSED_PAIRS) {
    assert.equal(
      isReordering(left, right),
      true,
      `"${left}" vs "${right}" is the same words reordered and must never be hard-failed`
    );
  }
});

test('treating has/have as stop words does not make any reversal hard-failable', () => {
  // The exclusion of `has`/`have` was justified on the grounds that they "encode direction". They do
  // not: direction is separated by the bigram half and by isReordering, and this is the check that
  // the justification was wrong rather than merely unproven. Every reversed pair above is still
  // exempted with them in the list — measured, all six score exactly what they scored before — so
  // nothing that was safe became blockable.
  assert.equal(isReordering('the owner has a pet', 'the pet has an owner'), true);
  for (const [left, right] of REVERSED_PAIRS) {
    assert.equal(isReordering(left, right), true, `"${left}" vs "${right}" must stay exempt`);
  }
  // And a genuinely different sentence that happens to contain `has` is still not a permutation.
  assert.equal(isReordering('the owner has two pets', 'the pet has two owners'), false);
});

test('isReordering does not fire for identical sentences or genuine duplicates', () => {
  // Identical is not a reordering — it is a real duplicate and must stay blockable.
  assert.equal(isReordering('an owner is registered', 'the owner is registered'), false);
  assert.equal(isReordering('an owner is registered', 'an owner is registered'), false);
  // Different words, not a permutation.
  assert.equal(isReordering('an owner is registered', 'a pet owner is registered'), false);
  assert.equal(isReordering('the pet is deleted', 'the pet is not deleted'), false);
  assert.equal(isReordering('', ''), false);
});

test('similarity separates a negated sentence from a reworded one', () => {
  // Under the old measure both scored 0.667, so no threshold could tell them apart. `not` is not a
  // stop word, and the ordered-pair half punishes it twice.
  const negated = similarity('the pet is deleted', 'the pet is not deleted');
  const reworded = similarity('an owner is registered', 'a pet owner is registered');
  assert.ok(negated < 0.5, `a negation must read as different, got ${negated}`);
  assert.ok(reworded > negated, `a rewording (${reworded}) must score above a negation (${negated})`);
});

test('similarity is low for genuinely different sentences', () => {
  const score = similarity('an owner is registered', 'the visits log does not contain the visit');
  assert.ok(score < 0.3, `expected < 0.3, got ${score}`);
});

test('similarity of two empty sentences is 1 and never NaN', () => {
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('{int}', '{word}'), 1);
});

test('similarity handles one-word sentences, which have no adjacent pairs', () => {
  assert.equal(similarity('owner', 'owner'), 1);
  assert.equal(similarity('owner', 'pet'), 0);
  assert.ok(!Number.isNaN(similarity('owner', 'owner registered')));
});

test('renderInventory groups by kind, sorts, and shows the file and use count', () => {
  const md = renderInventory([
    { kind: 'Given', text: 'an owner is registered', file: 'StepDefinitions/OwnerSteps.cs', uses: 12 },
    { kind: 'When', text: 'the owner details are opened', file: 'StepDefinitions/OwnerSteps.cs', uses: 13 },
    { kind: 'Then', text: 'the directory returns at least one pet type', file: 'StepDefinitions/PetTypeSteps.cs', uses: 1 },
  ]);
  assert.match(md, /^# Step inventory/m);
  assert.match(md, /## Given/);
  assert.match(md, /## When/);
  assert.match(md, /## Then/);
  assert.match(md, /an owner is registered/);
  assert.match(md, /OwnerSteps\.cs/);
  assert.match(md, /12/);
  assert.ok(md.indexOf('## Given') < md.indexOf('## When'), 'Given must come before When');
});

test('renderInventory says so explicitly when there are no steps yet', () => {
  const md = renderInventory([]);
  assert.match(md, /no step definitions exist yet/i);
});
