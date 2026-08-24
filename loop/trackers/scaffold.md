# Tracker — stage 0 (scaffold)

> One row per task, 14 tasks in 8 waves. **One wave is one iteration** (design D-07): stage 0's
> gate is an objective file manifest and its tasks are structural, so batching a layer per turn
> carries low semantic risk.
>
> States: `todo` · `review` · `rework` · `blocked` · `done`.
> `done` is written by the **runner** only, on a `PASS` verdict from the judge — never by the agent.
>
> Rows are walked in file order, and order is the only dependency mechanism. Do not reorder.

| ID | Group | Title | Status |
|---|---|---|---|
| S1 | wave-1 | Solution skeleton, csproj, build props, appsettings, reqnroll config | done |
| S2 | wave-2 | Config: typed settings and the loader with an env override | done |
| S3 | wave-2 | Models: Owner, Pet, PetType, Visit | done |
| S4 | wave-3 | HTTP core: RequestSpec, RequestSpecBuilder, ApiResponse, ApiClient | done |
| S5 | wave-4 | Services: all 22 routes of the conventions table | done |
| S6 | wave-5 | UniqueData: letters-only suffix, 10-digit telephone, invariant dates | done |
| S7 | wave-5 | ResourceTracker: drain in the mandatory order, swallow only 404 | done |
| S8 | wave-5 | ReadinessProbe: poll until ready, never restart anything | done |
| S9 | wave-6 | ScenarioState: scenario-scoped state for every request step | done |
| S10 | wave-6 | TestDataProvider and the case POCOs, keyed by the AC tag | done |
| S11 | wave-6 | BDD wiring: hooks, DI registration, non-parallelisable assembly | done |
| S12 | wave-7 | The 22 request steps, grouped by domain | done |
| S13 | wave-8 | Feature file skeletons for F-01, F-02, F-03 | done |
| S14 | wave-8 | The three smoke tests, the wiring canary, and their data files | done |

**Total:** 14 tasks in 8 waves.

---

## Task details

Paths are relative to the repository root. `PROJECT` below is
`framework/src/PetClinic.ApiTests`. The authoritative description of every file's responsibility
is §4 of [the design](../../docs/design/2026-08-05-bdd-api-tests-ralph-loop-design.md).

### S1 — Solution skeleton

**Files:** `framework/ApiTests.sln`, `framework/Directory.Build.props`, `framework/reqnroll.json`,
`PROJECT/PetClinic.ApiTests.csproj`, `PROJECT/appsettings.json`

**DoD:** `dotnet build framework/ApiTests.sln` is green on an otherwise empty project.

`Directory.Build.props` sets `net8.0`, `<Nullable>enable</Nullable>` and
`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`. The csproj references RestSharp, NUnit,
NUnit3TestAdapter, Reqnroll.NUnit, Microsoft.Extensions.Configuration.Json, and FluentAssertions
**pinned to an exact version inside 7.x** using the bracket form `Version="[7.a.b]"` — resolve the
concrete patch from NuGet, do not guess it. A floating `7.*` or any `8.x` fails the gate (D-03).
`appsettings.json` holds `baseUrl`, `timeoutMs`, `readinessPath`, `readinessTimeoutMs`.

### S2 — Config

**Files:** `PROJECT/Config/TestSettings.cs`, `PROJECT/Config/SettingsLoader.cs`

**DoD:** `baseUrl` is read from `appsettings.json` and overridden by the environment variable
`PETCLINIC_BASE_URL` when it is set. No literal `http://localhost:9966` anywhere in C# code.

### S3 — Models

**Files:** `PROJECT/Models/Owner.cs`, `Pet.cs`, `PetType.cs`, `Visit.cs`

**DoD:** the schemas of `docs/specs/petclinic/contracts/openapi.yaml` are represented without loss.
`Owner` carries `pets`, `Pet` carries `ownerId`, `type` and `visits`, `Visit` carries `petId`.
The `Visit` request body must be buildable **without** `id`: submitting `id` gives a `500` (§11).

### S4 — HTTP core

**Files:** `PROJECT/Http/RequestSpec.cs`, `RequestSpecBuilder.cs`, `ApiResponse.cs`, `ApiClient.cs`,
`PROJECT/Tests/Unit/ApiResponseTests.cs`

