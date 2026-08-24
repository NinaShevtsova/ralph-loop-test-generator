// tests/checks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  literalIds,
  literalIdsInFeature,
  literalIdsInData,
  forbiddenApis,
  whenWithoutThen,
  handAssertedStatusCodes,
  usesFluentAssertions,
  scenarioOutlines,
  foreignLanguageHeader,
  scenarioTags,
  malformedAcTags,
  scenarioTitles,
  excludings,
  outsideFence,
  STAGE1_ALLOWED,
} from '../scripts/checks.mjs';

test('literalIds flags a hard-coded id inside a path string', () => {
  const hits = literalIds('var url = "/owners/1/pets";');
  assert.equal(hits.length, 1);
  assert.match(hits[0].match, /\/owners\/1/);
});

test('literalIds flags a numeric literal passed where an id belongs', () => {
  const hits = literalIds('var response = pets.GetById(3);');
  assert.equal(hits.length, 1);
  assert.match(hits[0].match, /GetById\(\s*3/);
});

test('literalIds reports the 1-based line number', () => {
  const hits = literalIds('line one\nline two\nvar r = pets.GetById(7);');
  assert.equal(hits[0].line, 3);
});

test('literalIds does not flag an id taken from state', () => {
  assert.deepEqual(literalIds('var response = pets.GetById(state.CreatedPet!.Id);'), []);
});

test('literalIds does not flag a path built from a variable', () => {
  assert.deepEqual(literalIds('var url = $"/owners/{ownerId}/pets";'), []);
});

test('forbiddenApis flags Thread.Sleep and Task.Delay', () => {
  const hits = forbiddenApis('Thread.Sleep(500);\nawait Task.Delay(200);');
  assert.equal(hits.length, 2);
});

test('forbiddenApis flags the ways a test gets switched off', () => {
  const hits = forbiddenApis('[Ignore("flaky")]\nAssert.Pass();\nAssert.Ignore("later");');
  assert.equal(hits.length, 3);
});

test('forbiddenApis passes clean source', () => {
  assert.deepEqual(forbiddenApis('state.Owner.Should().NotBeNull();'), []);
});

test('scenarioOutlines flags Scenario Outline and Examples', () => {
  const feature = 'Scenario Outline: something\n  Examples:\n    | a |\n';
  const hits = scenarioOutlines(feature);
  assert.equal(hits.length, 2);
});

test('scenarioOutlines passes a plain Scenario', () => {
  assert.deepEqual(scenarioOutlines('  Scenario: AC-F02-01 a pet is visible\n'), []);
});

test('scenarioTags collects every AC tag in file order', () => {
  const feature = `@F02
Feature: F-02

  @AC-F02-01 @US-02
  Scenario: AC-F02-01 first

  @AC-F02-02 @US-04
  Scenario: AC-F02-02 second
`;
  assert.deepEqual(scenarioTags(feature), ['AC-F02-01', 'AC-F02-02']);
});

test('scenarioTags ignores non-AC tags', () => {
  assert.deepEqual(scenarioTags('@F02 @US-02 @smoke\nFeature: x'), []);
});

test('scenarioTitles collects scenario titles without the keyword', () => {
  const feature = '  Scenario: AC-F02-01 an added pet is visible\n  Scenario: AC-F02-02 second\n';
  assert.deepEqual(scenarioTitles(feature), [
    'AC-F02-01 an added pet is visible',
    'AC-F02-02 second',
  ]);
});

test('excludings lists every Excluding with its line', () => {
  const source = 'a.Should().BeEquivalentTo(b);\nc.Should().BeEquivalentTo(d, o => o.Excluding(x => x.Id));';
  const hits = excludings(source);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].match, /Excluding/);
});

test('excludings returns an empty array when there are none', () => {
  assert.deepEqual(excludings('a.Should().BeEquivalentTo(b);'), []);
});

test('outsideFence allows the three stage-1 directories', () => {
  const paths = [
    'framework/src/PetClinic.ApiTests/Features/F02-owner-pet-lifecycle.feature',
    'framework/src/PetClinic.ApiTests/StepDefinitions/PetSteps.cs',
    'framework/src/PetClinic.ApiTests/Data/F02-owner-pet-lifecycle.json',
  ];
  assert.deepEqual(outsideFence(paths), []);
});

