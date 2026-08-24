// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The cheap, mechanical rules that catch a test which LOOKS right and proves nothing.
//
// Each rule is a small pattern-matcher looking for one specific bad habit: an id typed
// straight into the test instead of taken from the API, a sleep used to paper over a
// timing problem, a test switched off with `Ignore`, a Gherkin construct the conventions
// forbid, a file changed outside the folders this stage may touch.
//
// The point of doing these mechanically is money and reliability: a pattern gives the same
// answer every time and costs nothing, so the AI grader's attention is left for the things
// only judgement can settle. Where a pattern cannot be sure, it does not guess — it hands
// the case to the grader instead.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/checks.mjs — the deterministic half of the stage-1 gate (design §6.4).
//
// Every function here is pure and returns a list of hits: { line, match }. Nothing in this file
// is ever delegated to the judge — a regex settles it, so the judge's tokens go to semantics.
//
// These are heuristics guarding a gate, and the two failure directions are not symmetric. Failing
// OPEN lets a defect through, and the judge's rubric is the backstop. Failing CLOSED rejects correct
// work and costs an iteration. Where the two conflicted, each function below says which way it leans.
//
// What a regex provably cannot do here, and what covers it instead:
//
//   - Follow dataflow. `long petId = 3; pets.GetById(petId);` is one indirection from a literal id and
//     no pattern reaches it. Rubric item 11 — "the scenario creates its own data; no seeded record is
//     used" — is the backstop. The narrow case of a domain-named id variable assigned a literal IS
//     caught, because that is the spelling it actually appears as.
//   - See across lines. `scan` works line by line, so a wrapped call escapes.
//   - Resolve aliases. `using Wait = System.Threading.Tasks.Task; await Wait.Delay(200);` escapes.
//
// Measured evasions that ARE closed here: an `Async` method suffix, a comma-separated attribute list
// (`[Test, Ignore("flaky")]`), whitespace around a member dot (`Thread .Sleep`), a `..` segment inside
// a fenced path, a git rename pair, an unquoted route in a feature file, and an AC tag sitting in a
// Gherkin comment.


import { PROJECT, RUNNER_STATE, RUNS_DIR } from './flows.mjs';

/** Returns hits for a global regex, with 1-based line numbers. */
function scan(source, pattern) {
  const lines = (source ?? '').split('\n');
  const hits = [];
  lines.forEach((line, index) => {
    for (const m of line.matchAll(pattern)) {
      hits.push({ line: index + 1, match: m[0].trim() });
    }
  });
  return hits;
}

/**
 * The feature file with Gherkin comments and `"""` docstring bodies blanked out, line count
 * preserved so hit line numbers stay honest.
 *
 * Two measured false positives this removes, and both REJECTED a legitimate turn:
 * `# Examples: see the AC list` and `Examples: none` inside a docstring. One measured fail-OPEN it
 * removes: `# was @AC-F02-09, dropped` was read as coverage of AC-F02-09.
 */
function withoutGherkinProse(feature) {
  const DELIMITERS = ['"""', '```'];
  let openDelimiter = null;

  return (feature ?? '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      if (openDelimiter !== null) {
        // Only the delimiter that opened the docstring can close it.
        if (trimmed === openDelimiter) openDelimiter = null;
        return '';
      }

      // `startsWith`, not equality. Gherkin allows a content type after the opening delimiter, and
      // `"""json` is the idiomatic way to write a JSON request body — Reqnroll parses it. Matching an
      // exact `"""` left the toggle OFF through the body and then let the CLOSING delimiter switch it
      // ON, blanking everything to end of file. Measured on one valid feature file, that made the
      // outline check fire on prose inside the JSON body AND miss the real `Scenario Outline` it
      // exists to catch, lose a literal id, and drop an AC tag — all three failure directions at once.
      const opening = DELIMITERS.find((delimiter) => trimmed.startsWith(delimiter));
      if (opening) {
        openDelimiter = opening;
        return '';
      }

      if (trimmed.startsWith('#')) return '';
      return line;
    })
    .join('\n');
  // An UNTERMINATED docstring still blanks to end of file, and that is deliberately left alone: it is
  // invalid Gherkin, so Reqnroll's code generation fails, and the stage-1 gate runs `dotnet build`
  // (step 2) before `check-tests` (step 4) and stops at the first red. Such a file can never reach
  // these checks. The `"""json` case above could, which is why it is handled and this is not.
}

