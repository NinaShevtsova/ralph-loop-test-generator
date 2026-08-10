// tests/check-scaffold.test.mjs — the stage-0 gate CLI, executed.
//
// What these pin is the SCOPE: which manifest entries the gate demands for a given turn. Everything
// else about the check — the probes, the size floor, the case-sensitive path resolution — is what it
// always was and is exercised only incidentally here.
//
// The scope needed a test because it was wrong in a way no unit test could see. A turn builds one
// tracker row (design §6.2: the judge grades a diff, and a diff spanning several rows cannot be
// attributed to one of them), while the gate demanded a whole WAVE. Four of the eight waves hold
// more than one row, so on the first row of each the gate asked for files from turns nobody had been
// asked to take. Measured on the live run, targeting S6:
//
//   check:scaffold: 22 entries from waves 1..5
//     FAIL …/Support/ResourceTracker.cs: missing      <- S7's file
//     FAIL …/Support/ReadinessProbe.cs: missing       <- S8's file
//
// Running the CLI rather than importing it is not a stylistic choice: the file is a script that
// reads `process.argv`, walks a real tree and ends in `process.exit`. Its refusals are exit codes,
// and an exit code is not observable from an import.
//
// The fixture contents below are the CHEAPEST text that satisfies each entry's probes — deliberately
// so, because what is under test is which files are asked for, not what is in them. They are not
// examples of the framework this loop builds; nothing here should be copied into `framework/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SCAFFOLD_MANIFEST, entriesThroughRow } from '../scripts/manifest.scaffold.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'framework/src/PetClinic.ApiTests';