test('outsideFence flags a framework file a stage-1 turn must not touch', () => {
  const paths = [
    'framework/src/PetClinic.ApiTests/Features/F02-owner-pet-lifecycle.feature',
    'framework/src/PetClinic.ApiTests/Support/ResourceTracker.cs',
    'framework/src/PetClinic.ApiTests/PetClinic.ApiTests.csproj',
  ];
  assert.deepEqual(outsideFence(paths), [
    'framework/src/PetClinic.ApiTests/Support/ResourceTracker.cs',
    'framework/src/PetClinic.ApiTests/PetClinic.ApiTests.csproj',
  ]);
});

test('outsideFence flags a path outside the framework entirely', () => {
  assert.deepEqual(outsideFence(['loop/rubrics/tests.md']), ['loop/rubrics/tests.md']);
});

test('STAGE1_ALLOWED names exactly the three permitted directories', () => {
  assert.deepEqual(STAGE1_ALLOWED, ['Features/', 'StepDefinitions/', 'Data/']);
});

// ── Evasions that were measured against an earlier version of these checks ─────
//
// Each of the following was tried against the checks and got through, or fired when it should not
// have. One test per closed evasion, so none of them can quietly re-open.

test('literalIds catches an Async method suffix and a differently spelled call', () => {
  // C# API clients are conventionally async, so `\s*\(` after a fixed name list was the single most
  // likely evasion in practice.
  assert.equal(literalIds('await pets.GetByIdAsync(3);').length, 1);
  assert.equal(literalIds('client.GetPetById(3);').length, 1);
  assert.equal(literalIds('owners.FindOwner(1);').length, 1);
  assert.equal(literalIds('api.GetOwnerById(1);').length, 1);
});

test('literalIds catches a literal assigned to a domain-named id variable', () => {
  // The one dataflow spelling within reach of a regex, and the one this actually appears as. Following
  // `long petId = someCall(); pets.GetById(petId)` is not possible here — rubric item 11 is the backstop.
  assert.equal(literalIds('long petId = 3;').length, 1);
  assert.equal(literalIds('var ownerId = 1;').length, 1);
  assert.deepEqual(literalIds('var petId = created.Id;'), []);
});

test('literalIds is case-insensitive about the route, because ASP.NET routes are', () => {
  assert.equal(literalIds('var url = "/Owners/1/pets";').length, 1);
});

test('literalIds catches the PascalCase property spelling this codebase actually uses', () => {
  // The probe was camelCase-only and `\b`-anchored, and measured 0 hits on every one of these.
  // manifest.scaffold.mjs probes the models for `/OwnerId/` and `/PetId/`, so PascalCase IS the
  // property spelling here and an object initialiser is the idiomatic way to set one — which made
  // the likeliest spelling of this defect the one spelling the check could not see.
  for (const source of [
    'var pet = new Pet { OwnerId = 1 };',
    'PetId = 7',
    'var visit = new Visit { PetId = 3, Description = "checkup" };',
    'this.OwnerId = 5;',
    'PetTypeId = 2',
    'OwnerID = 4',
  ]) {
    assert.equal(literalIds(source).length, 1, `${source} pins a seeded id and must be caught`);
  }
});

test('literalIds catches a leading-underscore field, which \\b could never match', () => {
  // `_` is a word character, so `\b` never matched inside `_ownerId` — and a private backing field
  // is one of the two commonest C# spellings of exactly this.
  assert.equal(literalIds('_ownerId = 1;').length, 1);
  assert.equal(literalIds('m_petId = 2;').length, 1);
});

test('literalIds does not fire on a longer word that merely ends in one of these names', () => {
  // The counterweight to the lookbehind. A false positive here rejects correct work and costs an
  // iteration, so the guard must still refuse a name that only ends in `OwnerId`.
  assert.deepEqual(literalIds('IOwnerIdentityService service = 1;'), []);
  assert.deepEqual(literalIds('var HasPetId = 1;'), []);
  assert.deepEqual(literalIds('var petId = created.Id;'), []);
  assert.deepEqual(literalIds('long OwnerId = 0;'), []);
});

