// scripts/manifest.scaffold.mjs — the file manifest stage 0 is graded against (design §5.2).
//
// The probes are COARSE on purpose. Their job is to catch a file that exists and is empty, or one
// that lost its whole reason for existing. Judging quality is the judge's job (loop/rubrics/
// scaffold.md); a probe that tried to would fail on every legitimate refactor.
//
// The stage-1 data files (Data/F0*.json) are deliberately absent: stage 1 creates them when it
// writes the first scenario of each flow, so requiring them here would make stage 0 ungateable.

export const PROJECT_DIR = 'framework/src/PetClinic.ApiTests';

const p = (relativePath) => `${PROJECT_DIR}/${relativePath}`;

export const SCAFFOLD_MANIFEST = [
  // ── Solution skeleton (S1) ────────────────────────────────────────────────────
  { path: 'framework/ApiTests.sln', wave: 1, probes: [/PetClinic\.ApiTests/] },
  {
    path: 'framework/Directory.Build.props',
    wave: 1,
    probes: [/net8\.0/, /TreatWarningsAsErrors/, /<Nullable>\s*enable/],
  },
  { path: 'framework/reqnroll.json', wave: 1, probes: [/./s] },
  {
    path: p('PetClinic.ApiTests.csproj'),
    wave: 1,
    probes: [
      /RestSharp/,
      /Reqnroll\.NUnit/,
      /NUnit3TestAdapter/,
      // D-03: the bracketed exact-version form. `Version="7.*"` or `"8.0.0"` must fail here.
      //
      // `[^>]`, not `[\s\S]`, so the match cannot cross out of this element into the next one. With a
      // 120-character any-char window, FluentAssertions pinned "8.0.0" followed by another package
      // pinned "[7.0.0]" put the decoy 93 characters away — inside the window — and the probe accepted
      // a build that would restore the commercially licensed 8.x.
      /FluentAssertions[^>]{0,120}Version\s*=\s*"\[7\./,
      /net8\.0/,
    ],
  },
  {
    path: p('appsettings.json'),
    wave: 1,
    probes: [/baseUrl/, /9966/, /readiness/i],
  },

  // ── Config (S2) ───────────────────────────────────────────────────────────────
  { path: p('Config/TestSettings.cs'), wave: 2, probes: [/class|record/, /BaseUrl/i] },
  { path: p('Config/SettingsLoader.cs'), wave: 2, probes: [/appsettings\.json/, /PETCLINIC_BASE_URL/] },

  // ── Models (S3) ───────────────────────────────────────────────────────────────
  { path: p('Models/Owner.cs'), wave: 2, probes: [/FirstName/, /LastName/, /Telephone/, /Pets/] },
  { path: p('Models/Pet.cs'), wave: 2, probes: [/BirthDate/, /OwnerId/, /Visits/] },
  { path: p('Models/PetType.cs'), wave: 2, probes: [/Name/] },
  { path: p('Models/Visit.cs'), wave: 2, probes: [/Description/, /PetId/] },

  // ── HTTP core (S4) ────────────────────────────────────────────────────────────
  { path: p('Http/RequestSpec.cs'), wave: 3, probes: [/class RequestSpec/, /Default/] },
  { path: p('Http/RequestSpecBuilder.cs'), wave: 3, probes: [/class RequestSpecBuilder/, /WithPath/, /WithBody/] },
  { path: p('Http/ApiClient.cs'), wave: 3, probes: [/class ApiClient/, /RestClient/, /Shared/] },
  { path: p('Http/ApiResponse.cs'), wave: 3, probes: [/StatusCode/, /EnsureStatus/, /RawContent/] },

  // ── Services (S5) — Service Object, all 22 routes of §7 ───────────────────────
  {
    path: p('Services/OwnersService.cs'),
    wave: 4,
    // Both nested pet routes must exist: creating a pet is possible ONLY through the owner.
    probes: [/class OwnersService/, /owners/, /AddPet/, /GetPet/, /UpdatePet/],
  },
  { path: p('Services/PetsService.cs'), wave: 4, probes: [/class PetsService/, /pets/] },
  {
    path: p('Services/VisitsService.cs'),
    wave: 4,
    // Both creation routes: nested under the pet, and the clinic-wide log.
    probes: [/class VisitsService/, /visits/, /petId|PetId/],
  },
  { path: p('Services/PetTypesService.cs'), wave: 4, probes: [/class PetTypesService/, /pettypes/] },

  // ── Support (S6, S7, S8, S9) ──────────────────────────────────────────────────
  {
    path: p('Support/UniqueData.cs'),
    wave: 5,
    // §10.5 letters-only last name suffix, §11 exactly-10-digit telephone, invariant dates.
    probes: [/class UniqueData/, /LastName/, /Telephone/, /InvariantCulture/],
  },
  {
    path: p('Support/ResourceTracker.cs'),
    wave: 5,
    // The mandatory drain order and the 404-only swallow (§10.6, §11).
    probes: [/class ResourceTracker/, /Drain/, /NotFound|404/],
  },
  { path: p('Support/ReadinessProbe.cs'), wave: 5, probes: [/class ReadinessProbe/, /pettypes/] },
  { path: p('Support/ScenarioState.cs'), wave: 6, probes: [/class ScenarioState/, /ResourceTracker/] },

  // ── Test data (S10) ───────────────────────────────────────────────────────────
  {
    path: p('TestData/TestDataProvider.cs'),
    wave: 6,
    // D-15: the key comes from the scenario tag, not from a hand-written string.
    probes: [/class TestDataProvider/, /ScenarioContext|ScenarioInfo/, /AC-/],
  },
  { path: p('TestData/Cases/OwnerCase.cs'), wave: 6, probes: [/OwnerCase/] },
  { path: p('TestData/Cases/PetCase.cs'), wave: 6, probes: [/PetCase/] },
  { path: p('TestData/Cases/VisitCase.cs'), wave: 6, probes: [/VisitCase/] },
  { path: p('TestData/Cases/PetTypeCase.cs'), wave: 6, probes: [/PetTypeCase/] },

  // ── BDD wiring (S11) ──────────────────────────────────────────────────────────
  {
    path: p('Hooks/ScenarioHooks.cs'),
    wave: 6,
    probes: [/BeforeTestRun/, /BeforeScenario/, /AfterScenario/, /Drain/],
  },
  { path: p('AssemblyInfo.cs'), wave: 6, probes: [/NonParallelizable/] },

  // ── 22 request steps (S12) ────────────────────────────────────────────────────
  { path: p('StepDefinitions/OwnerSteps.cs'), wave: 7, probes: [/\[Binding\]/, /class OwnerSteps/] },
  { path: p('StepDefinitions/PetSteps.cs'), wave: 7, probes: [/\[Binding\]/, /class PetSteps/] },
  { path: p('StepDefinitions/VisitSteps.cs'), wave: 7, probes: [/\[Binding\]/, /class VisitSteps/] },
  { path: p('StepDefinitions/PetTypeSteps.cs'), wave: 7, probes: [/\[Binding\]/, /class PetTypeSteps/] },

  // ── Feature skeletons (S13) ───────────────────────────────────────────────────
  { path: p('Features/F01-owner-lifecycle.feature'), wave: 8, probes: [/Feature\s*:/, /@F01/] },
  { path: p('Features/F02-owner-pet-lifecycle.feature'), wave: 8, probes: [/Feature\s*:/, /@F02/] },
  { path: p('Features/F03-pet-visit-flow.feature'), wave: 8, probes: [/Feature\s*:/, /@F03/] },

  // ── Smoke suite (S14) — the acceptance mechanism, design §5.3 ─────────────────
  {
    path: p('Tests/Smoke/FrameworkSmokeTests.cs'),
    wave: 8,
    probes: [
      /Smoke_full_chain_through_services/,
      /Smoke_tracker_cleans_up_in_order/,
      /Smoke_data_resolves_by_method_name/,
    ],
  },
  { path: p('Data/FrameworkSmokeTests.json'), wave: 8, probes: [/./s] },
];