/** Every file of rows S1..S6 — waves 1-4 whole, plus the one file of wave 5 that S6 owns. */
const FILES = {
  'framework/ApiTests.sln': `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F}") = "PetClinic.ApiTests", "src\\PetClinic.ApiTests\\PetClinic.ApiTests.csproj"
`,
  'framework/Directory.Build.props': `<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
`,
  'framework/reqnroll.json': `{ "bindingCulture": { "name": "en-US" }, "trace": { "minimalStepDefinitions": true } }
`,
  [`${PROJECT}/PetClinic.ApiTests.csproj`]: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="RestSharp" Version="112.1.0" />
    <PackageReference Include="Reqnroll.NUnit" Version="2.1.0" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />
    <PackageReference Include="FluentAssertions" Version="[7.0.0]" />
  </ItemGroup>
</Project>
`,
  [`${PROJECT}/appsettings.json`]: `{
  "baseUrl": "http://localhost:9966/petclinic/api",
  "timeoutMs": 30000,
  "readinessPath": "/pettypes",
  "readinessTimeoutMs": 120000
}
`,
  [`${PROJECT}/Config/TestSettings.cs`]:
    'public sealed record TestSettings(string BaseUrl, int TimeoutMs, string ReadinessPath);\n',
  [`${PROJECT}/Config/SettingsLoader.cs`]: `public static class SettingsLoader
{
    // appsettings.json first, then the PETCLINIC_BASE_URL override.
    public static TestSettings Load() => throw new NotImplementedException();
}
`,
  [`${PROJECT}/Models/Owner.cs`]: `public sealed class Owner
{
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Telephone { get; set; }
    public List<Pet>? Pets { get; set; }
}
`,
  [`${PROJECT}/Models/Pet.cs`]: `public sealed class Pet
{
    public string? BirthDate { get; set; }
    public int OwnerId { get; set; }
    public List<Visit>? Visits { get; set; }
}
`,
  [`${PROJECT}/Models/PetType.cs`]:
    'public sealed class PetType\n{\n    public int Id { get; set; }\n    public string? Name { get; set; }\n}\n',
  [`${PROJECT}/Models/Visit.cs`]: `public sealed class Visit
{
    public string? Description { get; set; }
    public int PetId { get; set; }
}
`,
  [`${PROJECT}/Http/RequestSpec.cs`]: `public sealed class RequestSpec
{
    public static RequestSpec Default(TestSettings settings) => new();
}
`,
  [`${PROJECT}/Http/RequestSpecBuilder.cs`]: `public sealed class RequestSpecBuilder
{
    public RequestSpecBuilder WithPath(string path) => this;
    public RequestSpecBuilder WithBody(object body) => this;
}
`,
  [`${PROJECT}/Http/ApiClient.cs`]: `public static class ApiClient
{
    public static readonly RestClient Shared = new();
}
`,
  [`${PROJECT}/Http/ApiResponse.cs`]: `public sealed class ApiResponse
{
    public HttpStatusCode StatusCode { get; init; }
    public string RawContent { get; init; } = "";
    public void EnsureStatus(HttpStatusCode expected) { }
}
`,
  [`${PROJECT}/Services/OwnersService.cs`]: `public sealed class OwnersService
{
    private const string Route = "owners";
    public void AddPet() { }
    public void GetPet() { }
    public void UpdatePet() { }
}
`,
  [`${PROJECT}/Services/PetsService.cs`]:
    'public sealed class PetsService\n{\n    private const string Route = "pets";\n}\n',
  [`${PROJECT}/Services/VisitsService.cs`]: `public sealed class VisitsService
{
    private const string Route = "visits";
    public void Add(int petId) { }
}
`,
  [`${PROJECT}/Services/PetTypesService.cs`]:
    'public sealed class PetTypesService\n{\n    private const string Route = "pettypes";\n}\n',
  [`${PROJECT}/Support/UniqueData.cs`]: `public static class UniqueData
{
    public static string LastName(string seed) => seed;
    public static string Telephone() => "0123456789";
    public static string Date(DateTime on) => on.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
`,
};

/**
 * A tree holding every file of S1..S6 and nothing else, minus whatever `omit` names.
 *
 * `scripts/` is copied in so `repoRoot()` derives the fixture from the script's own location — no
 * environment variable is involved, and the CLI under test is the current source rather than a copy
 * that can go stale.
 */
function tree(t, { omit = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-scaffold-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  cpSync(join(ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });

  for (const [path, content] of Object.entries(FILES)) {
    if (omit.includes(path)) continue;
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  return root;
}

function check(root, ...args) {
  // CLAUDE_PROJECT_DIR is removed rather than trusted: `repoRoot` honours it when it points at any
  // tree holding scripts/lib.mjs, and this machine's copy points at the REAL repository — which
  // would silently make every one of these tests grade the live framework instead of the fixture.
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;

  const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-scaffold.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('the fixture holds exactly the manifest entries of rows S1..S6', () => {
  // Pins the fixture to the manifest rather than to a hand-counted list. A renamed or added entry in
  // that range must break HERE, with the path in the message, instead of surfacing as an unexplained
  // red gate in the cases below.
  assert.deepEqual(
    Object.keys(FILES).sort(),
    entriesThroughRow('S6')
      .map((entry) => entry.path)
      .sort()
  );
});

// ── The measured case, both directions ────────────────────────────────────────────────

test('--through-row S6 is green on waves 1-4 plus S6 own file', (t) => {
  const result = check(tree(t), '--through-row', 'S6');
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /20 entries from rows S1\.\.S6/);
});

test('--through-wave 5 on that same tree is red, and names the two files of later turns', (t) => {
  // The defect, preserved. The wave flag is unchanged and still means waves — this is what the
  // post-turn gate used to ask, and why it could not be answered by an S6 turn.
  const result = check(tree(t), '--through-wave', '5');
  assert.equal(result.status, 1);
  assert.match(result.out, /22 entries from waves 1\.\.5/);
  assert.match(result.out, /Support\/ResourceTracker\.cs: missing/);
  assert.match(result.out, /Support\/ReadinessProbe\.cs: missing/);
});

test('--through-row S6 still fails when a file of an EARLIER row is missing', (t) => {
  // The other direction, and the one that matters most: narrowing the scope must not have made the
  // gate incapable of failing. S3's model is inside S6's scope and its absence is fatal.
  const root = tree(t, { omit: [`${PROJECT}/Models/Owner.cs`] });
  const result = check(root, '--through-row', 'S6');
  assert.equal(result.status, 1);
  assert.match(result.out, /Models\/Owner\.cs: missing/);
  assert.match(result.out, /1 problem\(s\)/);
});

test('--through-row S7 asks for exactly one more file than S6', (t) => {
  const result = check(tree(t), '--through-row', 'S7');
  assert.equal(result.status, 1);
  assert.match(result.out, /21 entries from rows S1\.\.S7/);
  assert.match(result.out, /Support\/ResourceTracker\.cs: missing/);
  assert.match(result.out, /1 problem\(s\)/);
  assert.ok(!/ReadinessProbe/.test(result.out), "S8's file is outside S7's scope and must not be demanded");
});

test('--through-row S3 stops at S3 — a later row present on disk is not checked', (t) => {
  const result = check(tree(t), '--through-row', 'S3');
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /11 entries from rows S1\.\.S3/);
});

// ── The wave scope, which the pre-turn gate still uses ─────────────────────────────────

test('--through-wave 4 is green on the same tree — the question the PRE-turn gate asks', (t) => {
  const result = check(tree(t), '--through-wave', '4');
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /19 entries from waves 1\.\.4/);
});

test('no scope at all still means the finished framework, all 39 entries', (t) => {
  const result = check(tree(t));
  assert.equal(result.status, 1, 'a half-built tree cannot pass the final-state check');
  assert.match(result.out, /all 39 manifest entries/);
});

// ── Refusals: exit 2, distinct from a red gate ────────────────────────────────────────
//
// 2 rather than 1 throughout. A red gate is a verdict on the turn; these are the caller holding the
// gate wrong, and the runner must not be able to report one as the other.

test('an unknown row is refused, and the refusal names the rows that exist', (t) => {
  const result = check(tree(t), '--through-row', 'S99');
  assert.equal(result.status, 2);
  assert.match(result.out, /no such row/);
  assert.match(result.out, /S1, S2, .*S14/);
  assert.ok(!/check\(s\)/.test(result.out), 'nothing may be checked under a scope that was refused');
});

test('--through-row with no value is refused, not silently read as the whole manifest', (t) => {
  // The dangerous fallback: an unscoped run is the FINAL-state check, red until stage 0 is finished,
  // and the runner would report that as a verdict on the turn.
  const result = check(tree(t), '--through-row');
  assert.equal(result.status, 2);
  assert.match(result.out, /no such row/);
});

test('a lower-case row id is refused rather than guessed at', (t) => {
  assert.equal(check(tree(t), '--through-row', 's6').status, 2);
});

test('the two scopes together are refused — they answer different questions', (t) => {
  const result = check(tree(t), '--through-row', 'S6', '--through-wave', '5');
  assert.equal(result.status, 2);
  assert.match(result.out, /two different scopes/);
});

test('--through-wave still refuses a value that is not a positive integer', (t) => {
  const root = tree(t);
  for (const wave of ['0', '-1', '2.5', 'five']) {
    assert.equal(check(root, '--through-wave', wave).status, 2, `wave ${wave} must be refused`);
  }
});

test('--quiet suppresses the ok lines but never the failures', (t) => {
  const quiet = check(tree(t), '--through-row', 'S7', '--quiet');
  assert.equal(quiet.status, 1);
  assert.ok(!/ {2}ok {2}/.test(quiet.out), '--quiet must not print the passing lines');
  assert.match(quiet.out, /Support\/ResourceTracker\.cs: missing/);
});

test('the last row scopes to the whole manifest — every entry is reachable', () => {
  // A guard against a tag naming a row that sorts after the tracker's last: such an entry would be
  // demanded by no `--through-row` scope at all and would surface only in the unscoped final check.
  assert.equal(entriesThroughRow(SCAFFOLD_MANIFEST.at(-1).row).length, SCAFFOLD_MANIFEST.length);
});
