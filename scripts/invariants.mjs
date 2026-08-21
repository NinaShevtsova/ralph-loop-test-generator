// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The rules about the framework AS A WHOLE, written as code instead of prose.
//
// Each function here answers one question that cannot be answered by looking at a single
// file in isolation: is there exactly one HTTP client, is every route of the contract
// really wired up, is every service method actually used by a test step. Until these
// existed, all of them were questions put to an AI grader — which was shown one file at a
// time and therefore could not answer them.
//
// Everything here is a pure function over file contents: no reading, no writing, no
// exiting. That is what makes each rule testable both ways — green on the code that was
// accepted, red on a deliberate violation.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/invariants.mjs — the cross-cutting invariants of the stage-0 scaffold, as pure functions.
//
// Same shape as scripts/checks.mjs: every export takes text (or a list of `{ path, text }`) and
// returns a VERDICT about it — no reading, no writing, no exiting. The verdict's shape follows the
// question, not a house style, because forcing all seven into one shape would only make the caller
// unpack it again:
//
//   extraRestClients, hardCodedEnvironment   a list of hits, `{ path, line, match }`
//   assemblyWideSetup                        the same shape
//   unusedServiceMethods                     a list of hits, `{ path, method }`
//   stepInventoryProblems                    a list of sentences, already readable
//   hasNonParallelizable                     a boolean — the file either declares it or it does not
//   routesInSpec, routesInCode               a Set of routes (routesInSpec: `null` when unreadable)
//   routeDifference                          `{ missing, extra }`, the two-way diff of those sets
//
// For the list-shaped ones, empty means "nothing is wrong". The CLI that reads files and decides an
// exit code is scripts/check-invariants.mjs; keeping the two apart is what lets
// tests/invariants.test.mjs give every rule a positive AND a negative control without a temporary
// directory.
//
// Each rule below says which way it leans when a regex cannot be sure. Failing CLOSED rejects correct
// work and costs an iteration; failing OPEN lets a defect through to the judge, which is the backstop.

import { extractSteps } from './steps-inventory.mjs';

/** Hits for a global regex over one source, with 1-based line numbers. */
function scan(path, text, pattern) {
  const hits = [];
  (text ?? '').split('\n').forEach((line, index) => {
    for (const m of line.matchAll(pattern)) {
      hits.push({ path, line: index + 1, match: m[0].trim() });
    }
  });
  return hits;
}

/** The same, over a list of `{ path, text }`. */
const scanAll = (sources, pattern) =>
  (sources ?? []).flatMap((source) => scan(source.path, source.text, pattern));