// §10.1 of the input spec: the database is seeded with 10 owners and 13 pets, so `GET /owners/1`
// formally answers 200 and the test is "green" having verified nothing. A literal id is a
// generation defect EVEN WHEN THE TEST PASSES, which is exactly why it cannot be left to a run.
// Case-insensitive, because ASP.NET routes are not: `/Owners/1` was slipping past.
const LITERAL_PATH = /"[^"$]*\/(?:owners|pets|visits|pettypes)\/\d+/gi;

// The same route written WITHOUT quotes, which is how it appears in a feature file. Feature files were
// not checked at all, and they are the most plausible place for a generated scenario to pin a seeded
// id — `When I send a GET request to /owners/1/pets` matched nothing. A bare route there is doubly a
// violation, since the prompt forbids paths in a feature file at all.
const LITERAL_PATH_BARE = /\/(?:owners|pets|visits|pettypes)\/\d+/gi;

// A bare integer where an id belongs. Three spellings, because enumerating method names missed the
// likeliest ones: `GetByIdAsync(3)` — an Async suffix, and C# clients are conventionally async —
// `client.GetPetById(3)`, two names glued together, and `owners.FindOwner(1)`, where no owner-scoped
// method was on the list at all.
//
// The third alternative is the one dataflow case worth catching. A regex cannot follow
// `long petId = 3; pets.GetById(petId);`, and rubric item 11 is the backstop for that. But a literal
// assigned to a domain-named id variable is the spelling it actually appears as, and that much is
// reachable.
const LITERAL_ID_ARG = new RegExp(
  [
    String.raw`\b\w*By(?:Owner|Pet|Visit|PetType)?Id\w*\s*\(\s*\d+`,
    // The `(?<!s)` sits AFTER `\w*`, at the end of the name, and it must stay there. A plural has to be
    // kept out — `AddPets(2)` is a count and `GetPets(1)` a page number, and both fired — but a guard
    // placed next to the noun as `(?!s)` does not do it: the ordered alternation matches the shorter
    // `Pet` in `GetPetTypes`, the lookahead inspects `T`, passes, and `\w*` swallows `ypes`. Measured,
    // that fired on GetPetTypes, AddPetTypes and four more, and reordering the alternation longest-first
    // does NOT help, because backtracking falls back to `Pet` anyway. `Pet` being a prefix of `PetType`
    // is the whole reason the guard belongs at the end.
    String.raw`\b(?:Get|Add|Update|Delete|Remove|Find)(?:Owner|Pet|Visit|PetType)\w*(?<!s)\s*\(\s*\d+`,
    // `[1-9]` because `long petId = 0;` is a legitimate placeholder — auto-increment ids start at 1,
    // so a zero is never a seeded record and flagging it only cost an iteration.
    //
    // Case and prefix both matter, and the camelCase-only `\b`-anchored form missed the spelling this
    // codebase actually uses. Measured at 0 hits each: `new Pet { OwnerId = 1 }`, `PetId = 7`,
    // `_ownerId = 1`. `manifest.scaffold.mjs` probes the models for `/OwnerId/` and `/PetId/`, so
    // PascalCase IS the property spelling here and an object initialiser is the idiomatic way to set it.
    //
    // `(?<![A-Za-z0-9])` rather than `\b`: `_` is a word character, so `\b` never matched inside
    // `_ownerId` or `m_petId` — the two commonest C# field spellings. The lookbehind still refuses
    // `IOwnerId` and `HasPetId`, where the name is a longer word that merely ends in one of these.
    String.raw`(?<![A-Za-z0-9])(?:[Oo]wner|[Pp]et|[Vv]isit|[Pp]et[Tt]ype)[Ii][Dd]\s*=\s*[1-9]\d*`,
  ].join('|'),
  'g'
);

/** Hard-coded record identifiers in C# source — §10.1. */
export function literalIds(source) {
  return [...scan(source, LITERAL_PATH), ...scan(source, LITERAL_ID_ARG)].sort((a, b) => a.line - b.line);
}

/** Hard-coded record identifiers in a feature file, where routes are unquoted and forbidden anyway. */
export function literalIdsInFeature(feature) {
  return scan(withoutGherkinProse(feature), LITERAL_PATH_BARE);
}

// A JSON property naming a record id and giving it a concrete value. `LITERAL_ID_ARG` looks for an
// assignment with `=`, and no JSON file contains one, so that whole family was unreachable from a
// data file. Case-insensitive and `_`-tolerant, because a JSON key is written to whatever convention
// the C# binder is configured for: `ownerId`, `OwnerId`, `owner_id` are all the same property.
const LITERAL_ID_JSON = /"(?:owner|pet|visit|pet_?type)_?id"\s*:\s*[1-9]\d*/gi;