**DoD:** a smoke call to `GET /pettypes` through `ApiClient` returns 200.
`Tests/Unit/ApiResponseTests.cs` proves by running, not by inspection, that `EnsureStatus` throws with
**both** codes and the response body in the message, and that it is silent on the expected code. Every
one of the twenty scenarios routes its response-code checks through this one method, so a failure that
does not show the body costs its reader a reproduction. Mark the fixture `[Category("Unit")]`: the gate
runs these before the SUT exists, so they must need no HTTP and no Docker.

`RequestSpec` is the reusable request specification: base URL, default `Content-Type` and `Accept`
of `application/json`, timeout. Immutable, with a static `Default(TestSettings)`. `ApiClient` owns
**one** `RestClient` for the whole run and exposes it as `ApiClient.Shared`; no second
`new RestClient` may exist anywhere. `ApiResponse` exposes `StatusCode`, a typed `Body`,
`RawContent`, `Headers` and `EnsureStatus(HttpStatusCode)` which throws with `RawContent` in the
message — that message is what makes a wrong code diagnosable at the request site (rubric 17).

### S5 — Services

**Files:** `PROJECT/Services/OwnersService.cs`, `PetsService.cs`, `VisitsService.cs`,
`PetTypesService.cs`

**DoD:** all 22 routes of §7 of `docs/specs/petclinic/context-and-conventions.md` are present.
Not "almost all" — a missing route stalls a later AC.

The asymmetry matters and is easy to get wrong: a pet is created **only** through
`POST /owners/{ownerId}/pets` and deleted **only** through `DELETE /pets/{petId}`; a pet is updated
by **two** routes (`PUT /pets/{petId}` and `PUT /owners/{ownerId}/pets/{petId}`); a visit is created
by **two** routes (`POST /owners/{ownerId}/pets/{petId}/visits` and `POST /visits`).

### S6 — UniqueData

**Files:** `PROJECT/Support/UniqueData.cs`, `PROJECT/Tests/Unit/UniqueDataTests.cs`

**DoD:** `Tests/Unit/UniqueDataTests.cs` proves, by running: `LastName("Testowner")` appends a
**letters-only** suffix and stays within 30 characters; `LastName` trims an over-long base rather than
overflowing; `Telephone()` returns exactly 10 digits; `PetName` stays within 30 and `PetTypeName`
within 80; **repeated calls do not collide**; and `Date` formats `yyyy-MM-dd` **with
`CultureInfo.CurrentCulture` set to `uk-UA`**, restoring the culture in a `finally`. Mark the fixture
`[Category("Unit")]`.

Why each constraint exists: digits in a last name are rejected with `400` (§10.5); a telephone of
11–20 digits passes schema validation and then fails with `500` on save (§11); on a `uk-UA` machine
a culture-sensitive `ToString()` produces `14.05.2020` and the request is rejected.

**On "repeated calls do not collide", which is the one a plausible design gets wrong.** Measured
against the scaffold this requirement was written for: `Telephone()` returned **11 to 24 duplicates out
of 50 consecutive calls**, and `LastName` 10 to 22. The cause was a token built as
`Interlocked.Increment(ref _counter) ^ DateTime.UtcNow.Ticks` — both operands move in the same low
bits, so the XOR destroys the counter's monotonicity and two calls collide outright (counter 2 with
ticks 4, and counter 3 with ticks 5, both yield 6). Spaced a millisecond apart it produced no
duplicates at all, which is why twenty integration scenarios at HTTP cadence never caught it and a
judge reading the code never saw it.

Do not combine a counter and a clock with XOR. A monotonically increasing token — the counter in the
high bits, or a per-process random base plus the counter — satisfies this in one line.

### S7 — ResourceTracker

**Files:** `PROJECT/Support/ResourceTracker.cs`

**DoD:** `Drain()` deletes in the order **visits → pets → owners → pettypes**, swallows `404`
specifically (not any exception), and a second `Drain()` does not throw.

The order is mandatory, not stylistic: an owner with two pets of the same type cannot be deleted —
the request answers `404` and nothing is removed (§11).

### S8 — ReadinessProbe

**Files:** `PROJECT/Support/ReadinessProbe.cs`

**DoD:** polls `GET /pettypes` until it answers, honours `readinessTimeoutMs`, and fails with a
message that names the URL and the timeout.

It must **never** restart the SUT (D-10). Restarting lives in `scripts/sut.mjs`, so the delivered
framework still runs against a shared environment.