test('literalIdsInData reads the one writable surface inside the fence no other check touched', () => {
  // B10. `Data/` is inside the stage-1 fence and rubric item 15 pushes ALL of a scenario's data into
  // it, while section 4 of the gate reads only StepDefinitions/**.cs and section 2 only the feature
  // file. Measured green through the whole gate before this existed:
  // `{"AC-F01-01": {"path": "/owners/1"}}`.
  assert.equal(literalIdsInData('{"AC-F01-01": {"path": "/owners/1"}}').length, 1);
  assert.equal(literalIdsInData('{"AC-F01-01": {"pets": "/owners/3/pets"}}').length, 1);

  // No JSON file contains an `=`, so the C# assignment probe was unreachable from here whatever it
  // matched. The `:` form is the one a data file actually writes.
  assert.equal(literalIdsInData('{"AC-F01-01": {"ownerId": 1}}').length, 1);
  assert.equal(literalIdsInData('{"AC-F01-01": {"OwnerId": 3}}').length, 1);
  assert.equal(literalIdsInData('{"AC-F01-01": {"owner_id": 3}}').length, 1);
  assert.equal(literalIdsInData('{"AC-F01-01": {"petTypeId": 2}}').length, 1);
});

test('literalIdsInData leaves a legitimate data block alone', () => {
  // The direction that costs an iteration when it is wrong. A data file is mostly names, counts and
  // dates, and none of that may fire.
  assert.deepEqual(literalIdsInData('{"AC-F01-01": {"firstName": "Ada", "petCount": 2}}'), []);
  assert.deepEqual(literalIdsInData('{"AC-F01-01": {"visitDate": "2026-08-07", "pets": ["Leo"]}}'), []);
  // Zero is the placeholder for "not yet created", exactly as in the C# probe.
  assert.deepEqual(literalIdsInData('{"AC-F01-01": {"ownerId": 0}}'), []);
  // A collection route with no id in it is not a pinned record.
  assert.deepEqual(literalIdsInData('{"AC-F01-01": {"path": "/owners"}}'), []);
  assert.deepEqual(literalIdsInData('{}'), []);
});

test('literalIds does not flag ordinary assertion arithmetic', () => {
  // The check leans closed, but not so closed that normal assertions trip it.
  assert.deepEqual(literalIds('pets.Should().HaveCount(1);'), []);
  assert.deepEqual(literalIds('visits.ElementAt(0).Id.Should().Be(visitId);'), []);
  assert.deepEqual(literalIds('response.Body.Pets.Take(2).Should().NotBeEmpty();'), []);
});

