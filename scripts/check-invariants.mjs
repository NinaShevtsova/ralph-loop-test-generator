// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The automatic inspector for the framework AS A WHOLE.
//
// Its neighbour, check-scaffold.mjs, asks whether the files of a step are present and not
// empty. This one asks the questions that span files: is there exactly one HTTP client,
// does the code call every route the contract describes and no others, can every service
// method be reached from a test step, does the assembly refuse to run tests in parallel.
//
// Every one of those used to be a question put to an AI grader that was shown one step's
// changes at a time — and so could not answer any of them. A pattern gives the same answer
// every time and costs nothing.
//
// Scoped, like its neighbour: early on, the files a rule reads do not exist yet, and a
// gate that cannot pass would stop the loop before it started.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/check-invariants.mjs — the cross-cutting half of the stage-0 gate.
//
// The rules themselves are pure and live in scripts/invariants.mjs, where each has a positive and a
// negative control. This file is only the plumbing: which rules are in scope, which files they read,
// and the exit code. Same shape as check-scaffold.mjs and check-tests.mjs — the `Verdict` class, a
// `--quiet` flag, exit 1 for a failure and exit 2 for a broken invocation.
//
//   node scripts/check-invariants.mjs                     every invariant (the finished scaffold)
//   node scripts/check-invariants.mjs --through-row S6     only those whose files exist by S6
//   node scripts/check-invariants.mjs --quiet

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot, Verdict } from './lib.mjs';
import { PROJECT_DIR, SCAFFOLD_ROWS, rowNeeds } from './manifest.scaffold.mjs';
import {
  extraRestClients,
  hardCodedEnvironment,
  hasNonParallelizable,
  routesInSpec,
  routesInCode,
  routeDifference,
  unusedServiceMethods,
  stepInventoryProblems,
  assemblyWideSetup,
} from './invariants.mjs';

const ROOT = repoRoot(import.meta.url);
const v = new Verdict('check:invariants');

const PROJECT = join(ROOT, PROJECT_DIR);
const CONVENTIONS = join(ROOT, 'docs/specs/petclinic/context-and-conventions.md');

const argAt = (name) => {
  const index = process.argv.indexOf(name);
  // `?? ''` on the VALUE, `null` only for the absent flag. `--through-row` with nothing after it is a
  // mistake, and answering it with the same `null` as "the flag was never passed" would fall through
  // to the unscoped run — the one thing the refusal below exists to prevent. The empty string is not a
  // row the manifest knows, so it is refused with every other unknown scope. check-scaffold.mjs
  // reaches the same place by a different route: `entriesThroughRow(undefined)` returns null there.
  return index === -1 ? null : process.argv[index + 1] ?? '';
};

const rel = (absolute) => relative(ROOT, absolute).split('\\').join('/');

/*
 * Directories and file shapes that are BUILD OUTPUT, not source, and must stay out of every scan.
 *
 * Measured: seven generated `.cs` files sit under this project — four in `obj/Debug/net8.0/` and the
 * three `*.feature.cs` Reqnroll emits beside the feature files. Every one of them is `.gitignore`d, and
 * `.gitignore` is where this list comes from rather than being invented here.
 *
 * The invariants are green with or without them today, so this is not a fix for a red gate. It closes
 * an exposure with a bad failure mode: `*.feature.cs` embeds the Gherkin text as string literals, so a
 * scenario that ever mentioned a port would make I2 red and point the agent at a generated file it
 * cannot edit — a wiring fault reported as a verdict on its work, which is the confusion
 * `loop/gates.mjs` already documents by name. `obj/` is worse still: its contents change with the SDK.
 */
const GENERATED_DIRS = new Set(['obj', 'bin', 'TestResults']);
const GENERATED_FILE = /\.feature\.cs$/;