### S9 — ScenarioState

**Files:** `PROJECT/Support/ScenarioState.cs`

**DoD:** holds the response of every one of the 22 request steps, the entities created during the
scenario, and the `ResourceTracker`. Resolved through Reqnroll's DI, one instance per scenario.

In BDD the chain "create an owner → remember `ownerId` → use it in the next step" cannot live in a
local variable, because the steps are different methods. This class is that memory.

**Addressed by key, not by recency — a requirement, not a style preference.** A step stores a value
under a name; any later step reads it by that name, whatever ran in between, until the scenario ends.

The case that decides it, because a plausible design gets this wrong: the arrange block of **all six**
F-03 acceptance criteria is "an owner is registered with a pet", and the chain both F-02 and F-03
state is `GET /pettypes` → `POST /owners` → `POST /owners/{ownerId}/pets`. The pet type is fetched
**first** and used **third**, with the owner registration in between. A holder exposing only "the last
response" plus one fixed slot per entity cannot serve that — measured on a build that shipped exactly
that shape, the pet step threw `InvalidOperationException` in its `Given` form, which is the form all
six F-03 criteria need, and `Support/` is outside the stage-1 fence so no later turn could repair it.

Fixed per-entity properties are fine as a convenience **on top of** the keyed store. They are not a
substitute for it.

### S10 — TestDataProvider

**Files:** `PROJECT/TestData/TestDataProvider.cs`, `PROJECT/TestData/Cases/OwnerCase.cs`,
`PetCase.cs`, `VisitCase.cs`, `PetTypeCase.cs`

**DoD:** `For<T>()` resolves the JSON block using the file named after the feature and the key
taken from the scenario's `@AC-Fxx-yy` tag via `ScenarioContext`. Never a hand-written string key.

Reqnroll's generated test-method names are mangled, which is why the tag — not the method name — is
the stable key (D-15).

The data **file** is resolved by the feature's flow tag, not from a hard-coded map: a feature tagged
`@F01` reads the one file in `Data/` whose name starts with `F01`. Exactly one match is required —
zero and several both throw, naming the tag and the count. A closed map would mean a flow added after
this stage cannot be given data at all, because `TestData/` is outside the stage-1 fence and no
stage-1 turn may edit this class.

### S11 — BDD wiring

**Files:** `PROJECT/Hooks/ScenarioHooks.cs`, `PROJECT/AssemblyInfo.cs`

**DoD:** `[BeforeScenario(Order = 0)]` registers the four services and `ApiClient.Shared` in
`IObjectContainer`; `[AfterScenario]` calls `ResourceTracker.Drain()`; `AssemblyInfo.cs` carries
`[assembly: NonParallelizable]`.

Readiness is awaited in `[BeforeScenario(Order = -1)]`, memoised behind a `Lazy<Task>` — **not** in
`[BeforeTestRun]`. Reqnroll generates an assembly-level `[SetUpFixture]` that runs for any test run in
the assembly, so a `[BeforeTestRun]` probe makes even `dotnet test --filter TestCategory=Unit` wait out
the readiness budget: measured at 96 s and red with the container stopped. A unit test has no scenario,
so a scenario hook never fires for it, while the twenty BDD scenarios still get a ready API. The three
smoke tests keep their own `[OneTimeSetUp]` probe and are unaffected either way.

This is enforced, not merely asked for: I7 in `scripts/invariants.mjs` refuses `[BeforeTestRun]` and a
hand-written `[SetUpFixture]` anywhere in the assembly, and it is in scope for this row's gate. The
manifest's `Lazy<Task>` probe cannot do it — a probe requires a marker, it cannot forbid one, so a file
carrying both would pass every probe on it.

Parallel execution is forbidden (§10.7): the tests share one database and assertions on collection
counts would become non-deterministic.

### S12 — The 22 request steps

**Files:** `PROJECT/StepDefinitions/OwnerSteps.cs` (8 steps), `PetSteps.cs` (4),
`VisitSteps.cs` (6), `PetTypeSteps.cs` (4)

**DoD:** one step per route of §7 — 8 + 4 + 6 + 4 = 22. Each step issues its request, calls
`EnsureStatus` for the expected code, and stores the typed response in `ScenarioState`.

These steps contain **nothing from any AC** — they derive from the contract, which is exactly why
they belong to stage 0 (D-13). Grouping is by domain, not by flow, so reuse across flows is natural.