/**
 * Hard-coded record identifiers in a `Data/*.json` file — §10.1 on the one surface no other check read.
 *
 * `Data/` is inside the stage-1 fence and rubric item 15 pushes ALL of a scenario's data into it, so
 * it is exactly where a seeded id would end up. Measured before this existed:
 * `{"AC-F01-01": {"path": "/owners/1"}}` passed the whole gate green — section 4 reads only
 * `StepDefinitions/**.cs` and section 2 only the feature file.
 *
 * The BARE route pattern, not the quoted one: it matches inside `"/owners/1"` as well, so one scan
 * covers a route written as a whole JSON value and one embedded in a longer string.
 */
export function literalIdsInData(source) {
  return [...scan(source, LITERAL_PATH_BARE), ...scan(source, LITERAL_ID_JSON)].sort(
    (a, b) => a.line - b.line
  );
}

// Two families, both of which turn a failing test into a passing one without fixing anything:
// waits (a flaky test that PASSES is worse than a red one) and switches (the cheapest way to
// "green" a test is to disable it).
//
// The attribute forms are NOT anchored on `[`. `[Test, Ignore("flaky")]` is idiomatic C# and defeated
// the anchored version outright, as did `[NUnit.Framework.Ignore("x")]` and `[IgnoreAttribute("x")]`.
// Whitespace around a member dot is allowed, because `Thread .Sleep(500)` is legal C#. And the
// switch-off family is wider than it was: `Explicit`, `Skip = "..."`, `Assert.Inconclusive` and
// `SpinWait` were all missing.
//
// This one leans CLOSED on purpose: the bare word `Ignore` in a comment will fire. A rejected turn
// costs an iteration; a silently disabled test costs the deliverable.
const FORBIDDEN = new RegExp(
  [
    String.raw`\bThread\s*\.\s*Sleep\s*\(`,
    String.raw`\bTask\s*\.\s*Delay\s*\(`,
    String.raw`\bSpinWait\s*\.\s*Spin\w*\s*\(`,
    String.raw`\bAssert\s*\.\s*(?:Pass|Ignore|Inconclusive)\s*\(`,
    String.raw`\bIgnore(?:Attribute)?\s*(?:\(|\]|=)`,
    String.raw`\bExplicit(?:Attribute)?\s*(?:\(|\])`,
    String.raw`\bSkip\s*=`,
  ].join('|'),
  'g'
);

/** Waits and test-disabling calls. */
export function forbiddenApis(source) {
  return scan(source, FORBIDDEN);
}

// D-14 / §10.8: parameterising one test with several cases hides a skipped case in the trace.
//
// `\s+` between the two words, because `Scenario  Outline:` with two spaces slipped past. Gherkin
// prose is excluded first: `# Examples: see the AC list` and `Examples: none` inside a `"""` docstring
// both used to REJECT a legitimate turn, and a false positive here costs an iteration.
/*
 * Scenarios where a `When` is not answered by a `Then` before the next one -- rubric item 4.
 *
 * The prompt states this rule in one sentence ("each AC step is one `When` (exactly one request)
 * followed by its `Then`") and the rule was still broken: measured on AC-F01-02, where `When the
 * owner's details are updated` ran straight into a second `When` with nothing asserted in between,
 * and the judge spent $2.26 saying so. A request whose result nothing looks at is a step that cannot
 * fail, which is the same defect as an assertion that cannot fail -- it just hides one level up.
 *
 * `And`/`But` continue whichever primary keyword opened the block, which is what makes this a walk
 * rather than a regex: `When ... And ...` is one two-line request block, and the `Then` that answers
 * it may itself be `Then ... And ...`.
 */
export function whenWithoutThen(feature) {
  const problems = [];
  let scenario = null;
  let openWhen = null;
  let answered = true;
  let keyword = null;

  const closeScenario = () => {
    if (!answered && openWhen !== null) {
      problems.push(`${scenario}: "${openWhen.text}" (line ${openWhen.line}) has no Then after it`);
    }
  };

  withoutGherkinProse(feature)
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.trim();
      const scenarioTitle = /^Scenario\s*:\s*(.+)$/.exec(line);
      if (scenarioTitle !== null) {
        closeScenario();
        scenario = scenarioTitle[1].trim();
        openWhen = null;
        answered = true;
        keyword = null;
        return;
      }
      if (scenario === null) return;

      const step = /^(Given|When|Then|And|But)\s+(.*)$/.exec(line);
      if (step === null) return;
      const [, word, text] = step;
      if (word !== 'And' && word !== 'But') keyword = word;

      if (keyword === 'When' && (word === 'When')) {
        closeScenario();
        openWhen = { text, line: index + 1 };
        answered = false;
      } else if (keyword === 'Then' && openWhen !== null) {
        answered = true;
      }
    });

  closeScenario();
  return problems;
}

