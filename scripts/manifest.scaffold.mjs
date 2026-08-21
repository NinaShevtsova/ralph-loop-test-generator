// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The packing list for the test framework: every file the first stage must produce, which
// step creates it, and a rough test of "is this file actually finished".
//
// The inspector next door grades against this list. The checks here are deliberately
// shallow — they catch a file that is missing, empty, or has lost its whole reason for
// existing, and nothing more. A check that tried to judge code quality would go red on
// every honest rewrite, and judging quality is the AI grader's job.
// ══════════════════════════════════════════════════════════════════════════════════════

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

import { FLOW_GROUPS } from './flows.mjs';

export const PROJECT_DIR = 'framework/src/PetClinic.ApiTests';

const p = (relativePath) => `${PROJECT_DIR}/${relativePath}`;

/**
 * One feature-skeleton entry per flow.
 *
 * Derived rather than written out, so that adding a flow is one line in `scripts/flows.mjs`: the
 * skeleton becomes a stage-0 requirement on its own, and a from-scratch rebuild produces it. Written
 * out, a fourth flow would have no skeleton until somebody remembered a list in this file — and the
 * omission would not surface here. It would surface as a REJECTED STAGE-1 TURN, because
 * `scripts/check-tests.mjs` fails when the feature file of the flow under test is absent, and the
 * message it prints blames stage 0.
 *
 * Exported, and takes its flow map as an argument, because that is the only way the property can be
 * tested: three flows and three skeletons agree whether or not the list is derived, so the test has to
 * be able to ask for a fourth.
 *
 * The probe carries the flow's own tag — `F-01` -> `@F01`, the spelling a feature header uses — so one
 * flow's skeleton cannot be satisfied by another flow's file. `\b` after it keeps `@F01` from matching
 * inside a longer tag.
 */
export function featureSkeletonEntries(flowGroups) {
  return Object.entries(flowGroups).map(([group, slug]) => ({
    path: p(`Features/${slug}.feature`),
    row: 'S13',
    wave: 8,
    probes: [/Feature\s*:/, new RegExp(`@${group.replace('-', '')}\\b`)],
  }));
}

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
  // The unit test for the file above. S4's DoD makes EnsureStatus's message load-bearing -- every one
  // of the twenty scenarios routes its status checks through it -- and until this entry existed that
  // property was checked by a judge reading code rather than by anything running.
  {
    path: p('Tests/Unit/ApiResponseTests.cs'),
    row: 'S4',
    wave: 3,
    probes: [/EnsureStatus/, /RawContent/, /Category\("Unit"\)/],
  },

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
  // S6's DoD says in as many words that "unit checks prove" these constraints. They did not exist.
  {
    path: p('Tests/Unit/UniqueDataTests.cs'),
    row: 'S6',
    wave: 5,
    probes: [/Telephone/, /LastName/, /InvariantCulture|uk-UA/, /Category\("Unit"\)/],
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
    //
    // `EnumerateFiles` is the requirement's fingerprint: the data file is FOUND, not looked up in a
    // list. A closed map would satisfy every other probe here while making a fourth flow impossible
    // for stage 1 to add, because TestData/ sits outside the stage-1 fence.
    probes: [/class TestDataProvider/, /ScenarioContext|ScenarioInfo/, /AC-/, /EnumerateFiles|GetFiles/],
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
    // `BeforeScenario` for readiness, and NOT `BeforeTestRun`: the second makes every `dotnet test`
    // in this assembly wait for the SUT, filter or no filter — measured at 96 s and red with the
    // container stopped.
    //
    // THE PROHIBITION IS NOT ENFORCEABLE HERE, and saying so is the point of this comment. A probe is
    // a required marker: `check-scaffold.mjs` asks whether each one is PRESENT and has no way to
    // express a forbidden one. So a file carrying both a `Lazy<Task>` and a `[BeforeTestRun]` passes
    // every probe below while reintroducing the regression in full. `Lazy<Task>` here is evidence of
    // the right shape, not a guarantee against the wrong one.
    //
    // I7 in scripts/invariants.mjs is the half that refuses it, scoped to this same row.
    probes: [/BeforeScenario/, /RegisterInstanceAs/, /Drain/, /Lazy<Task>/],
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
  //
  // One per flow, DERIVED from the flow list — see `featureSkeletonEntries` below for why.
  ...featureSkeletonEntries(FLOW_GROUPS),

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
  // The canary. S14 owns "the acceptance mechanism", and this is its Reqnroll half: the smoke tests
  // are plain NUnit and prove the services, while this one scenario is the only thing in stage 0 that
  // executes the hooks, the container, ScenarioState, the tag-to-data lookup and the request steps.
  //
  // Outside Features/ on purpose -- check-tests.mjs counts scenarios only there, and Tests/ is outside
  // the stage-1 fence, so a stage-1 turn can neither disturb the count nor edit the file. The data
  // file's name starts with the flow tag because that is how the provider finds it (S10's DoD).
  {
    path: p('Tests/Smoke/F00-framework-wiring.feature'),
    row: 'S14',
    wave: 8,
    probes: [/@F00\b/, /@AC-F00-01\b/, /Scenario\s*:/],
  },
  {
    path: p('Data/F00-framework-wiring.json'),
    row: 'S14',
    wave: 8,
    probes: [/AC-F00-01/, /owner/, /pet/],
  },
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

/**
 * The manifest path that first brings EXECUTABLE tests into the suite, and the one that first brings
 * unit tests. Named here rather than in `loop/gates.mjs` because the manifest is what knows which row
 * builds them, and a second copy of the path is a second thing to keep in step.
 */
export const SMOKE_SUITE_ENTRY = p('Tests/Smoke/FrameworkSmokeTests.cs');
export const UNIT_TEST_ENTRY = p('Tests/Unit/ApiResponseTests.cs');

/**
 * The tracker row that builds `path`, or `null` when the manifest does not know the path.
 *
 * `null` rather than a throw, and never a guess: the caller is composing a gate, and it must be able
 * to say "the manifest does not know this file" in its own words instead of receiving a stack trace
 * or, worse, a boolean that reads as "no row needs this step".
 */
export function rowOwning(path) {
  return SCAFFOLD_MANIFEST.find((entry) => entry.path === path)?.row ?? null;
}

/**
 * Whether `rowId` comes at or after the row that builds `entryPath` — i.e. whether that file exists
 * once this row's turn is finished.
 *
 * This is how the stage-0 gate decides which steps to run: `dotnet test` is pointless while the suite
 * holds no tests, and the stage-0 prompt says so itself ("reporting zero tests is a pass"). Measured
 * before this existed: ~25 of ~27 gate runs restarted Docker and ran a suite of zero tests.
 *
 * `null` when either side is unknown, for the reason `rowOwning` returns null: a gate step must never
 * go missing because a lookup quietly answered "no".
 */
export function rowNeeds(rowId, entryPath) {
  const owner = rowOwning(entryPath);
  if (owner === null) return null;

  const target = SCAFFOLD_ROWS.indexOf(rowId);
  const boundary = SCAFFOLD_ROWS.indexOf(owner);
  if (target === -1 || boundary === -1) return null;

  return target >= boundary;
}
