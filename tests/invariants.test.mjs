// tests/invariants.test.mjs — the pure half of the stage-0 invariants.
//
// Every invariant gets a POSITIVE control (the shape the accepted scaffold actually uses must stay
// green) and a NEGATIVE control (an injected violation must go red). Both halves are required: a
// check that has never gone red proves nothing, and a check that goes red on accepted work is too
// strict and would stop a legitimate run. That is the lesson `scripts/mutation-control.mjs` records.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
} from '../scripts/invariants.mjs';

const CLIENT = 'framework/src/PetClinic.ApiTests/Http/ApiClient.cs';
const SERVICE = 'framework/src/PetClinic.ApiTests/Services/PetsService.cs';

// The project-specific half of I1 and I2, passed in rather than baked into the rules. The CLI supplies
// the same values from one place; see scripts/check-invariants.mjs.
const CLIENT_OPTS = { clientPath: 'Http/ApiClient.cs' };
const ENV_OPTS = { host: 'localhost', port: 9966 };

// ── I1: one RestClient, and it lives in ApiClient ────────────────────────────────────

test('I1 is green when the only RestClient is constructed inside ApiClient', () => {
  const sources = [
    { path: CLIENT, text: 'private static readonly RestClient Client = new RestClient(options);' },
    { path: SERVICE, text: 'public PetsService(ApiClient client) { _client = client; }' },
  ];
  assert.deepEqual(extraRestClients(sources, CLIENT_OPTS), []);
});

test('I1 goes red on a second RestClient in a service', () => {
  const sources = [
    { path: CLIENT, text: 'new RestClient(options);' },
    { path: SERVICE, text: 'private readonly RestClient _own = new RestClient("http://x");' },
  ];
  const hits = extraRestClients(sources, CLIENT_OPTS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, SERVICE);
  assert.equal(hits[0].line, 1);
});

test('I1 goes red when ApiClient itself builds two clients', () => {
  // "One client for the whole run" is not "one construction site" — two instances inside ApiClient
  // still means the four services can be handed different ones.
  const sources = [{ path: CLIENT, text: 'new RestClient(a);\nnew RestClient(b);' }];
  const hits = extraRestClients(sources, CLIENT_OPTS);
  assert.equal(hits.length, 1, 'the second construction is the violation');
  assert.equal(hits[0].line, 2);
});

test('I1 allows whitespace between new and the type, because C# does', () => {
  const sources = [{ path: SERVICE, text: 'var c = new   RestClient(o);' }];
  assert.equal(extraRestClients(sources, CLIENT_OPTS).length, 1);
});

// ── I2: no hard-coded environment ────────────────────────────────────────────────────

test('I2 is green on a settings loader that reads the URL from configuration', () => {
  const sources = [
    { path: 'x/SettingsLoader.cs', text: 'settings.BaseUrl = configuration["baseUrl"]!;' },
  ];
  assert.deepEqual(hardCodedEnvironment(sources, ENV_OPTS), []);
});

test('I2 goes red on a literal base URL', () => {
  const sources = [{ path: 'x/SettingsLoader.cs', text: 'var url = "http://localhost:9966/petclinic/api";' }];
  const hits = hardCodedEnvironment(sources, ENV_OPTS);
  // TWO hits, not one: the rule looks for the host and the port SEPARATELY, because either alone
  // pins the framework to a machine, and this line carries both. Reporting them twice is noisier
  // than it needs to be but never wrong — and the alternative, one hit per line, would hide a port
  // that is hard-coded next to a host that is not.
  assert.equal(hits.length, 2);
  assert.match(hits[0].match, /localhost/);
  assert.match(hits[1].match, /9966/);
});

test('I2 goes red on the port alone, and on https', () => {
  assert.equal(hardCodedEnvironment([{ path: 'a.cs', text: 'const int Port = 9966;' }], ENV_OPTS).length, 1);
  assert.equal(hardCodedEnvironment([{ path: 'a.cs', text: '"https://localhost/x"' }], ENV_OPTS).length, 1);
});

test('I2 does not fire on the word localhost inside a comment about configuration', () => {
  // Leaning open here is deliberate: a comment cannot reach the network, and a false red costs a
  // legitimate turn. A literal URL in code is what I2 is for, and that still fires above.
  const sources = [{ path: 'a.cs', text: '// the base URL is not localhost by default' }];
  assert.deepEqual(hardCodedEnvironment(sources, ENV_OPTS), []);
});