/*
 * Whether this project asserts with FluentAssertions at all -- the premise `handAssertedStatusCodes`
 * rests on.
 *
 * Without this, that rule is a SILENT PASS on any project that asserts another way. Demonstrated: a
 * step file containing `Assert.That(response.StatusCode, Is.EqualTo(NotFound))` -- the exact defect
 * the rule exists to catch -- produced zero hits, and the gate printed
 * `ok  ...: response codes are left to EnsureStatus`. A green line asserting something false is worse
 * than no line, because nobody investigates green.
 *
 * The rule is bound to C# plus FluentAssertions and is NOT parameterisable into something portable:
 * its pattern is not a value like a host or a port, it is the rule itself. On another stack it is to
 * be deleted and rewritten, not configured. This function is what makes that visible instead of
 * letting the gate lie.
 */
export function usesFluentAssertions(sources) {
  return (sources ?? []).some((source) => /\.\s*Should\s*\(/.test(source.text ?? ''));
}

/*
 * Response codes asserted by hand in a step definition -- rubric items 6 and 18.
 *
 * `EnsureStatus` inside the request step has already enforced the code before the response reaches
 * state, so a `Then` that asserts it again writes an assertion that CANNOT FAIL. Measured on
 * AC-F01-03: `response.StatusCode.Should().Be(HttpStatusCode.NotFound, ...)` sat after a `When` whose
 * `EnsureStatus(NotFound)` had already guaranteed it, and the judge charged $2.39 to point it out.
 *
 * Stated as an ABSOLUTE rather than scoped to `[Then]` methods, and that was measured too: the
 * accepted stage-0 scaffold plus all four F-01 scenarios contain the string zero times, because every
 * code in this design goes through `EnsureStatus`. Scoping it would need a C# body parser to buy
 * nothing. If a project ever needs a hand-written code assertion, this is the rule to revisit -- not
 * the one to work around.
 */
export function handAssertedStatusCodes(sources) {
  return (sources ?? []).flatMap((source) =>
    scan(source.text ?? '', /StatusCode\s*.\s*Should\s*\(/g).map((hit) => ({
      path: source.path,
      line: hit.line,
      match: hit.match,
    }))
  );
}

/** `Scenario Outline` / `Examples` in a feature file. */
export function scenarioOutlines(feature) {
  return scan(
    withoutGherkinProse(feature),
    /(?:Scenario\s+Outline|Scenario\s+Template|Examples|Scenarios)\s*:/g
  );
}

/**
 * Every `@AC-Fxx-yy` tag, in file order.
 *
 * Gherkin comments are excluded, and this one is a fail-OPEN that was measured: `# was @AC-F02-09,
 * dropped` used to be read as coverage of AC-F02-09, so a commented-out tag satisfied the traceability
 * check for an acceptance criterion nobody had written a scenario for.
 */
export function scenarioTags(feature) {
  return [...withoutGherkinProse(feature).matchAll(/@(AC-F\d{2}-\d{2})\b/g)].map((m) => m[1]);
}

/**
 * Tags that look like an AC id but are not one.
 *
 * Without this, `@AC-F02-1` yields no tag at all and the gate reports "no @AC-F02-01 tag — the tag is
 * the entire traceability mechanism", which sends the agent looking for a missing tag rather than at
 * the typo in the one it wrote.
 */
export function malformedAcTags(feature) {
  return scan(withoutGherkinProse(feature), /@AC-[A-Za-z0-9-]*/g).filter(
    (hit) => !/^@AC-F\d{2}-\d{2}$/.test(hit.match)
  );
}

/**
 * A non-English Gherkin dialect, which nothing in this file can read.
 *
 * With a `# language: uk` header, `Структура сценарію:` is a valid Scenario Outline and
 * `scenarioOutlines` is blind to it — §10.8's rule would be unenforced. Rather than carry every
 * Gherkin translation, the gate refuses the dialect: stage 0 writes the feature headers, so they are
 * English by construction and a language header appearing later is itself the anomaly.
 *
 * `(?!en\s*$)`, not `(?!en\b)`. A hyphen IS a word boundary, so the `\b` form accepted every `en-*`
 * dialect — measured accepted: `en-au`, `en-lol`, `en-pirate`, `en-Scouse`. Those are separate Gherkin
 * dialects with their own keyword tables (`en-au` spells Scenario Outline as `Reckon it's like`), which
 * is precisely the condition the paragraph above says would leave §10.8 unenforced. Only the bare tag
 * `en` is English. `\S+` rather than `[a-z-]+` so an underscore form (`en_US`) cannot truncate to `en`
 * and read as English.
 */
export function foreignLanguageHeader(feature) {
  return scan(feature ?? '', /#\s*language\s*:\s*(?!en\s*$)\S+/gi);
}

/** Every scenario title, keyword stripped. Gherkin comments excluded. */
export function scenarioTitles(feature) {
  return [...withoutGherkinProse(feature).matchAll(/^\s*Scenario\s*:\s*(.+?)\s*$/gm)].map((m) => m[1]);
}

/**
 * Every `Excluding(...)` in the diff. NOT a verdict — input data for the judge.
 *
 * `BeEquivalentTo(...).Excluding(x => x.Name)` reads as tidy code and can quietly drop the very
 * field the AC requires comparing. Only the AC text can say whether it is justified, so the
 * script counts them and the judge rules on them (rubric item 5).
 */
export function excludings(source) {
  // `. Excluding(` with a space and `ExcludingMissingMembers()` both weaken the comparison the same
  // way and were invisible, so the judge was never told about them.
  return scan(source, /\.\s*Excluding(?:MissingMembers)?\s*\(/g);
}

/** The only directories a stage-1 turn may touch. Stage 0 has no fence — it builds everything. */
export const STAGE1_ALLOWED = ['Features/', 'StepDefinitions/', 'Data/'];

const PROJECT_PREFIX = `${PROJECT}/`;

/**
 * Repo-relative paths a stage-1 turn had no business changing.
 *
 * This is the guard that stops stage 1 from rewriting the framework to make its own scenario pass, so
 * it fails CLOSED on anything it cannot understand. Four measured bypasses are closed here:
 *
 *   - a `..` segment. `Features/../Support/ResourceTracker.cs` was ALLOWED, because `startsWith` is
 *     meaningless once a path can climb back out. The current caller passes `git diff --name-only`
 *     output, which git normalises, but a guard that depends on its caller's hygiene is not a guard.
 *   - a git rename pair, `old => new`. Only the left side was examined, so the destination went
 *     unchecked. The form is refused rather than parsed, because which side is which depends on the
 *     git output format.
 *   - a `./` prefix, which was flagged as a stray — harmless but a false positive.
 *   - a null or non-string element, which threw `TypeError` instead of returning a verdict.
 */
export function outsideFence(paths) {
  return (paths ?? []).filter((raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return true;

    const normalised = raw.split('\\').join('/').trim().replace(/^\.\//, '');

    // A rename shown as `old => new`, or git's --name-status / -z forms, name TWO paths on one line.
    // Judging only the first let the destination through. Refuse the form rather than guess which git
    // output produced it: --name-status separates with a tab, -z with a NUL.
    if (/=>|\t|\0/.test(normalised)) return true;
    if (normalised.split('/').includes('..')) return true;
    // The runner's own tracker is not a stray, and this exemption is narrow on purpose.
    //
    // The runner writes the tracker and never commits it (`ralph.mjs` contains no `git commit`), so
    // an agent running `git add -A` sweeps it into the turn's commit. Measured on a real run: commit
    // `9b56ba5` carries `S4 todo -> done`, written by the RUNNER after a judge PASS, beside the
    // agent's own `S5 todo -> review`. Without this, every stage-1 rework turn by an `add -A` agent
    // is refused for touching a file no agent edited.
    //
    // Exempting the PATH does not exempt the CONTENT: `forbiddenStatusWrites` in loop/tracker.mjs
    // compares every row's status across the turn and refuses — and undoes — anything the agent had
    // no right to write. This fence asks "did you rewrite the framework"; that one asks "did you
    // rewrite the scoreboard". Two questions, two guards.
    //
    // Exact paths, never a `loop/` prefix: the prompts, the rubrics and the verdicts live there too,
    // and a turn has no business committing any of them.
    if (RUNNER_STATE.includes(normalised)) return false;

    // The run summaries, for the same reason and by the same route: the runner appends a row after
    // every iteration and never commits, so `git add -A` picks them up. A prefix rather than exact
    // names because the filename carries the run's start time. `outsideFence` has already refused a
    // `..` segment above, so this cannot be climbed out of.
    if (normalised.startsWith(RUNS_DIR)) return false;

    if (!normalised.startsWith(PROJECT_PREFIX)) return true;

    const inner = normalised.slice(PROJECT_PREFIX.length);
    return !STAGE1_ALLOWED.some((prefix) => inner.startsWith(prefix));
  });
}
