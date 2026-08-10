// scripts/manifest.scaffold.mjs — the file manifest stage 0 is graded against (design §5.2).
//
// The probes are COARSE on purpose. Their job is to catch a file that exists and is empty, or one
// that lost its whole reason for existing. Judging quality is the judge's job (loop/rubrics/
// scaffold.md); a probe that tried to would fail on every legitimate refactor.
//
// The stage-1 data files (Data/F0*.json) are deliberately absent: stage 1 creates them when it
// writes the first scenario of each flow, so requiring them here would make stage 0 ungateable.
//
// Every entry carries BOTH the tracker row that builds it and that row's wave, because the gate is
// asked two different questions and they are not the same question:
//
//   --through-row S6    what must exist once THIS TURN is finished. A turn builds one row (design
//                       §6.2 — the judge grades a diff, and a diff spanning several rows cannot be
//                       attributed to one of them), so the post-turn gate must demand exactly the
//                       rows up to and including the target.
//   --through-wave 4    what must already exist BEFORE the turn starts. Whole waves are the only
//                       thing complete at that moment, which is why loop/gates.mjs's pre-turn gate
//                       asks through `wave - 1`.
//
// The row tag is not a second opinion: `loop/trackers/scaffold.md` names each row's files in its
// details section, and that file is the authority. tests/manifest.test.mjs re-derives the mapping
// from it and fails on any disagreement — an untagged entry, a row owning nothing, or a path the two
// files attribute differently. A wrong tag makes the gate demand a file from a turn nobody has been
// asked to take, which is precisely the defect the row scope exists to remove.

export const PROJECT_DIR = 'framework/src/PetClinic.ApiTests';

const p = (relativePath) => `${PROJECT_DIR}/${relativePath}`;