test('literalIdsInFeature catches an unquoted route, which is how a feature file writes one', () => {
  // Feature files were not checked at all, and they are the likeliest place for a generated scenario to
  // pin a seeded id.
  const feature = 'Scenario: AC-F02-01 x\n  When I send a GET request to /owners/1/pets\n';
  const hits = literalIdsInFeature(feature);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('literalIdsInFeature ignores a route inside a Gherkin comment', () => {
  assert.deepEqual(literalIdsInFeature('# the seeded data has /owners/1/pets\nScenario: x\n'), []);
});

test('forbiddenApis catches Ignore in a comma-separated attribute list', () => {
  // `[Test, Ignore("flaky")]` is idiomatic C# and defeated an anchor on `[`.
  assert.equal(forbiddenApis('[Test, Ignore("flaky")]').length, 1);
  assert.equal(forbiddenApis('[NUnit.Framework.Ignore("x")]').length, 1);
  assert.equal(forbiddenApis('[IgnoreAttribute("x")]').length, 1);
  assert.equal(forbiddenApis('[TestCase(1, Ignore = "later")]').length, 1);
});

test('forbiddenApis catches the wider switch-off and wait families', () => {
  assert.equal(forbiddenApis('[Explicit("manual only")]').length, 1);
  assert.equal(forbiddenApis('[Fact(Skip = "later")]').length, 1);
  assert.equal(forbiddenApis('Assert.Inconclusive("skip");').length, 1);
  assert.equal(forbiddenApis('SpinWait.SpinUntil(() => done, 500);').length, 1);
});

test('forbiddenApis allows whitespace around the member dot, because C# does', () => {
  assert.equal(forbiddenApis('Thread .Sleep(500);').length, 1);
  assert.equal(forbiddenApis('Task . Delay(200);').length, 1);
});

test('scenarioOutlines does not fire on Gherkin prose, which would reject a correct turn', () => {
  // Both of these were measured false positives, and a false positive here costs an iteration.
  assert.deepEqual(scenarioOutlines('  # Examples: see the AC list\nScenario: x\n'), []);
  assert.deepEqual(scenarioOutlines('Scenario: x\n  """\n  Examples: none\n  """\n'), []);
});

test('scenarioOutlines tolerates unusual spacing between the keywords', () => {
  assert.equal(scenarioOutlines('Scenario  Outline: x').length, 1);
  assert.equal(scenarioOutlines('Scenario\tOutline: x').length, 1);
});

test('foreignLanguageHeader refuses a dialect these checks cannot read', () => {
  // With `# language: uk`, `Структура сценарію:` is a valid Scenario Outline and invisible to the
  // outline check, so §10.8 would go unenforced.
  assert.equal(foreignLanguageHeader('# language: uk\nФункціональність: x\n').length, 1);
  assert.deepEqual(foreignLanguageHeader('# language: en\nFeature: x\n'), []);
  assert.deepEqual(foreignLanguageHeader('Feature: x\n'), []);
});

test('foreignLanguageHeader refuses an en-* dialect, which is not English Gherkin', () => {
  // A hyphen is a word boundary, so the `(?!en\b)` form accepted every one of these — measured. They
  // are separate dialects with their own keyword tables (`en-au` spells Scenario Outline as
  // "Reckon it's like"), which is exactly the condition the docstring says would leave the Scenario
  // Outline rule unenforced. Only the bare tag `en` is English.
  for (const tag of ['en-au', 'en-lol', 'en-pirate', 'en-Scouse', 'en_US']) {
    assert.equal(
      foreignLanguageHeader(`# language: ${tag}\nFeature: x\n`).length,
      1,
      `${tag} has its own keyword table and must be refused`
    );
  }
  // The valid side, including the spellings that must not start firing.
  assert.deepEqual(foreignLanguageHeader('#language:en\nFeature: x\n'), []);
  assert.deepEqual(foreignLanguageHeader('# language: EN\nFeature: x\n'), []);
  assert.deepEqual(foreignLanguageHeader('# language: en   \nFeature: x\n'), []);
});

test('scenarioTags ignores a tag inside a Gherkin comment', () => {
  // A fail-OPEN that was measured: a commented-out tag satisfied the traceability check for an AC
  // nobody had written a scenario for.
  assert.deepEqual(scenarioTags('# was @AC-F02-09, dropped\n@AC-F02-01\nScenario: x\n'), ['AC-F02-01']);
});

test('malformedAcTags names a typo instead of letting it read as a missing tag', () => {
  const hits = malformedAcTags('@AC-F02-1\nScenario: x\n');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '@AC-F02-1');
  assert.deepEqual(malformedAcTags('@AC-F02-01\nScenario: x\n'), []);
});

test('malformedAcTags is anchored at BOTH ends, so a tag that is too long is a typo too', () => {
  // A mutation survivor: dropping the `$` from the well-formed pattern left the test above green,
  // because a tag that is too SHORT fails the pattern either way. A tag that is too LONG is what the
  // anchor is for, and it produces the precise misdiagnosis this function exists to prevent —
  // `@AC-F02-011` yields no malformed report AND no tag, so the gate says "no @AC-F02-01 tag — the
  // tag is the entire traceability mechanism" and sends the agent hunting for a tag it can see on
  // the screen. Both halves are asserted, because only together do they name the failure.
  const feature = '@AC-F02-011\nScenario: x\n';
  assert.deepEqual(scenarioTags(feature), [], 'the over-long tag is not a usable AC tag');
  assert.deepEqual(
    malformedAcTags(feature).map((hit) => hit.match),
    ['@AC-F02-011'],
    'so it MUST be reported as malformed, or the gate misdiagnoses it as absent'
  );
});

test('excludings catches the spaced and MissingMembers spellings', () => {
  assert.equal(excludings('a.Should().BeEquivalentTo(b, o => o. Excluding(x => x.Id));').length, 1);
  assert.equal(excludings('a.Should().BeEquivalentTo(b, o => o.ExcludingMissingMembers());').length, 1);
});

test('outsideFence refuses a path that climbs back out of the fence', () => {
  // The severest measured bypass: this was ALLOWED, because startsWith is meaningless once a path can
  // escape. It is the guard that stops stage 1 rewriting the framework.
  assert.deepEqual(
    outsideFence(['framework/src/PetClinic.ApiTests/Features/../Support/ResourceTracker.cs']),
    ['framework/src/PetClinic.ApiTests/Features/../Support/ResourceTracker.cs']
  );
  assert.equal(outsideFence(['framework/src/PetClinic.ApiTests/Data/../PetClinic.ApiTests.csproj']).length, 1);
});

test('outsideFence refuses a git rename pair rather than judging only its left side', () => {
  const rename = 'framework/src/PetClinic.ApiTests/Features/a.feature => framework/src/PetClinic.ApiTests/Support/b.cs';
  assert.deepEqual(outsideFence([rename]), [rename]);
});

test('outsideFence accepts a ./ prefix and Windows separators', () => {
  assert.deepEqual(outsideFence(['./framework/src/PetClinic.ApiTests/Features/F02.feature']), []);
  assert.deepEqual(outsideFence(['framework\\src\\PetClinic.ApiTests\\Data\\F02.json']), []);
});

test('outsideFence returns a verdict for a null element instead of throwing', () => {
  assert.deepEqual(outsideFence([null, undefined, '', '   ']), [null, undefined, '', '   ']);
});

test('outsideFence refuses a tab-joined path pair, the same class as the arrow form', () => {
  // git's --name-status separates old from new with a TAB and -z with a NUL, not an arrow, so the
  // destination went unchecked in exactly the way the `=>` guard was written to prevent.
  const tabbed =
    'framework/src/PetClinic.ApiTests/Features/a.feature\tframework/src/PetClinic.ApiTests/Support/b.cs';
  assert.deepEqual(outsideFence([tabbed]), [tabbed]);
});

test('withoutGherkinProse closes a docstring only with the delimiter that opened it', () => {
  // Gherkin allows a content type after the opening delimiter, and `"""json` is the idiomatic JSON
  // body. Matching an exact `"""` left the toggle off through the body and let the CLOSING delimiter
  // switch it on, blanking the rest of the file. Measured on one valid feature file, that produced a
  // false positive, a missed real violation and a lost AC tag simultaneously.
  const feature = `@AC-F02-01
Scenario: AC-F02-01 first
  Given a request body
    """json
    { "note": "Examples: none, and /owners/1 is written here too" }
    """
  Then it is accepted

@AC-F02-02
Scenario Outline: AC-F02-02 second
  Examples:
    | a |
`;
  // The prose inside the JSON body must be invisible...
  const outlines = scenarioOutlines(feature);
  // ...but the real Scenario Outline after it must NOT be.
  assert.ok(
    outlines.some((hit) => hit.match.startsWith('Scenario')),
    `the real Scenario Outline must still be found, got ${JSON.stringify(outlines)}`
  );
  assert.deepEqual(literalIdsInFeature(feature), [], 'the route inside the JSON body is prose');
  assert.deepEqual(scenarioTags(feature), ['AC-F02-01', 'AC-F02-02'], 'no tag may be lost');
});

test('withoutGherkinProse handles a backtick-delimited docstring', () => {
  const feature = 'Scenario: x\n  Given a body\n    ```\n    Examples: none\n    ```\n  Then ok\n';
  assert.deepEqual(scenarioOutlines(feature), []);
});

test('literalIds does not fire on a plural-named call or a zero placeholder', () => {
  // All fail-closed, so each cost an iteration rather than letting a defect through — but a count and
  // a page number are not ids, and `long petId = 0;` is a legitimate placeholder.
  assert.deepEqual(literalIds('builder.AddPets(2);'), []);
  assert.deepEqual(literalIds('client.GetPets(1);'), []);
  assert.deepEqual(literalIds('client.GetPetTypes(0);'), []);
  assert.deepEqual(literalIds('long petId = 0;'), []);
  // ...while the real thing still fires.
  assert.equal(literalIds('builder.AddPet(2);').length, 1);
  assert.equal(literalIds('long petId = 3;').length, 1);
});

// ── The fence's exemption for the runner's own bookkeeping ──────────────────────────

test('outsideFence lets the runner\'s tracker ride along in a turn\'s commit', () => {
  // Measured on the real run: the runner writes the tracker and never commits it, so an agent using
  // `git add -A` sweeps it in. Commit 9b56ba5 carries `S4 todo -> done` — written by the RUNNER after
  // a judge PASS — beside the agent's own `S5 todo -> review`. Without the exemption every stage-1
  // rework turn by such an agent is refused for touching a file no agent edited.
  assert.deepEqual(
    outsideFence([
      'framework/src/PetClinic.ApiTests/Features/F01-owner-lifecycle.feature',
      'framework/src/PetClinic.ApiTests/StepDefinitions/OwnerSteps.cs',
      'loop/trackers/tests.md',
    ]),
    []
  );
  assert.deepEqual(outsideFence(['loop/trackers/scaffold.md']), []);
});

test('the exemption is exact, so nothing that merely looks like a tracker gets in', () => {
  // A `loop/` prefix would have let the prompts, the rubrics and the verdict files through, and a
  // turn has no business committing any of them. These five are the near misses worth naming.
  for (const path of [
    'loop/trackers/tests.md.bak',
    'loop/trackers/tests.md.tmp',
    'loop/trackers/evil.md',
    'loop/rubrics/tests.md',
    'loop/PROMPT.tests.md',
  ]) {
    assert.deepEqual(outsideFence([path]), [path], `${path} must still be a stray`);
  }
});

test('exempting the path does not exempt the framework it sits beside', () => {
  // The two guards answer different questions. This one asks "did you rewrite the framework"; the
  // tracker's content is answered by forbiddenStatusWrites, which compares every row across the turn.
  assert.deepEqual(outsideFence(['scripts/checks.mjs']), ['scripts/checks.mjs']);
  assert.deepEqual(
    outsideFence(['framework/src/PetClinic.ApiTests/Support/ResourceTracker.cs']),
    ['framework/src/PetClinic.ApiTests/Support/ResourceTracker.cs']
  );
});

// ── Rubric item 4, as a check ────────────────────────────────────────────

test('whenWithoutThen is silent on strict When/Then alternation', () => {
  // The shape all four accepted F-01 scenarios use.
  const feature = [
    'Scenario: AC-F01-01 a registered owner is visible',
    '    When an owner is registered',
    '    Then the created owner has an assigned id',
    '    When the owner details are opened',
    '    Then the owner details show the submitted values',
  ].join('\n');
  assert.deepEqual(whenWithoutThen(feature), []);
});

test('whenWithoutThen reports a When that runs straight into another When', () => {
  // Measured on AC-F01-02: `When the owner details are updated` followed by a second When with
  // nothing asserted between them. The judge charged $2.26 to find it; this costs nothing.
  const feature = [
    'Scenario: AC-F01-02 updated owner contacts are visible',
    '    Given an owner is registered',
    "    When the owner's details are updated",
    '    When the owner details are opened',
    '    Then the owner details show the updated contacts',
  ].join('\n');
  const problems = whenWithoutThen(feature);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /owner's details are updated/);
});

test('whenWithoutThen reports a trailing When at the end of a scenario', () => {
  // The other shape of the same defect: a request nobody looks at because the scenario simply stops.
  const feature = 'Scenario: x\n    When a thing happens\n';
  assert.equal(whenWithoutThen(feature).length, 1);
});

test('whenWithoutThen treats And after When as part of the same request block', () => {
  // `And` continues whichever primary keyword opened the block, which is why this is a walk and not a
  // regex. Reading the And as its own When would report the accepted AC-F01-04 scenario.
  const feature = [
    'Scenario: AC-F01-04 deregistering an owner removes their pet',
    '    Given a pet type is added to the directory',
    '    And an owner is registered',
    '    When the owner is deleted',
    '    And the owners directory is requested',
    '    Then the owner is missing from the owners list',
    '    And the pet is gone too',
  ].join('\n');
  assert.deepEqual(whenWithoutThen(feature), []);
});

test('whenWithoutThen does not carry state across scenarios', () => {
  // An unanswered When in one scenario must be reported against THAT scenario and must not silence
  // or accuse the next one.
  const feature = [
    'Scenario: first',
    '    When a thing happens',
    'Scenario: second',
    '    When another thing happens',
    '    Then it is checked',
  ].join('\n');
  const problems = whenWithoutThen(feature);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^first:/);
});