// `new` and the type may be separated by any whitespace — `new   RestClient(o)` is legal C#.
const REST_CLIENT = /\bnew\s+RestClient\s*\(/g;

/**
 * Every construction of a `RestClient` beyond the first one inside `Http/ApiClient.cs` — I1.
 *
 * Rubric check 1 of the stage-0 judge, which could never answer it from one row's diff: when S4 is
 * graded the services do not exist, and when S5 is graded `ApiClient` is not in the diff. The
 * property is about the whole tree, so it belongs to a check that sees the whole tree.
 *
 * The FIRST construction inside ApiClient is the legitimate one; everything else is a hit, including
 * a second one inside ApiClient itself. "One client for the whole run" is not "one construction
 * site": two instances there still lets the four services be handed different ones.
 */
export function extraRestClients(sources, { clientPath } = {}) {
  // A PARAMETER, not a literal. The rule "exactly one client, and it lives in the one place that owns
  // it" is not specific to this project; the path is. Keeping the path out here is what lets the same
  // rule be pointed at another framework by changing one call site rather than editing the rule.
  if (typeof clientPath !== 'string' || clientPath === '') {
    throw new Error('extraRestClients: clientPath is required — it names the file allowed to construct one');
  }

  const all = scanAll(sources, REST_CLIENT);
  const legitimate = all.find((hit) => hit.path.endsWith(clientPath));
  return all.filter((hit) => hit !== legitimate);
}

/** A regex-safe copy of a literal. A host may carry a dot; a port may not, but symmetry is cheaper. */
const quote = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The host and the port, separately. Either one alone pins the framework to a machine.
 *
 * PARAMETERS rather than literals, for the reason `clientPath` is one: the rule travels, the values do
 * not. `scripts/check-invariants.mjs` supplies the SUT's own host and port.
 *
 * Leans OPEN on comments: a `//` line is stripped before scanning, because a comment cannot reach the
 * network and a false red costs a legitimate turn. A literal in code still fires.
 */
const hardCodedPattern = ({ host, port }) =>
  new RegExp(`https?://${quote(host)}|\\b${quote(port)}\\b`, 'gi');

/**
 * Literal environment in C# source — I2.
 *
 * Rubric check 2. The base URL comes from `appsettings.json` through `SettingsLoader` and is
 * overridable by `PETCLINIC_BASE_URL`; a literal defeats both, and D-10 rests on the delivered
 * framework being runnable against a shared environment rather than nailed to one machine.
 */
export function hardCodedEnvironment(sources, { host, port } = {}) {
  if (!host || !port) {
    throw new Error('hardCodedEnvironment: host and port are required — they are the SUT\'s, not this rule\'s');
  }

  const withoutComments = (sources ?? []).map((source) => ({
    path: source.path,
    text: (source.text ?? '')
      .split('\n')
      .map((line) => (line.trim().startsWith('//') ? '' : line))
      .join('\n'),
  }));
  return scanAll(withoutComments, hardCodedPattern({ host, port }));
}

// Whether a line of C# is ACTIVE code rather than a comment. A `//` line and a single-line block
// comment both mean "not active". Measured before this existed: a block-commented
// `[assembly: NonParallelizable]` satisfied I4, and I4 is the ONLY check on that DoD — there is no
// judge behind it to catch what a lean-open lets through. Shared with I7, where a disabled attribute
// is the same shape of lie.
//
// Deliberately NOT a comment parser: a MULTI-line block comment is not tracked, so an attribute inside
// one still reads as active. That leans CLOSED — it can reject correct work, which costs an iteration,
// rather than let a regression through, which costs a stage.
const isActiveCode = (line) => {
  const trimmed = line.trim();
  return !trimmed.startsWith('//') && !(trimmed.startsWith('/*') && trimmed.endsWith('*/'));
};

// Every line of a source blanked unless it is active code, so reported line numbers still line up
// with the file. Same trick as `hardCodedEnvironment`, which strips its comments the same way.
const activeOnly = (sources) =>
  (sources ?? []).map((source) => ({
    path: source.path,
    text: (source.text ?? '')
      .split('\n')
      .map((line) => (isActiveCode(line) ? line : ''))
      .join('\n'),
  }));

/**
 * Whether the assembly declares itself non-parallelisable — I4.
 *
 * §10.7 forbids parallel execution: the tests share one database, so assertions on collection counts
 * would stop being deterministic. S11's DoD requires the attribute and nothing checked for it — not
 * the manifest, whose probe for `AssemblyInfo.cs` is coarse, and not the rubric, which has no item
 * for it.
 *
 * A commented-out attribute is NOT a hit, which is the whole point: `// [assembly: ...]` is the exact
 * shape this regression takes.
 */
export function hasNonParallelizable(text) {
  return (text ?? '')
    .split('\n')
    .filter(isActiveCode)
    .some((line) => /\[\s*assembly\s*:\s*(?:[\w.]+\.)?NonParallelizable(?:Attribute)?\s*\]/.test(line));
}

/*
 * Every assembly-wide setup hook in hand-written sources — I7. Empty is the only acceptable answer.
 *
 * This is the OTHER half of S11's DoD, and the half nothing checked at all. Reqnroll turns a
 * `[BeforeTestRun]` into an assembly-level `[SetUpFixture]` (`obj/.../NUnit.AssemblyHooks.*.cs`), and
 * NUnit runs a SetUpFixture for ANY test run in the assembly — filter or no filter. So one attribute
 * on one method makes every `dotnet test --filter TestCategory=Unit` sit out the readiness budget:
 * measured at 96 s and RED with the container stopped, which is three consecutive red gates and a dead
 * run at K_FAILURES=3.
 *
 * Readiness belongs in `[BeforeScenario(Order = -1)]` behind a `Lazy<Task>` instead. A unit test has no
 * scenario, so the hook never fires for it, while the twenty BDD scenarios still get a ready API.
 *
 * Both spellings are checked because both produce that fixture: `[BeforeTestRun]` is Reqnroll's, and a
 * hand-written `[SetUpFixture]` is NUnit's own reaching the same place by a different road. Optional
 * argument list, optional `Attribute` suffix, optional qualification — all legal C#, all of them run.
 *
 * `[OneTimeSetUp]` is deliberately NOT here. Inside a test fixture it is scoped to that fixture, and
 * `Tests/Smoke/FrameworkSmokeTests.cs` uses exactly that, correctly, to await readiness for its own
 * three tests. Forbidding it would go red on accepted work — D-30 — and it is not what costs the 96 s.
 *
 * The caller excludes generated sources, which matters more here than anywhere else: the fixture this
 * rule is about IS a generated file, and flagging it would point the agent at code it cannot edit.
 */
const ASSEMBLY_WIDE_SETUP =
  /\[\s*(?:global::)?(?:[\w.]+\.)?(?:BeforeTestRun|SetUpFixture)(?:Attribute)?\s*(?:\([^)]*\))?\s*\]/g;