// ── I4: the assembly refuses parallel execution ──────────────────────────────────────

test('I4 is green on the attribute as the scaffold writes it', () => {
  assert.equal(hasNonParallelizable('[assembly: NonParallelizable]'), true);
});

test('I4 accepts the fully qualified and Attribute-suffixed spellings', () => {
  assert.equal(hasNonParallelizable('[assembly: NUnit.Framework.NonParallelizable]'), true);
  assert.equal(hasNonParallelizable('[assembly: NonParallelizableAttribute]'), true);
});

test('I4 goes red when the attribute is missing', () => {
  assert.equal(hasNonParallelizable('using NUnit.Framework;\n'), false);
});

test('I4 goes red when the attribute is only commented out', () => {
  // §10.7 forbids parallel execution: the tests share one database and count assertions would stop
  // being deterministic. A commented attribute is exactly the shape of that regression.
  assert.equal(hasNonParallelizable('// [assembly: NonParallelizable]'), false);
});

test('I4 goes red on a block-commented attribute too', () => {
  // Measured before the filter handled it: this returned true. I4 has no rubric item behind it, so a
  // lean-open here has nothing to catch it.
  assert.equal(hasNonParallelizable('/* [assembly: NonParallelizable] */'), false);
  assert.equal(hasNonParallelizable('  /* [assembly: NonParallelizable] */  '), false);
});

test('I4 tolerates CRLF, which every real .cs file here uses', () => {
  // `.gitattributes` leaves C# at the platform default, so these files are CRLF on Windows. Nothing
  // in the suite covered it; the regex happens to tolerate the trailing \r and this pins that.
  assert.equal(hasNonParallelizable('using X;\r\n[assembly: NonParallelizable]\r\n'), true);
});

// ── I7: no assembly-wide setup hook ─────────────────────────────────────
//
// The one invariant whose positive control is a FIXTURE rather than the accepted scaffold, and the
// reason is on the record: the accepted `Hooks/ScenarioHooks.cs` declares `[BeforeTestRun]`, which is
// the 96-second regression this rule exists to stop. The fixture below is the shape S11's DoD asks
// for, and tests/check-invariants.test.mjs pins the red on the real tree.

const HOOKS = 'framework/src/PetClinic.ApiTests/Hooks/ScenarioHooks.cs';
const SMOKE = 'framework/src/PetClinic.ApiTests/Tests/Smoke/FrameworkSmokeTests.cs';

// Readiness awaited per scenario, memoised, exactly as the DoD asks.
const COMPLIANT_HOOKS = {
  path: HOOKS,
  text: [
    '[Binding]',
    'public sealed class ScenarioHooks',
    '{',
    '    private static readonly Lazy<Task> Ready = new(() => ReadinessProbe.WaitUntilReady());',
    '',
    '    [BeforeScenario(Order = -1)]',
    '    public Task AwaitReadiness() => Ready.Value;',
    '',
    '    [BeforeScenario(Order = 0)]',
    '    public void RegisterServices() { }',
    '',
    '    [AfterScenario]',
    '    public Task DrainResources() => _container.Resolve<ResourceTracker>().Drain();',
    '}',
  ].join('\n'),
};

test('I7 is green on hooks that await readiness per scenario', () => {
  assert.deepEqual(assemblyWideSetup([COMPLIANT_HOOKS]), []);
});