// ── Rubric items 6 and 18, as a check ────────────────────────────────────

test('handAssertedStatusCodes is silent on steps that leave the code to EnsureStatus', () => {
  const source = { path: 'OwnerSteps.cs', text: 'var r = (await _owners.Create(o)).EnsureStatus(HttpStatusCode.Created);' };
  assert.deepEqual(handAssertedStatusCodes([source]), []);
});

test('handAssertedStatusCodes reports an assertion the When already guaranteed', () => {
  // Measured on AC-F01-03: the When called EnsureStatus(NotFound) before the response reached state,
  // so this line could never fail. Dead assertion weight, and an iteration to remove it.
  const source = { path: 'OwnerAssertionSteps.cs', text: 'r.StatusCode.Should().Be(HttpStatusCode.NotFound, "because ...");' };
  const hits = handAssertedStatusCodes([source]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'OwnerAssertionSteps.cs');
  assert.equal(hits[0].line, 1);
});

test('handAssertedStatusCodes tolerates the whitespace C# allows', () => {
  const spellings = [
    'r.StatusCode .Should() .Be(x);',
    'r.StatusCode	.Should	();',
  ];
  for (const text of spellings) {
    assert.equal(handAssertedStatusCodes([{ path: 'A.cs', text }]).length, 1, text);
  }
});

