// tests/ralph.test.mjs — the runner itself, executed.
//
// The mutation review found `loop/ralph.mjs` (779 lines) is reached by NO test: syntax-destroying its
// first line left the suite green. Everything downstream of a green gate — the left-behind probe, the
// committed-work probe, the failure branch, the judge call, the verdict write — had only ever been
// exercised by hand. These tests drive the real script.
//
// SAFETY. `runAgent` and `runJudge` switch to stdin on `bin === 'claude'`, which is a PATH lookup, and
// the real binary IS on PATH on a developer machine — one accidental invocation costs money. So every
// run goes through `runRalph`, which hands the child a PATH containing ONLY the clone's stub
// directory, git's directory and System32, and PROVES by device+inode that `claude` on that PATH is
// the stub and is not any binary the ambient PATH resolves. A failed proof fails the test without
// spawning anything.
//
// The clone is a throwaway git repository under the system temp directory: `framework/` does not exist
// in this repository and must never be created in it. `dotnet` and `docker` cannot be shadowed on
// PATH — measured, `run()`'s first, shell-less spawn resolves the real binaries past a `_bin/*.cmd`
// that `where` lists first — so `scripts/sut.mjs` is replaced outright and the clone's `gates.mjs` has
// its two `dotnet` steps rewritten to a stub. `check:tests` and `steps:inventory`, the steps under
// test, are untouched, and so is the step ORDER.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { repoRoot } from '../scripts/lib.mjs';
import { parseRows, setStatus } from '../loop/tracker.mjs';

const ROOT = repoRoot(import.meta.url);
const WIN = process.platform === 'win32';

const PROJECT = 'framework/src/PetClinic.ApiTests';
const F01_TITLE =
  'a registered owner is visible with the submitted values both in the owner details and in ' +
  'the owners list, and the list has no duplicate';

/** git inside the clone. Throws on failure — a broken fixture must not read as a passing test. */
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stdout}${r.stderr}`);
  return r.stdout;
}

/**
 * A throwaway clone of the harness that `ralph.mjs` can actually run in.
 *
 * Only what the runner reads is copied: `loop/`, `scripts/`, the flow documents, `package.json` and
 * `.gitignore`. `openapi.yaml` is deliberately left out — 53 KB the runner never opens.
 */
function buildClone(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  for (const rel of ['loop', 'scripts']) cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
  mkdirSync(join(dir, 'docs/specs/petclinic/flows'), { recursive: true });
  cpSync(join(ROOT, 'docs/specs/petclinic/flows'), join(dir, 'docs/specs/petclinic/flows'), {
    recursive: true,
  });
  cpSync(
    join(ROOT, 'docs/specs/petclinic/context-and-conventions.md'),
    join(dir, 'docs/specs/petclinic/context-and-conventions.md')
  );
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));

  // Runtime state the clone must not inherit — including the trackers.
  //
  // `loop/` is copied from a repository that may be MID-RUN. Measured: with five `done` rows in
  // `loop/trackers/scaffold.md`, `pickTarget` in the clone returned S6 rather than S1, so a fixture
  // that seeds wave 1 was gated against wave 4 and the stage-0 test below asserted a status on a row
  // the runner never targeted. A harness test must measure the runner, not how far the real run has
  // got, so every row starts where a fresh run starts. Through `setStatus`, not a regex over the file:
  // the details sections and the Open questions section below the table hold status-shaped prose.
  for (const relative of ['loop/trackers/scaffold.md', 'loop/trackers/tests.md']) {
    const path = join(dir, relative);
    let markdown = readFileSync(path, 'utf8');
    for (const row of parseRows(markdown)) markdown = setStatus(markdown, row.id, 'todo');
    writeFileSync(path, markdown);
  }

  rmSync(join(dir, 'loop/JOURNAL.md'), { force: true });
  rmSync(join(dir, 'loop/STEPS.md'), { force: true });
  rmSync(join(dir, 'loop/verdicts'), { recursive: true, force: true });
  mkdirSync(join(dir, 'loop/verdicts'), { recursive: true });
  writeFileSync(join(dir, 'loop/verdicts/.gitkeep'), '');

  // The framework tree the gate reads.
  for (const sub of ['Features', 'StepDefinitions', 'Data', 'Support']) {
    mkdirSync(join(dir, PROJECT, sub), { recursive: true });
  }
  writeFileSync(join(dir, 'framework/ApiTests.sln'), '# stub solution for PetClinic.ApiTests\n');
  writeFileSync(join(dir, PROJECT, 'StepDefinitions/OwnerSteps.cs'), '[Binding]\nclass OwnerSteps { }\n');
  writeFileSync(join(dir, PROJECT, 'Support/ResourceTracker.cs'), '// stage-0 property, outside the fence\n');
  writeFileSync(join(dir, PROJECT, 'Features/F01-owner-lifecycle.feature'), 'Feature: F-01 owner lifecycle\n');

  // Neither `sut` nor `dotnet` may run for real.
  writeFileSync(join(dir, 'scripts/sut.mjs'), "console.log('sut-stub ok');\nprocess.exit(0);\n");
  writeFileSync(join(dir, 'scripts/dotnet-stub.mjs'), "console.log('dotnet-stub ok');\nprocess.exit(0);\n");
  const gates = readFileSync(join(dir, 'loop/gates.mjs'), 'utf8');
  const patched = gates
    .split("cmd: 'dotnet', args: ['")
    .join("cmd: process.execPath, args: ['scripts/dotnet-stub.mjs', '");
  assert.notEqual(patched, gates, 'the fixture must be able to replace the dotnet gate steps');
  writeFileSync(join(dir, 'loop/gates.mjs'), patched);

  // The stub `claude`, and the control directory the test drives it from.
  const bin = join(dir, '_bin');
  const control = join(dir, '_control');
  mkdirSync(bin, { recursive: true });
  mkdirSync(control, { recursive: true });
  writeFileSync(join(bin, 'stub.mjs'), STUB_SOURCE);
  writeFileSync(join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0stub.mjs" %*\r\n`);

  writeFileSync(
    join(dir, '.gitignore'),
    `${readFileSync(join(ROOT, '.gitignore'), 'utf8')}\n_bin/\n_control/\n`
  );

  git(dir, 'init', '-b', 'feat/harness');
  git(dir, 'config', 'user.email', 'harness@example.invalid');
  git(dir, 'config', 'user.name', 'Harness');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'clone: initial state');

  return { dir, control };
}