/** Every hand-written `.cs` file under `dir` as `{ path, text }`. Empty when the directory is absent. */
function sourcesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!GENERATED_DIRS.has(entry.name)) walk(path);
      } else if (entry.name.endsWith('.cs') && !GENERATED_FILE.test(entry.name)) {
        found.push({ path: rel(path), text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Scope ──────────────────────────────────────────────────────────────────────────
//
// Each invariant declares the MANIFEST PATH it depends on, and the scope is derived from that with
// `rowNeeds`. Nothing lists row ids by hand: a hand-written list is a second thing to keep in step
// with the manifest, and it is the manifest that decides which turn builds what.

const targetRow = argAt('--through-row');
if (targetRow !== null && !SCAFFOLD_ROWS.includes(targetRow)) {
  console.error(
    `check:invariants: unknown row ${JSON.stringify(targetRow)} — the manifest knows ` +
      `${SCAFFOLD_ROWS.join(', ')}.\n` +
      '  Refused rather than falling through to the full run: unscoped, this gate is red until the\n' +
      '  last row of the stage, and the runner would report that as a verdict on the turn.'
  );
  process.exit(2);
}

const p = (relativePath) => `${PROJECT_DIR}/${relativePath}`;

/** How many invariants actually ran. See the guard above `v.report` at the bottom of this file. */
let ran = 0;

/** Whether a rule whose files arrive with `dependsOn` is in scope for this run. */
function inScope(dependsOn) {
  if (targetRow === null) {
    ran += 1;
    return true;
  }
  const needs = rowNeeds(targetRow, dependsOn);
  if (needs === null) {
    console.error(
      `check:invariants: the manifest does not know ${dependsOn}, so its invariant cannot be scoped`
    );
    process.exit(2);
  }
  if (needs) ran += 1;
  return needs;
}

// ── The invariants ─────────────────────────────────────────────────────────────────

// I1 — one RestClient, in ApiClient.
if (inScope(p('Http/ApiClient.cs'))) {
  const extras = extraRestClients(sourcesUnder(PROJECT), { clientPath: 'Http/ApiClient.cs' });
  v.check(
    extras.length === 0,
    'one RestClient, constructed in Http/ApiClient.cs',
    `${extras.length} RestClient(s) beyond the one in ApiClient: ` +
      `${extras.map((hit) => `${hit.path}:${hit.line}`).join(', ')} — ` +
      'a "reusable request specification" each service rebuilds for itself is not reusable'
  );
}

// I2 — no literal environment.
if (inScope(p('Config/SettingsLoader.cs'))) {
  // The SUT's own host and port. Named here, in the plumbing, so the rule in invariants.mjs stays
  // portable: pointing this harness at another API changes these two values and nothing else.
  const literals = hardCodedEnvironment(sourcesUnder(PROJECT), { host: 'localhost', port: 9966 });
  v.check(
    literals.length === 0,
    'no hard-coded base URL or port in C#',
    `literal environment at ${literals.map((h) => `${h.path}:${h.line} (${h.match})`).join(', ')} — ` +
      'the base URL comes from appsettings.json through SettingsLoader, overridable by PETCLINIC_BASE_URL'
  );
}

// I3 — the contract's routes and the code's routes are one set.
if (inScope(p('Services/OwnersService.cs'))) {
  const spec = existsSync(CONVENTIONS) ? routesInSpec(readFileSync(CONVENTIONS, 'utf8')) : null;
  if (spec === null) {
    // Fail-closed, and named. An empty set would compare equal to "nothing missing" and retire the
    // check, which is the fail-open this whole file exists to refuse.
    v.fail(
      `route coverage: the §7 route table could not be read from ${rel(CONVENTIONS)} — ` +
        'this is not the same as "the contract asks for no routes"'
    );
  } else {
    const code = routesInCode(sourcesUnder(join(PROJECT, 'Services')));
    const { missing, extra } = routeDifference(spec, code);
    v.check(
      missing.length === 0 && extra.length === 0,
      `route coverage: all ${spec.size} routes of §7 are called by a service`,
      [
        'route coverage diverges from §7 of the conventions',
        missing.length ? `      missing from the services: ${missing.join(', ')}` : '',
        extra.length ? `      called but not in the contract: ${extra.join(', ')}` : '',
        '      a missing route stalls a later AC; an extra one means code and contract have parted',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

// I4 — the assembly refuses parallel execution.
if (inScope(p('AssemblyInfo.cs'))) {
  const path = join(PROJECT, 'AssemblyInfo.cs');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  v.check(
    hasNonParallelizable(text),
    'the assembly is NonParallelizable',
    'AssemblyInfo.cs does not carry [assembly: NonParallelizable] — §10.7 forbids parallel ' +
      'execution, because the tests share one database and count assertions would stop being ' +
      'deterministic. A commented-out attribute does not count'
  );
}

/*
 * I7 — no assembly-wide setup hook.
 *
 * The other half of the row that owns I4, and the one that had no check anywhere. Three separate
 * comments in this harness describe the rule in prose — the manifest entry for `ScenarioHooks.cs`,
 * S11's DoD in the tracker, and the gate that stopped running a filtered unit suite because of it —
 * and until now not one line of code enforced it.
 *
 * The manifest's own probe cannot: `check-scaffold.mjs` only ever asks whether a marker is PRESENT, so
 * a file carrying both a `Lazy<Task>` and a `[BeforeTestRun]` satisfies every probe on it while
 * reintroducing the 96-second regression in full.
 *
 * EXPECTED RED before the first regeneration. `Hooks/ScenarioHooks.cs` in the accepted scaffold carries
 * `[BeforeTestRun]` at line 19 — that is the defect this rule names, not a fault in the rule, and it is
 * the same standing as the six forward requirements `check:scaffold` already reports. Scoped to S11, so
 * it enters the gate exactly on the turn that writes the file.
 */
if (inScope(p('Hooks/ScenarioHooks.cs'))) {
  const hooks = assemblyWideSetup(sourcesUnder(PROJECT));
  v.check(
    hooks.length === 0,
    'no assembly-wide setup hook — readiness is awaited per scenario',
    `assembly-wide setup at ${hooks.map((h) => `${h.path}:${h.line} (${h.match})`).join(', ')} — ` +
      'NUnit runs an assembly-level fixture for ANY test in the assembly, so this makes even ' +
      '`dotnet test --filter TestCategory=Unit` wait out the readiness budget: measured at 96 s and ' +
      'red with the container stopped. Await readiness in [BeforeScenario(Order = -1)] behind a ' +
      'Lazy<Task> instead — a unit test has no scenario, so it never pays for one'
  );
}

// I5 and I6 — the steps. Both depend on the step definitions existing.
if (inScope(p('StepDefinitions/OwnerSteps.cs'))) {
  const services = sourcesUnder(join(PROJECT, 'Services'));
  const steps = sourcesUnder(join(PROJECT, 'StepDefinitions'));

  const unused = unusedServiceMethods(services, steps);
  v.check(
    unused.length === 0,
    'every service method is reachable from a step definition',
    `no step calls ${unused.map((h) => `${h.path} ${h.method}()`).join(', ')} — ` +
      'the route exists and no scenario can reach it, which stalls a later AC'
  );

  // There is NO expected count here, and the ok line must not imply one. `stepInventoryProblems` had
  // its count half removed after measurement — 97 bindings on the ACCEPTED scaffold against the 22
  // routes of §7, because the 52 `Then` bindings are assertion steps whose number is not a function
  // of the routes, and stage 1 adds more as it writes scenarios. What that count was reaching for is
  // proven twice over anyway: I3 says every §7 route is called by a service and I5 says every service
  // method is reachable from a step, so together they say every route is reachable from a scenario.
  //
  // So this line reports only what it checked. A green line stating a number nothing verified — and
  // which measurement had already shown to be wrong by a factor of four — is exactly the fail-open
  // this file exists to refuse.
  const problems = stepInventoryProblems(steps);
  v.check(
    problems.length === 0,
    `step inventory: ${steps.length} step file(s), no sentence bound twice`,
    `step inventory:\n      ${problems.join('\n      ')}`
  );
}

/*
 * Row S1 builds the solution skeleton, and nothing any invariant reads exists yet — so at S1 NOTHING
 * is in scope and not one check runs. `Verdict.report` refuses to call that green, on the correct
 * grounds that a checker which checked nothing is a broken checker. Both positions are right, so this
 * says which case it is.
 *
 * Without this line the stage-0 gate goes red on the FIRST row of every from-scratch run — the worst
 * possible place, because the runner reads a red pre-turn gate as fatal and the operator has spent an
 * agent turn to be told the harness is broken.
 */
if (ran === 0) {
  v.pass(
    `no invariant applies at or before ${targetRow} — every file they read is built by a later row`
  );
}

v.report({ quiet: process.argv.includes('--quiet') });