export const SCAFFOLD_MANIFEST = [
  // ── Solution skeleton (S1) ────────────────────────────────────────────────────
  { path: 'framework/ApiTests.sln', row: 'S1', wave: 1, probes: [/PetClinic\.ApiTests/] },
  {
    path: 'framework/Directory.Build.props',
    row: 'S1',
    wave: 1,
    probes: [/net8\.0/, /TreatWarningsAsErrors/, /<Nullable>\s*enable/],
  },
  { path: 'framework/reqnroll.json', row: 'S1', wave: 1, probes: [/./s] },
  {
    path: p('PetClinic.ApiTests.csproj'),
    row: 'S1',
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
    row: 'S1',
    wave: 1,
    probes: [/baseUrl/, /9966/, /readiness/i],
  },

  // ── Config (S2) ───────────────────────────────────────────────────────────────
  { path: p('Config/TestSettings.cs'), row: 'S2', wave: 2, probes: [/class|record/, /BaseUrl/i] },
  {
    path: p('Config/SettingsLoader.cs'),
    row: 'S2',
    wave: 2,
    probes: [/appsettings\.json/, /PETCLINIC_BASE_URL/],
  },

  // ── Models (S3) ───────────────────────────────────────────────────────────────
  { path: p('Models/Owner.cs'), row: 'S3', wave: 2, probes: [/FirstName/, /LastName/, /Telephone/, /Pets/] },
  { path: p('Models/Pet.cs'), row: 'S3', wave: 2, probes: [/BirthDate/, /OwnerId/, /Visits/] },
  { path: p('Models/PetType.cs'), row: 'S3', wave: 2, probes: [/Name/] },
  { path: p('Models/Visit.cs'), row: 'S3', wave: 2, probes: [/Description/, /PetId/] },

  // ── HTTP core (S4) ────────────────────────────────────────────────────────────
  { path: p('Http/RequestSpec.cs'), row: 'S4', wave: 3, probes: [/class RequestSpec/, /Default/] },
  {
    path: p('Http/RequestSpecBuilder.cs'),
    row: 'S4',
    wave: 3,
    probes: [/class RequestSpecBuilder/, /WithPath/, /WithBody/],
  },
  { path: p('Http/ApiClient.cs'), row: 'S4', wave: 3, probes: [/class ApiClient/, /RestClient/, /Shared/] },
  { path: p('Http/ApiResponse.cs'), row: 'S4', wave: 3, probes: [/StatusCode/, /EnsureStatus/, /RawContent/] },

  // ── Services (S5) — Service Object, all 22 routes of §7 ───────────────────────
  {
    path: p('Services/OwnersService.cs'),
    row: 'S5',
    wave: 4,
    // Both nested pet routes must exist: creating a pet is possible ONLY through the owner.
    probes: [/class OwnersService/, /owners/, /AddPet/, /GetPet/, /UpdatePet/],
  },
  { path: p('Services/PetsService.cs'), row: 'S5', wave: 4, probes: [/class PetsService/, /pets/] },
  {
    path: p('Services/VisitsService.cs'),
    row: 'S5',
    wave: 4,
    // Both creation routes: nested under the pet, and the clinic-wide log.
    probes: [/class VisitsService/, /visits/, /petId|PetId/],
  },
  { path: p('Services/PetTypesService.cs'), row: 'S5', wave: 4, probes: [/class PetTypesService/, /pettypes/] },

  // ── Support (S6, S7, S8, S9) ──────────────────────────────────────────────────
  //
  // The wave whose shape made the row tag necessary: three rows, three turns, one wave. Scoped by
  // wave, S6's own gate demanded S7's and S8's files — measured on the live run, `--through-wave 5`
  // red with exactly those two missing while `UniqueData.cs` passed all four of its probes.
  {
    path: p('Support/UniqueData.cs'),
    row: 'S6',
    wave: 5,
    // §10.5 letters-only last name suffix, §11 exactly-10-digit telephone, invariant dates.
    probes: [/class UniqueData/, /LastName/, /Telephone/, /InvariantCulture/],
  },
  {
    path: p('Support/ResourceTracker.cs'),
    row: 'S7',
    wave: 5,
    // The mandatory drain order and the 404-only swallow (§10.6, §11).
    probes: [/class ResourceTracker/, /Drain/, /NotFound|404/],
  },
  { path: p('Support/ReadinessProbe.cs'), row: 'S8', wave: 5, probes: [/class ReadinessProbe/, /pettypes/] },
  { path: p('Support/ScenarioState.cs'), row: 'S9', wave: 6, probes: [/class ScenarioState/, /ResourceTracker/] },

  // ── Test data (S10) ───────────────────────────────────────────────────────────
  {
    path: p('TestData/TestDataProvider.cs'),
    row: 'S10',
    wave: 6,
    // D-15: the key comes from the scenario tag, not from a hand-written string.
    probes: [/class TestDataProvider/, /ScenarioContext|ScenarioInfo/, /AC-/],
  },
  { path: p('TestData/Cases/OwnerCase.cs'), row: 'S10', wave: 6, probes: [/OwnerCase/] },
  { path: p('TestData/Cases/PetCase.cs'), row: 'S10', wave: 6, probes: [/PetCase/] },
  { path: p('TestData/Cases/VisitCase.cs'), row: 'S10', wave: 6, probes: [/VisitCase/] },
  { path: p('TestData/Cases/PetTypeCase.cs'), row: 'S10', wave: 6, probes: [/PetTypeCase/] },

  // ── BDD wiring (S11) ──────────────────────────────────────────────────────────
  {
    path: p('Hooks/ScenarioHooks.cs'),
    row: 'S11',
    wave: 6,
    probes: [/BeforeTestRun/, /BeforeScenario/, /AfterScenario/, /Drain/],
  },
  { path: p('AssemblyInfo.cs'), row: 'S11', wave: 6, probes: [/NonParallelizable/] },

  // ── 22 request steps (S12) ────────────────────────────────────────────────────
  { path: p('StepDefinitions/OwnerSteps.cs'), row: 'S12', wave: 7, probes: [/\[Binding\]/, /class OwnerSteps/] },
  { path: p('StepDefinitions/PetSteps.cs'), row: 'S12', wave: 7, probes: [/\[Binding\]/, /class PetSteps/] },
  { path: p('StepDefinitions/VisitSteps.cs'), row: 'S12', wave: 7, probes: [/\[Binding\]/, /class VisitSteps/] },
  {
    path: p('StepDefinitions/PetTypeSteps.cs'),
    row: 'S12',
    wave: 7,
    probes: [/\[Binding\]/, /class PetTypeSteps/],
  },

  // ── Feature skeletons (S13) ───────────────────────────────────────────────────
  { path: p('Features/F01-owner-lifecycle.feature'), row: 'S13', wave: 8, probes: [/Feature\s*:/, /@F01/] },
  { path: p('Features/F02-owner-pet-lifecycle.feature'), row: 'S13', wave: 8, probes: [/Feature\s*:/, /@F02/] },
  { path: p('Features/F03-pet-visit-flow.feature'), row: 'S13', wave: 8, probes: [/Feature\s*:/, /@F03/] },

  // ── Smoke suite (S14) — the acceptance mechanism, design §5.3 ─────────────────
  {
    path: p('Tests/Smoke/FrameworkSmokeTests.cs'),
    row: 'S14',
    wave: 8,
    probes: [
      /Smoke_full_chain_through_services/,
      /Smoke_tracker_cleans_up_in_order/,
      /Smoke_data_resolves_by_method_name/,
    ],
  },
  { path: p('Data/FrameworkSmokeTests.json'), row: 'S14', wave: 8, probes: [/./s] },
];

/**
 * The tracker rows the manifest knows, in the order the loop walks them.
 *
 * DERIVED from the entries above rather than declared beside them: a second list would be a second
 * thing to keep in step, and `--through-row` scopes by a row's POSITION here, so a list that had
 * drifted would silently move the scope boundary.
 *
 * The order is the manifest's own first-appearance order, and tests/manifest.test.mjs pins it to the
 * tracker table's order. Position inside the manifest is otherwise free — the scope follows the tag,
 * not the line number.
 */
export const SCAFFOLD_ROWS = Object.freeze([...new Set(SCAFFOLD_MANIFEST.map((entry) => entry.row))]);

/**
 * Every entry that must be present once `rowId` is finished — that row and every row before it.
 *
 * Returns `null` for a row the manifest does not know, so the caller can say so in its own words
 * rather than reporting an empty manifest as a green gate.
 */
export function entriesThroughRow(rowId) {
  const ordinal = SCAFFOLD_ROWS.indexOf(rowId);
  if (ordinal === -1) return null;
  return SCAFFOLD_MANIFEST.filter((entry) => SCAFFOLD_ROWS.indexOf(entry.row) <= ordinal);
}