/**
 * The stub `claude`: it records what it was given and dispatches on `RALPH_JUDGE`, which is the only
 * thing distinguishing an agent turn from a judge call. A `<role>.<n>.mjs` in the control directory
 * runs instead of the default; without one the judge answers `VERDICT: PASS` and the agent does
 * nothing.
 */
const STUB_SOURCE = `
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTROL = join(process.env.STUB_ROOT, '_control');
mkdirSync(CONTROL, { recursive: true });

let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; }

const role = process.env.RALPH_JUDGE === '1' ? 'judge' : 'agent';
const counter = join(CONTROL, role + '.count');
const nth = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
writeFileSync(counter, String(nth));

writeFileSync(join(CONTROL, role + '.' + nth + '.prompt.txt'), stdin);
appendFileSync(join(CONTROL, 'calls.jsonl'), JSON.stringify({
  role, nth,
  stage: process.env.RALPH_STAGE ?? null,
  target: process.env.RALPH_TARGET ?? null,
  judge: process.env.RALPH_JUDGE ?? null,
}) + '\\n');

const script = join(CONTROL, role + '.' + nth + '.mjs');
const fallback = join(CONTROL, role + '.mjs');
const chosen = existsSync(script) ? script : existsSync(fallback) ? fallback : null;
if (chosen) await import('file:///' + chosen.split('\\\\').join('/'));
else if (role === 'judge') process.stdout.write('VERDICT: PASS\\n');
process.exit(0);
`;

/** A stub agent that writes a legal stage-1 turn for AC-F01-01 and commits it. */
const AGENT_GOOD = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const P = '${PROJECT}';
const AC = process.env.RALPH_TARGET;
const git = (...a) => spawnSync('git', a, { encoding: 'utf8' });

if (process.env.STUB_TWO_COMMITS === '1') {
  writeFileSync(P + '/Support/ResourceTracker.cs', '// quietly reworked by the turn\\n');
  git('add', '-A');
  git('commit', '-m', 'refactor: tidy the resource tracker');
}

appendFileSync(P + '/Features/F01-owner-lifecycle.feature',
  '\\n  @' + AC + ' @US-01\\n  Scenario: ' + AC + ' ${F01_TITLE}\\n' +
  '    Given an owner is registered\\n    Then the owner details show the submitted values\\n');
writeFileSync(P + '/Data/F01-owner-lifecycle.json',
  JSON.stringify({ [AC]: { owner: { firstName: 'Anna', lastName: 'Petliura' } } }, null, 2) + '\\n');
appendFileSync(P + '/StepDefinitions/OwnerSteps.cs',
  '\\n[Then("the owner details show the submitted values")]\\nvoid Then1() { }\\n');
git('add', '-A');
git('commit', '-m', 'test(F-01): ' + AC + '\\n\\nAC: ' + AC);