export function assemblyWideSetup(sources) {
  return scanAll(activeOnly(sources), ASSEMBLY_WIDE_SETUP);
}

// A route as the specification writes it, inside backticks: `POST /owners/{ownerId}/pets`.
const SPEC_ROUTE = /`(GET|POST|PUT|DELETE)\s+(\/[A-Za-z0-9{}/_-]*)`/g;

// A route as a service calls it. The verb is the method name; the path is the first string argument
// and carries no leading slash. `(?:<[^(]*>)?` swallows a nested generic — `Get<List<Owner>>` has two
// closing brackets before the paren, and `[^(]` is what lets it reach the last of them.
const CODE_ROUTE = /_client\.(Get|Post|Put|Delete)\s*(?:<[^(]*>)?\s*\(\s*"([^"]+)"/g;

const ROUTE_TABLE_HEADING = '### Routes and their asymmetry';

/**
 * The routes the contract asks for — I3, the specification side. `null` when the table is absent.
 *
 * SCOPED TO THE TABLE, and that is not tidiness. Measured on the real conventions file: a
 * whole-document scan finds 28 routes against the services' 22, because §10.1 uses `GET /owners/1` as
 * an illustration of why a literal id proves nothing and §11 writes the delete routes as
 * `DELETE /pets/{id}`. Unscoped, this invariant would have gone red on the accepted scaffold — which
 * is the one thing a new check must not do.
 *
 * `null` rather than an empty set when the heading is gone: an empty set compares equal to nothing
 * missing, so a renamed heading would silently retire the check.
 */
export function routesInSpec(markdown) {
  const text = markdown ?? '';
  const start = text.indexOf(ROUTE_TABLE_HEADING);
  if (start === -1) return null;

  // From the heading to the next `###`, so the models table and the response-code table stay out.
  const rest = text.slice(start + ROUTE_TABLE_HEADING.length);
  const end = rest.indexOf('\n###');
  const table = end === -1 ? rest : rest.slice(0, end);

  return new Set([...table.matchAll(SPEC_ROUTE)].map((m) => `${m[1]} ${m[2]}`));
}

/** The routes the services actually call — I3, the code side. */
export function routesInCode(sources) {
  const routes = new Set();
  for (const source of sources ?? []) {
    for (const m of (source.text ?? '').matchAll(CODE_ROUTE)) {
      routes.add(`${m[1].toUpperCase()} /${m[2]}`);
    }
  }
  return routes;
}