**The four creation sentences carry `[Given]` as well as `[When]`.** "an owner is registered", "a pet
is added to the owner", "a visit is recorded for the pet" and "a pet type is added to the directory"
are each the action under test for their own AC **and** the precondition of later flows. In the
`Given` role a step may not depend on what ran immediately before it — see S9's DoD.

**A request body carries only the fields §7 lists as REQUEST fields.** Read-only response fields —
`id`, `ownerId` and `visits[]` on a pet — are not sent back on a `PUT`. A model whose collection
property would serialise as `"visits": []` needs the guard that stops it: §11 records a `PUT` carrying
a read-only field as a `500` on save, and `AC-F03-04` and `AC-F02-10` assert on the very history such
a body would erase.
Sentences are in domain language: `the owner details are opened`, not `GET owners by id`.

### S13 — Feature skeletons

**Files:** one feature file per flow, in `PROJECT/Features/`, named after that flow's slug.

**DoD:** the flow list in scripts/flows.mjs decides how many files there are — three today. Each has a
`Feature:` header, its flow tag (`@F01`/`@F02`/`@F03`, one per file) and a short description taken
from that flow's "What the flow verifies" section. **No scenarios yet** — stage 1 appends those, one
per iteration, and creates the file itself if a flow was added after this stage ran.

### S14 — Smoke suite

**Files:** `PROJECT/Tests/Smoke/FrameworkSmokeTests.cs`, `PROJECT/Data/FrameworkSmokeTests.json`,
`PROJECT/Tests/Smoke/F00-framework-wiring.feature`, `PROJECT/Data/F00-framework-wiring.json`

**DoD:** three plain NUnit tests, all green. They are **not** AC tests, carry no AC id and never
appear in the traceability — they prove the three mechanisms all 20 scenarios depend on:

| Test | What it proves |
|---|---|
| `Smoke_full_chain_through_services` | `GET /pettypes` → `POST /owners` → `POST /owners/{id}/pets` → `POST .../visits`, then read every entity back |
| `Smoke_tracker_cleans_up_in_order` | drain order, `404` swallowed, second drain safe |
| `Smoke_data_resolves_by_method_name` | the provider finds its block in `Data/FrameworkSmokeTests.json` |

Plus **the canary**: one Gherkin scenario in `Tests/Smoke/F00-framework-wiring.feature`, tagged `@F00`
on the `Feature:` line and `@AC-F00-01` on the scenario, whose steps are **existing request steps
only** — it adds no step definition, so it cannot collide with a stage-1 sentence or appear in
`loop/STEPS.md`. Its data lives in `Data/F00-framework-wiring.json` under the key `AC-F00-01`; the file
name starts with the flow tag because that is how S10's provider finds it, so no map entry and no C#
change are needed.

Why it exists: the three smoke tests are plain NUnit and reach `TestDataProvider` through an internal
seam, so `ResolveFeatureFile`, `ResolveAcTag`, the `BeforeScenario` registrations, `ScenarioState`, the
22 request steps and the `AfterScenario` drain through the container are otherwise **never executed in
stage 0 at all** — their first run would be inside stage 1's first paid iteration, which is also the
iteration that becomes the exemplar every later one copies.

It must not pass vacuously: disabling the `BeforeScenario` hook in `ScenarioHooks` — or commenting out
all five of its `RegisterInstanceAs` calls — has to turn it red. Removing a *single* registration does
**not**, and that is not a defect in the canary: Reqnroll's BoDi container constructs any concrete type
whose constructor arguments it can already resolve, so each service is simply rebuilt from the still
registered `ApiClient`. Measured on this framework: the four service registrations and the `ApiClient`
one are each individually removable with the canary still green, while the one-line removal of
`[BeforeScenario(Order = 0)]` fails it with `Circular dependency found! System.Uri (resolution path:
OwnerSteps->OwnersService->ApiClient->RestSharp.RestClient->System.Uri)`.

The file lives outside `Features/` deliberately. `scripts/check-tests.mjs` counts the scenarios in that
directory against the tracker's `done` rows, and `Tests/` is outside the stage-1 fence.

---

## Open questions

Rows moved to `blocked` record their question here, with the task id and one sentence. The runner prints
this section when it stops on a blocked row, so a question written anywhere else is a question nobody
sees. Empty means nothing is blocked.

_None._