test('I7 goes red on [BeforeTestRun], and names the file and the line', () => {
  // The measured regression: Reqnroll turns this into an assembly-level [SetUpFixture], NUnit runs a
  // SetUpFixture for any test in the assembly, and `--filter TestCategory=Unit` then waits out the
  // readiness budget — 96 s and red with the container stopped.
  const hits = assemblyWideSetup([
    { path: HOOKS, text: 'class X\n{\n    [BeforeTestRun]\n    public static Task R() => P();\n}\n' },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, HOOKS);
  assert.equal(hits[0].line, 3);
  assert.equal(hits[0].match, '[BeforeTestRun]');
});

test('I7 also goes red on a hand-written [SetUpFixture], which reaches the same fixture', () => {
  // Forbidding only the Reqnroll spelling would leave the NUnit one open, and the cost is identical.
  const hits = assemblyWideSetup([{ path: HOOKS, text: '[SetUpFixture]\npublic class Global { }\n' }]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test('I7 accepts the qualified, suffixed and argument-carrying spellings, because C# does', () => {
  const spellings = [
    '[global::NUnit.Framework.SetUpFixtureAttribute()]',
    '[Reqnroll.BeforeTestRun]',
    '[BeforeTestRunAttribute]',
    '[BeforeTestRun(Order = 1)]',
  ];
  for (const spelling of spellings) {
    assert.equal(assemblyWideSetup([{ path: HOOKS, text: spelling }]).length, 1, spelling);
  }
});

test('I7 does NOT fire on [OneTimeSetUp] inside a test fixture', () => {
  // D-30. `Tests/Smoke/FrameworkSmokeTests.cs` awaits readiness in its own [OneTimeSetUp], correctly:
  // scoped to one fixture, it costs nothing to a unit test in the same assembly. A rule that flagged
  // it would go red on accepted work, and it is not what costs the 96 s.
  const hits = assemblyWideSetup([
    { path: SMOKE, text: '[OneTimeSetUp]\npublic Task OneTimeSetUp() => ReadinessProbe.WaitUntilReady();\n' },
  ]);
  assert.deepEqual(hits, []);
});

test('I7 ignores a commented-out attribute, in either comment form', () => {
  // The mirror of I4's block-comment case, and the same reasoning: a disabled attribute does not run.
  const commented = [
    '// [BeforeTestRun]',
    '/* [BeforeTestRun] */',
    '   //   [SetUpFixture]',
  ];
  for (const text of commented) {
    assert.deepEqual(assemblyWideSetup([{ path: HOOKS, text }]), [], text);
  }
});

test('I7 reports every hit, so a second one is not hidden behind the first', () => {
  const hits = assemblyWideSetup([
    { path: HOOKS, text: '[BeforeTestRun]\n' },
    { path: SMOKE, text: 'using X;\n[SetUpFixture]\n' },
  ]);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
});

test('I7 tolerates CRLF and an empty source list', () => {
  assert.equal(assemblyWideSetup([{ path: HOOKS, text: 'using X;\r\n[BeforeTestRun]\r\n' }]).length, 1);
  assert.deepEqual(assemblyWideSetup([]), []);
  assert.deepEqual(assemblyWideSetup(), []);
});

// ── I3: the contract's routes and the code's routes are the same set ─────────────────────

const CONVENTIONS = `
## 7. API conventions

### Routes and their asymmetry (the key to the integration scenarios)

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| \`Owner\` | \`POST /owners\` | \`GET /owners\`, \`GET /owners/{ownerId}\` | \`PUT /owners/{ownerId}\` | \`DELETE /owners/{ownerId}\` |
| \`Pet\` | **only** \`POST /owners/{ownerId}/pets\` | \`GET /pets\` | — | **only** \`DELETE /pets/{petId}\` |

### Data models (abridged; in full — in the contract)

An example elsewhere in the document: \`GET /owners/1\` proves nothing.
`;

test('I3 reads the route table and nothing else in the document', () => {
  // The conventions file mentions routes in §10.1 and §11 as well. Measured on the real file: the
  // whole-document scan finds 28 routes against the code's 22 and would go red on accepted work.
  const routes = routesInSpec(CONVENTIONS);
  assert.ok(routes.has('GET /owners/{ownerId}'));
  assert.ok(routes.has('DELETE /pets/{petId}'));
  assert.ok(!routes.has('GET /owners/1'), 'the illustration outside the table must not be a route');
  // Eight, counted off the fixture above: five in the `Owner` row (POST /owners, GET /owners,
  // GET /owners/{ownerId}, PUT /owners/{ownerId}, DELETE /owners/{ownerId}) and three in the `Pet`
  // row (POST /owners/{ownerId}/pets, GET /pets, DELETE /pets/{petId}). The number is here to pin
  // the SIZE of the scope: it is what goes wrong if the slice ever runs past the next `###`.
  assert.equal(routes.size, 8);
});

test('I3 returns null when the route table is not there at all', () => {
  // Fail-closed: the CLI turns null into a red gate naming the reason, never into an empty set that
  // would read as "the specification asks for no routes" and pass.
  assert.equal(routesInSpec('# A document with no route table\n'), null);
});

test('I3 reads the routes out of the services, verb from the method name', () => {
  const sources = [
    {
      path: 'Services/OwnersService.cs',
      text: [
        'public Task<ApiResponse<Owner>> Create(Owner o) => _client.Post<Owner>("owners", o);',
        'public Task<ApiResponse<List<Owner>>> GetAll() => _client.Get<List<Owner>>("owners");',
        'public Task<ApiResponse> Delete(int id) =>',
        '    _client.Delete("owners/{ownerId}", b => b.WithPathParam("ownerId", id));',
      ].join('\n'),
    },
  ];
  const routes = routesInCode(sources);
  assert.deepEqual(
    [...routes].sort(),
    ['DELETE /owners/{ownerId}', 'GET /owners', 'POST /owners']
  );
});

test('I3 survives a nested generic in the return type', () => {
  // `Get<List<Owner>>` has two closing angle brackets before the paren; a lazy pattern stops early.
  const sources = [{ path: 's.cs', text: '_client.Get<List<Owner>>("owners");' }];
  assert.deepEqual([...routesInCode(sources)], ['GET /owners']);
});

test('I3 reports a route the contract asks for and the code does not have', () => {
  const spec = new Set(['GET /owners', 'PUT /owners/{ownerId}']);
  const code = new Set(['GET /owners']);
  assert.deepEqual(routeDifference(spec, code), {
    missing: ['PUT /owners/{ownerId}'],
    extra: [],
  });
});

test('I3 reports a route the code has and the contract does not — divergence goes both ways', () => {
  // A missing route stalls a later AC; an extra one means the code and the specification have parted.
  const spec = new Set(['GET /owners']);
  const code = new Set(['GET /owners', 'GET /vets']);
  assert.deepEqual(routeDifference(spec, code), { missing: [], extra: ['GET /vets'] });
});

test('I3 is silent when the two sets agree', () => {
  const both = new Set(['GET /owners']);
  assert.deepEqual(routeDifference(both, new Set(both)), { missing: [], extra: [] });
});

// ── I5: no service method that no step calls ─────────────────────────────────────────

const SERVICE_SOURCE = {
  path: 'Services/PetsService.cs',
  text: [
    'public sealed class PetsService',
    '{',
    '    public PetsService(ApiClient client) { _client = client; }',
    '    public Task<ApiResponse<List<Pet>>> GetAll() => _client.Get<List<Pet>>("pets");',
    '    public Task<ApiResponse> Delete(int petId) => _client.Delete("pets/{petId}");',
    '}',
  ].join('\n'),
};

test('I5 does not count a constructor as an unused method', () => {
  // A constructor has no return type, so `public\s+<type>\s+<name>(` cannot match it — the
  // exclusion is structural rather than a name comparison, and this test is what pins that.
  const steps = [{ path: 'StepDefinitions/PetSteps.cs', text: '_pets.GetAll(); _pets.Delete(id);' }];
  assert.deepEqual(unusedServiceMethods([SERVICE_SOURCE], steps), []);
});

test('I5 reports a service method no step definition calls', () => {
  // The route exists, the step does not, and the acceptance criterion that needs it stalls several
  // waves later with the agent looking like the culprit. S5's DoD: "a missing route stalls a later AC".
  const steps = [{ path: 'StepDefinitions/PetSteps.cs', text: '_pets.GetAll();' }];
  const hits = unusedServiceMethods([SERVICE_SOURCE], steps);
  assert.deepEqual(hits.map((h) => h.method), ['Delete']);
  assert.equal(hits[0].path, 'Services/PetsService.cs');
});

test('I5 is green when a method is called from any step file, not only its own', () => {
  const steps = [
    { path: 'StepDefinitions/A.cs', text: '_pets.GetAll();' },
    { path: 'StepDefinitions/B.cs', text: '_pets.Delete(id);' },
  ];
  assert.deepEqual(unusedServiceMethods([SERVICE_SOURCE], steps), []);
});

test('I5 ignores a non-public helper type in the same file - the case that blocked S12', () => {
  /*
   * Measured on the regenerated scaffold. S5 factored the four verbs into an `internal sealed class
   * RouteClient` sitting beside `public sealed class OwnersService` in one file. Its members are
   * `public` inside an `internal` type, so the old rule demanded a step call `.Put(` - which correct
   * work can never contain, because every service names its update method `Update`/`UpdatePet`.
   *
   * The result was a blocked row with all 22 steps written and building, and an agent that correctly
   * refused to call the helper from a step just to satisfy the checker.
   */
  const source = {
    path: 'Services/OwnersService.cs',
    text: [
      'internal sealed class RouteClient',
      '{',
      '    public Task<ApiResponse<T>> Put<T>(string path, object body) => _client.PutAsync<T>(path);',
      '    public Task<ApiResponse<T>> Get<T>(string path) => _client.GetAsync<T>(path);',
      '}',
      '',
      'public sealed class OwnersService',
      '{',
      '    public Task<ApiResponse<Owner>> Update(int id, Owner owner) => _route.Put<Owner>("owners", owner);',
      '}',
    ].join('\n'),
  };
  const steps = [{ path: 'StepDefinitions/OwnerSteps.cs', text: '_owners.Update(id, owner);' }];
  assert.deepEqual(unusedServiceMethods([source], steps), []);
});

test('I5 still reports an unreachable method of the PUBLIC type that follows a helper', () => {
  // The other half, and the one that proves the fix is a narrowing rather than a switch-off: the flag
  // has to come back ON at the next public declaration, or I5 would silently stop checking services
  // in every file that happens to declare a helper first.
  const source = {
    path: 'Services/OwnersService.cs',
    text: [
      'internal sealed class RouteClient',
      '{',
      '    public Task<ApiResponse<T>> Put<T>(string path) => _client.PutAsync<T>(path);',
      '}',
      'public sealed class OwnersService',
      '{',
      '    public Task<ApiResponse<Owner>> Update(int id) => _route.Put<Owner>("owners");',
      '    public Task<ApiResponse> Forgotten(int id) => _route.Delete("owners/{id}");',
      '}',
    ].join('\n'),
  };
  const steps = [{ path: 'StepDefinitions/OwnerSteps.cs', text: '_owners.Update(id);' }];
  assert.deepEqual(unusedServiceMethods([source], steps), [
    { path: 'Services/OwnersService.cs', method: 'Forgotten' },
  ]);
});

test('I5 treats a type with no access modifier as internal, which is what C# does', () => {
  // `class Foo` at namespace scope is internal. Reading it as public would put the helper back in
  // scope through the back door.
  const source = {
    path: 'Services/Helper.cs',
    text: 'sealed class Helper\n{\n    public Task Nobody() => Task.CompletedTask;\n}',
  };
  assert.deepEqual(unusedServiceMethods([source], []), []);
});

// ── I6: no sentence is bound twice under the same keyword ────────────────────────────
//
// There is no count check, and the test below pins that absence rather than leaving it implicit.
// Counting bindings against the §7 route set reported `97 step(s) declared, expected 22` on the
// accepted scaffold — D-13 means 22 *request* steps, the 52 Then bindings are assertion steps, and
// stage 1 adds more of them, so the quantity is neither route-derived nor stable between stages.

test('I6 is green on sentences that differ', () => {
  const sources = [
    { path: 'StepDefinitions/A.cs', text: '[When("an owner is registered")]\n[Then("it is there")]' },
  ];
  assert.deepEqual(stepInventoryProblems(sources), []);
});

test('I6 counts nothing — 97 distinct bindings are not a problem', () => {
  // The accepted scaffold has exactly this many, and a count check made it red. If a future edit
  // reintroduces one, this test is what says no.
  const many = Array.from({ length: 97 }, (_, i) => `[When("step ${i}")]`).join('\n');
  assert.deepEqual(stepInventoryProblems([{ path: 'StepDefinitions/A.cs', text: many }]), []);
});

test('I6 reports two bindings of the same sentence under the same keyword', () => {
  const sources = [
    { path: 'StepDefinitions/A.cs', text: '[When("an owner is registered")]' },
    { path: 'StepDefinitions/B.cs', text: '[When("an owner is registered")]' },
  ];
  const problems = stepInventoryProblems(sources);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /an owner is registered/);
});

test('I6 allows the same sentence as Given and as When', () => {
  // Reqnroll's documented way to make one step serve as a precondition and as an action. The scaffold
  // produces nine such pairs deliberately — measured, and every Given in it re-binds a sentence that
  // is also a When. check-tests.mjs exempts the same shape.
  const sources = [
    { path: 'StepDefinitions/A.cs', text: '[Given("an owner is registered")]\n[When("an owner is registered")]' },
  ];
  assert.deepEqual(stepInventoryProblems(sources), []);
});