const t = 'loop/trackers/tests.md';
writeFileSync(t, readFileSync(t, 'utf8')
  .replace(new RegExp('(\\\\| ' + AC + ' \\\\|[^\\\\n]*\\\\| )todo( \\\\|)'), '$1review$2'));
`;

/**
 * AGENT_GOOD, plus one line: a row this turn was never given, flipped to the one word both prompts
 * forbid. Everything else about the turn is legal, so the gate is green and the work is committed —
 * this is the turn that used to be ACCEPTED, and `a one-commit turn inside the fence still passes`
 * above is the control that proves the difference is the tracker line and nothing else.
 *
 * Written and not committed, exactly as an honest turn leaves the tracker: committing it would trip
 * the stage-1 diff fence instead, and then the test would be measuring the fence.
 */
const AGENT_TAMPERS = `${AGENT_GOOD}
writeFileSync(t, readFileSync(t, 'utf8')
  .replace(/(\\| AC-F01-03 \\|[^\\n]*\\| )todo( \\|)/, '$1done$2'));
`;

/** `replace`, where a pattern that fails to match is a broken fixture rather than a silent no-op. */
const mustReplace = (text, from, to) => {
  assert.ok(text.includes(from), `the fixture expected to find ${JSON.stringify(from)} in the stub agent`);
  return text.split(from).join(to);
};

/**
 * AGENT_GOOD finishing a row that is in `rework` rather than `todo` — the second attempt, which is
 * the normal shape of every turn after a refusal. `PROMPT.tests.md` still ends it at `review`.
 *
 * `git add framework`, not `git add -A`, and that is a measured difference rather than tidiness. By
 * the time a rework turn runs, the RUNNER has written `rework` into `loop/trackers/tests.md` and never
 * committed it — `ralph.mjs` contains no `git commit`. An `add -A` sweeps that into the turn's commit,
 * and `check-tests.mjs`'s diff half is repo-wide, so the gate then fails with "a stage-1 turn must not
 * touch loop/trackers/tests.md" — a file no agent touched. Measured here before this line existed.
 */
const AGENT_GOOD_FROM_REWORK = mustReplace(
  mustReplace(AGENT_GOOD, "git('add', '-A');", "git('add', 'framework');"),
  ')todo( ',
  ')rework( '
);

/** A stub agent that commits nothing but its own tracker row. */
const agentTrackerOnly = (tracker) => `
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const AC = process.env.RALPH_TARGET;
const t = '${tracker}';
writeFileSync(t, readFileSync(t, 'utf8')
  .replace(new RegExp('(\\\\| ' + AC + ' \\\\|[^\\\\n]*\\\\| )todo( \\\\|)'), '$1review$2'));