test('handAssertedStatusCodes reports every hit and an empty list for no sources', () => {
  const hits = handAssertedStatusCodes([
    { path: 'A.cs', text: 'x.StatusCode.Should().Be(1);\ny.StatusCode.Should().Be(2);' },
  ]);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
  assert.deepEqual(handAssertedStatusCodes([]), []);
  assert.deepEqual(handAssertedStatusCodes(), []);
});

test('usesFluentAssertions is true for this project, whose 70 assertions all use Should()', () => {
  assert.equal(usesFluentAssertions([{ path: 'a.cs', text: 'body.Name.Should().Be(x);' }]), true);
});

test('usesFluentAssertions is false for a project that asserts another way', () => {
  // The case that makes the guard necessary. This text HAND-ASSERTS a status code -- the exact defect
  // handAssertedStatusCodes exists to catch -- and that rule returns zero hits on it, because the
  // spelling is NUnit and the rule only knows FluentAssertions. Without the guard the gate printed
  // `ok  ...: response codes are left to EnsureStatus` over this very line.
  const nunit = [{ path: 'Steps.cs', text: 'Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NotFound));' }];
  assert.equal(usesFluentAssertions(nunit), false);
  assert.deepEqual(handAssertedStatusCodes(nunit), [], 'the rule is blind here, which is the point');
});

test('usesFluentAssertions is false for an empty or missing source list', () => {
  // Leans towards "not applicable" rather than "checked and clean": a project with no step files at
  // all has not been shown to satisfy anything.
  assert.equal(usesFluentAssertions([]), false);
  assert.equal(usesFluentAssertions(), false);
});