/**
 * The two-way difference between what the contract asks for and what the code calls.
 *
 * BOTH directions, because they are different faults with the same cause. A route the contract names
 * and the code lacks stalls a later acceptance criterion — S5's DoD says "not almost all". A route
 * the code has and the contract does not means the two have parted, and the contract is the input the
 * whole run is graded against.
 */
export function routeDifference(spec, code) {
  return {
    missing: [...spec].filter((route) => !code.has(route)).sort(),
    extra: [...code].filter((route) => !spec.has(route)).sort(),
  };
}

/*
 * A public method declaration: `public <type> <Name>(`.
 *
 * A CONSTRUCTOR cannot match this, and that exclusion is structural rather than a name comparison.
 * `public\s+` consumes `public `, and the pattern then requires a type followed by whitespace before
 * the name — `public PetsService(` has nothing between them, so there is no match to reject. That is
 * worth knowing: a name-based exclusion would have to be kept in step with every renamed class.
 */
const PUBLIC_METHOD = /public\s+[^()\n]*?\s+([A-Za-z_]\w*)\s*\(/g;

/**
 * Service methods no step definition mentions — I5.
 *
 * Nothing checked this. The manifest asks whether `Services/*.cs` exist and hold a route or two; the
 * rubric asks whether every route of §7 is present. Neither asks whether a step can REACH the route,
 * and an unreachable route is a stage-1 turn that has no legal way to satisfy its acceptance
 * criterion — discovered many waves after the wave that caused it.
 *
 * Leans OPEN: a mention anywhere in any step file counts, with no attempt to resolve the receiver.
 * A stricter reading would need dataflow, and a false red here blocks correct work.
 */
export function unusedServiceMethods(serviceSources, stepSources) {
  const steps = (stepSources ?? []).map((source) => source.text ?? '').join('\n');
  const hits = [];

  for (const source of serviceSources ?? []) {
    for (const m of (source.text ?? '').matchAll(PUBLIC_METHOD)) {
      const method = m[1];
      if (!new RegExp(String.raw`\.\s*${method}\s*\(`).test(steps)) {
        hits.push({ path: source.path, method });
      }
    }
  }
  return hits;
}

/**
 * What is wrong with the step inventory — I6. An empty list means nothing is.
 *
 * S12 is the largest row of the stage — four files, `OwnerSteps.cs` alone is 709 lines — and no check
 * reached it: the manifest asks only that the four files exist and are non-trivial, and no rubric item
 * mentions them at all.
 *
 * There is NO count check here, and that is a measured decision rather than an omission. Counting
 * bindings against the §7 route set reported `97 step(s) declared, expected 22` on the accepted
 * scaffold. Two reasons no number works: D-13 says 22 *request* steps, and the 52 `Then` bindings are
 * assertion steps whose number is not a function of the routes; and the quantity changes between
 * stages, because stage 1 adds assertion steps as it writes scenarios. What the count was reaching for
 * is already proven twice over — I3 shows every §7 route is called by a service, I5 shows every service
 * method is reachable from a step, and together they say every route of the contract is reachable from
 * a scenario. The raw binding count says nothing.
 *
 * The same sentence bound as `[Given]` and as `[When]` is NOT a repeat: that is Reqnroll's documented
 * way to make one step serve as a precondition and as an action, the scaffold produces nine such pairs
 * on purpose — measured, and every `Given` in it re-binds a sentence that is also a `When` — and
 * `scripts/check-tests.mjs` exempts the identical shape.
 */
export function stepInventoryProblems(sources) {
  const steps = (sources ?? []).flatMap((source) =>
    extractSteps(source.text).map((step) => ({ ...step, path: source.path }))
  );
  const problems = [];

  const seen = new Map();
  for (const step of steps) {
    const key = `${step.kind} ${step.text}`;
    if (seen.has(key)) {
      problems.push(
        `[${step.kind}] "${step.text}" is bound twice — ${seen.get(key)} and ${step.path}`
      );
    } else {
      seen.set(key, step.path);
    }
  }

  return problems;
}