spawnSync('git', ['add', '-A'], { encoding: 'utf8' });
spawnSync('git', ['commit', '-m', 'chore: mark ' + AC + ' reviewed'], { encoding: 'utf8' });
`;

/**
 * Runs `loop/ralph.mjs` inside the clone with a PATH that resolves `claude` to the clone's stub and
 * to nothing else — proven by device+inode, and proven not to be any binary the ambient PATH finds,
 * before a single process is spawned.
 */
function runRalph(clone, { env = {}, args = [] } = {}) {
  const stubDir = join(clone, '_bin');
  const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const gitExe = (spawnSync('where', ['git'], { encoding: 'utf8' }).stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().endsWith('git.exe'));
  assert.ok(gitExe, 'the fixture needs git.exe on PATH');

  const value = [stubDir, dirname(gitExe), system32].join(';');
  const childEnv = { ...process.env, ...env, STUB_ROOT: clone };
  for (const key of Object.keys(childEnv)) if (/^path$/i.test(key)) childEnv[key] = value;
  childEnv.PATH = value;

  const stub = statSync(join(stubDir, 'claude.cmd'));
  const hits = (spawnSync('where', ['claude'], { encoding: 'utf8', env: childEnv }).stdout ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  assert.equal(hits.length, 1, `claude must resolve to exactly one file, got:\n${hits.join('\n')}`);
  const resolved = statSync(hits[0]);
  assert.equal(resolved.dev, stub.dev, 'resolved claude is on a different device than the stub');
  assert.equal(resolved.ino, stub.ino, `resolved claude is not the stub — it is ${hits[0]}`);
  for (const line of (spawnSync('where', ['claude'], { encoding: 'utf8' }).stdout ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())) {
    const other = statSync(line);
    assert.ok(
      other.dev !== stub.dev || other.ino !== stub.ino,
      `the stub is the real claude at ${line} — refusing to spawn`
    );
  }

  const result = spawnSync(process.execPath, [join(clone, 'loop', 'ralph.mjs'), ...args], {
    cwd: clone,
    env: { AGENT_CMD: 'claude -p', JUDGE_CMD: 'claude -p', ...childEnv },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const readIf = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

// ── The gate is fenced against the commit the turn started from ──────────────────────

test('the runner fences the gate against the turn\'s own base, so a two-commit turn cannot hide a framework rewrite', { skip: !WIN }, () => {
  // B1/B3. `gateSteps` grew a `base` and the runner did not pass it, so `check-tests.mjs` fenced
  // `HEAD~1..HEAD` — the last commit only. Measured before the wiring: commit 1 rewriting
  // `Support/ResourceTracker.cs` and commit 2 adding the feature file passed the fence GREEN, the
  // judge was called, and the row went `done` with the framework edit invisible.
  const { dir, control } = buildClone('ralph-base-');
  writeFileSync(join(control, 'agent.mjs'), AGENT_GOOD);

  const run = runRalph(dir, { env: { MAX_ITER: '1', STUB_TWO_COMMITS: '1' }, args: ['--stage', 'tests', '--flow', 'F-01'] });

  assert.match(run.out, /gate red at "check:tests"/, run.out.slice(-2000));
  assert.match(run.out, /must not touch framework\/src\/PetClinic\.ApiTests\/Support\/ResourceTracker\.cs/);
  assert.doesNotMatch(run.out, /calling the judge/, 'a red gate must not reach the judge');
  assert.match(readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8'), /\| AC-F01-01 \|.*\| rework \|/);
  rmSync(dir, { recursive: true, force: true });
});

test('a one-commit turn inside the fence still passes, so the base is not simply rejecting everything', { skip: !WIN }, () => {
  const { dir, control } = buildClone('ralph-green-');
  writeFileSync(join(control, 'agent.mjs'), AGENT_GOOD);

  const run = runRalph(dir, { env: { MAX_ITER: '1' }, args: ['--stage', 'tests', '--flow', 'F-01'] });

  assert.match(run.out, /verdict PASS for AC-F01-01/, run.out.slice(-2000));
  assert.match(readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8'), /\| AC-F01-01 \|.*\| done \|/);
  rmSync(dir, { recursive: true, force: true });
});

// ── The judge is shown the step inventory as it was BEFORE the turn ──────────────────

test('the judge is given the step inventory as it stood before the turn, not after it', { skip: !WIN }, () => {
  // B5. The gate regenerates `loop/STEPS.md` as its LAST step, and the runner then fed that file to
  // the judge — so the turn's own new step appeared as pre-existing with a use count of 1. Rubric
  // item 23 asks the judge to check that inventory for a reworded duplicate of the step under review;
  // against an inventory that already contains it the check can never fire.
  const { dir, control } = buildClone('ralph-steps-');
  writeFileSync(join(control, 'agent.mjs'), AGENT_GOOD);

  runRalph(dir, { env: { MAX_ITER: '1' }, args: ['--stage', 'tests', '--flow', 'F-01'] });

  const judgePrompt = readIf(join(control, 'judge.1.prompt.txt'));
  assert.ok(judgePrompt.length > 0, 'the judge must have been called');
  const inventory = judgePrompt.slice(
    judgePrompt.indexOf('# EXISTING STEP INVENTORY'),
    judgePrompt.indexOf('# EXEMPLAR')
  );
  assert.doesNotMatch(
    inventory,
    /the owner details show the submitted values/,
    'the inventory handed to the judge must not contain the step this very turn added'
  );
  // And the live file DOES contain it, so the assertion above is about the snapshot and not about a
  // step inventory that failed to run at all.
  assert.match(readFileSync(join(dir, 'loop/STEPS.md'), 'utf8'), /the owner details show the submitted values/);
  rmSync(dir, { recursive: true, force: true });
});

// ── A refused turn leaves a note, attributed to the runner ───────────────────────────

test('a turn the runner refuses leaves a note the next prompt carries, and it is not attributed to the judge', { skip: !WIN }, () => {
  // B4. The failure text went to `console.error` and nowhere else, and `previousFindings` reads
  // `loop/verdicts/<id>.md` for any `rework` row — so a turn refused by the runner was handed the
  // LAST judge call's findings under "These are the problems an independent judge found. Fix all of
  // them", with no mention of the real reason. Measured across three iterations.
  const { dir, control } = buildClone('ralph-note-');
  writeFileSync(join(control, 'agent.1.mjs'), AGENT_GOOD);
  writeFileSync(join(control, 'agent.2.mjs'), "process.stdout.write('turn 2 did nothing\\n');\n");
  writeFileSync(join(control, 'agent.3.mjs'), "process.stdout.write('turn 3 did nothing\\n');\n");
  writeFileSync(
    join(control, 'judge.1.mjs'),
    "process.stdout.write('VERDICT: REJECT\\n\\n- [item 6] OwnerSteps.cs:12 SENTINEL-JUDGE-FINDING\\n');\n"
  );

  runRalph(dir, {
    env: { MAX_ITER: '3', K_FAILURES: '9' },
    args: ['--stage', 'tests', '--flow', 'F-01'],
  });

  // Turn 2 follows a judge REJECT: it must carry the judge's words under the judge's heading.
  const second = readIf(join(control, 'agent.2.prompt.txt'));
  assert.match(second, /### Judge findings from the previous round/);
  assert.match(second, /SENTINEL-JUDGE-FINDING/);

  // Turn 3 follows a turn the RUNNER refused: it must carry the runner's reason, under a heading
  // that says the judge was not involved, and must not still be showing the judge's old findings.
  const third = readIf(join(control, 'agent.3.prompt.txt'));
  assert.match(third, /### Why the previous turn was refused/);
  assert.match(third, /judge was \*\*not\*\* called/);
  assert.doesNotMatch(third, /SENTINEL-JUDGE-FINDING/, 'stale judge findings must not survive a runner refusal');
  assert.doesNotMatch(third, /problems an independent judge found/);
  rmSync(dir, { recursive: true, force: true });
});

// ── A commit that is not work ────────────────────────────────────────────────────────

test('a turn whose only commit is its own tracker row is refused before the judge is paid for', { skip: !WIN }, () => {
  // C4. `headUnmoved` measures HEAD movement, not work. Measured on stage 0, whose gate has no diff
  // fence at all: a turn that did nothing but flip its own row to `review` and commit THAT moved
  // HEAD, passed every check, was judged, and went `done`.
  const { dir, control } = buildClone('ralph-nowork-');
  seedScaffoldWave1(dir);
  writeFileSync(join(control, 'agent.mjs'), agentTrackerOnly('loop/trackers/scaffold.md'));

  const run = runRalph(dir, { env: { MAX_ITER: '1' }, args: ['--stage', 'scaffold'] });

  assert.match(run.out, /nothing under framework in/, run.out.slice(-2000));
  assert.doesNotMatch(run.out, /calling the judge/, 'a turn with no work must not be judged');
  assert.match(readFileSync(join(dir, 'loop/trackers/scaffold.md'), 'utf8'), /\| S1 \|.*\| rework \|/);
  rmSync(dir, { recursive: true, force: true });
});

/** The wave-1 and wave-2 files `check-scaffold.mjs`'s manifest asks for, so a stage-0 gate is green. */
const SCAFFOLD_WAVE_1 = {
  'framework/ApiTests.sln':
    'Microsoft Visual Studio Solution File, Format Version 12.00\nProject "PetClinic.ApiTests"\n',
  'framework/Directory.Build.props':
    '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework>\n' +
    '<TreatWarningsAsErrors>true</TreatWarningsAsErrors><Nullable>enable</Nullable>\n' +
    '</PropertyGroup></Project>\n',
  'framework/reqnroll.json':
    '{ "language": { "feature": "en" }, "bindingCulture": { "name": "en-US" } }\n',
  [`${PROJECT}/PetClinic.ApiTests.csproj`]:
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n' +
    '<ItemGroup><PackageReference Include="RestSharp" Version="112.0.0" />\n' +
    '<PackageReference Include="Reqnroll.NUnit" Version="2.0.0" />\n' +
    '<PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />\n' +
    '<PackageReference Include="FluentAssertions" Version="[7.0.0]" /></ItemGroup></Project>\n',
  [`${PROJECT}/appsettings.json`]:
    '{ "baseUrl": "http://localhost:9966/petclinic/api", "readiness": { "timeoutMs": 90000 } }\n',
};

const SCAFFOLD_WAVE_2 = {
  [`${PROJECT}/Config/TestSettings.cs`]:
    'namespace PetClinic.ApiTests.Config;\n\npublic sealed class TestSettings\n{\n' +
    '    public string BaseUrl { get; init; } = string.Empty;\n}\n',
  [`${PROJECT}/Config/SettingsLoader.cs`]:
    'namespace PetClinic.ApiTests.Config;\n\npublic static class SettingsLoader\n{\n' +
    '    // reads appsettings.json, then the PETCLINIC_BASE_URL override\n}\n',
  [`${PROJECT}/Models/Owner.cs`]:
    'namespace PetClinic.ApiTests.Models;\n\npublic sealed class Owner\n{\n' +
    '    public string? FirstName { get; set; }\n    public string? LastName { get; set; }\n' +
    '    public string? Telephone { get; set; }\n    public List<Pet> Pets { get; set; } = new();\n}\n',
  [`${PROJECT}/Models/Pet.cs`]:
    'namespace PetClinic.ApiTests.Models;\n\npublic sealed class Pet\n{\n' +
    '    public string? BirthDate { get; set; }\n    public int OwnerId { get; set; }\n' +
    '    public List<Visit> Visits { get; set; } = new();\n}\n',
  [`${PROJECT}/Models/PetType.cs`]:
    'namespace PetClinic.ApiTests.Models;\n\npublic sealed class PetType\n{\n' +
    '    public string? Name { get; set; }\n}\n',
  [`${PROJECT}/Models/Visit.cs`]:
    'namespace PetClinic.ApiTests.Models;\n\npublic sealed class Visit\n{\n' +
    '    public string? Description { get; set; }\n    public int PetId { get; set; }\n}\n',
};

/** Wave 1 already built and committed, for a test whose subject is a LATER turn. */
function seedScaffoldWave1(dir) {
  for (const [relative, text] of Object.entries(SCAFFOLD_WAVE_1)) {
    mkdirSync(dirname(join(dir, relative)), { recursive: true });
    writeFileSync(join(dir, relative), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'scaffold: wave 1');
}

// ── The tracker is the agent's to write, but only its own row and only in one direction ──
//
// The agent writes its own row and the RUNNER writes `done` on a judge PASS. Nothing deterministic
// looked at the rest of the file: `check-scaffold.mjs` grades a file manifest and has no tracker check
// at all, the left-behind probe watches only `framework/`, and `validateTable` checks the table's STRUCTURE
// rather than the TRUTH of its statuses. A turn that flipped an unrelated row to `done` therefore
// passed every gate, and `pickTarget` skips a `done` row — the stage reports complete with a task
// never built. Design §6: a wrong rejection costs one iteration, a wrong acceptance ships a lie.

test('a turn that flips a row it was never given to `done` is refused, named, and put back', { skip: !WIN }, () => {
  const { dir, control } = buildClone('ralph-tamper-');
  writeFileSync(join(control, 'agent.mjs'), AGENT_TAMPERS);

  const run = runRalph(dir, { env: { MAX_ITER: '1' }, args: ['--stage', 'tests', '--flow', 'F-01'] });

  // Green gate, work committed, nothing left behind — the turn is refused for the tracker line alone.
  assert.doesNotMatch(run.out, /gate red/, run.out.slice(-3000));
  assert.match(run.out, /rewrote tracker rows an agent may not write/, run.out.slice(-3000));
  assert.match(run.out, /AC-F01-03: `todo` -> `done`/, 'the row AND the transition must be named');
  assert.doesNotMatch(run.out, /calling the judge/, 'a turn that rewrote the tracker must not be judged');

  const tracker = readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8');
  assert.match(tracker, /\| AC-F01-03 \|.*\| todo \|/, 'the forged row must be put back, or the loop still skips it');
  assert.match(tracker, /\| AC-F01-01 \|.*\| rework \|/, 'the target row goes to rework, as after any refusal');

  // `previousFindings` reads this file for any `rework` row, so it is what the next prompt carries.
  const note = readIf(join(dir, 'loop/verdicts/AC-F01-01.md'));
  assert.match(note, /AC-F01-03/, 'the next turn must be told which row to leave alone');
  assert.match(note, /may not write/);
  rmSync(dir, { recursive: true, force: true });
});

test('a turn that finishes a `rework` row at `review` is accepted, not read as rewriting a judged row', { skip: !WIN }, () => {
  // The correction to "a judged row is history". A `rework` row is exactly the row the agent is sent
  // BACK into — pickTarget returns it with phase `agent` and the prompt ends that turn at `review`.
  // A rule that forbade every write to a `rework` row would refuse the second attempt at every row,
  // and three refusals trip K_FAILURES: the loop could not rework anything at all.
  const { dir, control } = buildClone('ralph-rework-');
  writeFileSync(join(control, 'agent.1.mjs'), "process.stdout.write('turn 1 did nothing\\n');\n");
  writeFileSync(join(control, 'agent.2.mjs'), AGENT_GOOD_FROM_REWORK);

  const run = runRalph(dir, { env: { MAX_ITER: '2' }, args: ['--stage', 'tests', '--flow', 'F-01'] });

  // Turn 2 really did start from `rework` — otherwise this test would pass while exercising nothing.
  assert.match(readIf(join(control, 'agent.2.prompt.txt')), /\*\*Status:\*\* `rework`/, 'turn 2 must be a rework turn');
  assert.doesNotMatch(run.out, /rewrote tracker rows/, 'rework -> review is the prompt\'s own contract');
  assert.match(run.out, /verdict PASS for AC-F01-01/, run.out.slice(-3000));
  assert.match(readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8'), /\| AC-F01-01 \|.*\| done \|/);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A stub stage-0 agent: writes the files it is given, sets EVERY row of its wave to `review` — which
 * is what `PROMPT.scaffold.md` step 4 asks for — and commits the whole tree with `git add -A`.
 *
 * The `git add -A` is the point of the fixture, not a shortcut. The runner writes `done` into the
 * tracker at the end of an iteration and never commits it (`ralph.mjs` contains no `git commit`), so
 * the next turn finds that word already in the file and sweeps it into its own commit. Measured in the
 * real run: the wave-4 turn did exactly this with the runner's `done` for S4.
 */
const scaffoldAgent = (files, ids) => `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [path, text] of Object.entries(${JSON.stringify(files)})) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const t = 'loop/trackers/scaffold.md';
let md = readFileSync(t, 'utf8');
for (const id of ${JSON.stringify(ids)}) {
  md = md.replace(new RegExp('(\\\\| ' + id + ' \\\\|[^\\\\n]*\\\\| )todo( \\\\|)'), '$1review$2');
}
writeFileSync(t, md);

spawnSync('git', ['add', '-A'], { encoding: 'utf8' });
spawnSync('git', ['commit', '-m', 'feat(framework): ${ids.join(', ')}'], { encoding: 'utf8' });
`;

test('a turn that advances a row other than its target is refused, and the passenger is put back', { skip: !WIN }, () => {
  // This test asserted the opposite until a real run deadlocked on it.
  //
  // A turn delivered S6, S7 and S8 in one commit and set all three to `review`. The judge was asked
  // about S6, saw a diff spanning all three files, and reported real defects in S7's and S8's. The
  // agent's rework then touched only those files — so the next diff contained no `UniqueData.cs` at
  // all, and the judge said: "there is nothing in this diff by which S6 can be judged, and a row moved
  // to review by a commit that does not touch its files is not reviewable." Every further rework moved
  // the diff further from the target's work. S6 could never be judged again.
  //
  // The judge grades a DIFF, and a diff spanning several rows cannot be attributed to one of them.
  // One row per turn is what design §6.2 always said.
  const { dir, control } = buildClone('ralph-batch-');
  writeFileSync(join(control, 'agent.1.mjs'), scaffoldAgent(SCAFFOLD_WAVE_1, ['S1']));
  writeFileSync(join(control, 'agent.2.mjs'), scaffoldAgent(SCAFFOLD_WAVE_2, ['S2', 'S3']));

  const run = runRalph(dir, { env: { MAX_ITER: '2' }, args: ['--stage', 'scaffold'] });

  assert.match(run.out, /rewrote tracker rows/, run.out.slice(-4000));
  assert.match(run.out, /S3/, 'the refusal must name the passenger');

  const tracker = readFileSync(join(dir, 'loop/trackers/scaffold.md'), 'utf8');
  assert.match(tracker, /\| S1 \|.*\| done \|/, 'the first turn was legitimate and stands');
  assert.match(tracker, /\| S2 \|.*\| rework \|/, 'the target of the refused turn goes to rework');
  assert.match(tracker, /\| S3 \|.*\| todo \|/, 'the passenger must be put back, not left in review');

  // The judge is not paid for a turn the runner has already refused.
  assert.equal(readIf(join(control, 'judge.count')).trim(), '1');
  rmSync(dir, { recursive: true, force: true });
});

test("sweeping the runner's own `done` into a turn's commit is still not tampering", { skip: !WIN }, () => {
  // The other half, and the one that must not break. The runner writes `done` at the end of an
  // iteration and never commits it, so the next turn finds that word already in the file and
  // `git add -A` folds it in. Measured in the real run: commit 9b56ba5 carries `S4 todo -> done`,
  // written by the runner after a judge PASS, beside the agent's own `S5 todo -> review`.
  const { dir, control } = buildClone('ralph-sweep-');
  writeFileSync(join(control, 'agent.1.mjs'), scaffoldAgent(SCAFFOLD_WAVE_1, ['S1']));
  writeFileSync(join(control, 'agent.2.mjs'), scaffoldAgent(SCAFFOLD_WAVE_2, ['S2']));

  const run = runRalph(dir, { env: { MAX_ITER: '2' }, args: ['--stage', 'scaffold'] });

  assert.doesNotMatch(run.out, /rewrote tracker rows/, run.out.slice(-4000));
  assert.doesNotMatch(run.out, /gate red/, run.out.slice(-4000));

  const committed = git(dir, 'show', 'HEAD:loop/trackers/scaffold.md');
  assert.match(committed, /\| S1 \|.*\| done \|/, "the turn must have committed the runner's own done");
  assert.match(committed, /\| S2 \|.*\| review \|/);
  rmSync(dir, { recursive: true, force: true });
});

// ── SPEC_UNCLEAR reaches the human ───────────────────────────────────────────────────

test('a SPEC_UNCLEAR verdict writes the question into the tracker and names the file holding it', { skip: !WIN }, () => {
  // C3. The verdict set the row to `blocked` and recorded the question nowhere, so the run ended by
  // telling a human to answer a question above a section still reading `_None._` — and never named
  // `loop/verdicts/<id>.md`, where the text actually was. Both trackers had claimed since they were
  // written that the runner populates that section.
  const { dir, control } = buildClone('ralph-unclear-');
  writeFileSync(join(control, 'agent.1.mjs'), AGENT_GOOD);
  writeFileSync(
    join(control, 'judge.1.mjs'),
    "process.stdout.write('VERDICT: SPEC_UNCLEAR\\n\\nSENTINEL-QUESTION: is the owners list paginated?\\nA second line.\\n');\n"
  );

  const run = runRalph(dir, { env: { MAX_ITER: '1' }, args: ['--stage', 'tests', '--flow', 'F-01'] });

  const tracker = readFileSync(join(dir, 'loop/trackers/tests.md'), 'utf8');
  const questions = tracker.slice(tracker.indexOf('## Open questions'));
  assert.match(questions, /SENTINEL-QUESTION/, 'the question must reach the tracker');
  assert.match(questions, /AC-F01-01/);
  assert.doesNotMatch(questions, /_None\._/, 'the empty marker must not sit above a real question');

  // A second run must still be able to read the file it just wrote.
  const reread = runRalph(dir, { env: { MAX_ITER: '1' }, args: ['--stage', 'tests', '--flow', 'F-01', '--allow-dirty'] });
  assert.equal(reread.status, 4, reread.out.slice(-1500));
  assert.match(reread.out, /is blocked/);
  assert.match(reread.out, /loop[\\/]verdicts[\\/]AC-F01-01\.md/, 'the stop must name where the full text is');
  assert.match(run.out, /verdict SPEC_UNCLEAR/);
  rmSync(dir, { recursive: true, force: true });
});

// ── HEAD refusals ────────────────────────────────────────────────────────────────────

test('the runner refuses a detached HEAD, which used to read as ready', { skip: !WIN }, () => {
  // C6. `branch()` returns git's literal answer `HEAD` on a detached HEAD, and nothing tested it —
  // measured, the dry run printed `branch: HEAD` and `start: ready`, and a real run went ahead.
  const { dir } = buildClone('ralph-detached-');
  git(dir, 'checkout', '--detach', 'HEAD');

  const run = runRalph(dir, { env: { MAX_ITER: '0' }, args: ['--stage', 'tests', '--flow', 'F-01'] });
  assert.equal(run.status, 2, run.out);
  assert.match(run.out, /detached/i);

  const dry = runRalph(dir, { env: { MAX_ITER: '0' }, args: ['--stage', 'tests', '--flow', 'F-01', '--dry-run'] });
  assert.doesNotMatch(dry.out, /start:\s+ready/, 'a detached HEAD must never report ready');
  rmSync(dir, { recursive: true, force: true });
});

test('the runner refuses an unborn HEAD instead of reading it as an unnamed branch', { skip: !WIN }, () => {
  // C6, the other half. `rev-parse --git-dir` exits 0 on an unborn HEAD while `--abbrev-ref HEAD`
  // exits 128, and the fail-open `git()` turned that into `''` — the one value that satisfies the
  // `main`/`master` refusal.
  const { dir } = buildClone('ralph-unborn-');
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'harness@example.invalid');
  git(dir, 'config', 'user.name', 'Harness');

  const run = runRalph(dir, { env: { MAX_ITER: '0' }, args: ['--stage', 'tests', '--flow', 'F-01', '--dry-run'] });
  assert.equal(run.status, 2, run.out);
  assert.match(run.out, /cannot read the current branch/);
  assert.match(run.out, /fatal:/, 'the git reason must survive, not the word HEAD git prints to stdout');
  assert.match(run.out, /no commits yet/);
  rmSync(dir, { recursive: true, force: true });
});
