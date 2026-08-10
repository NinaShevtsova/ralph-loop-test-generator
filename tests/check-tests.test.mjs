// tests/check-tests.test.mjs — the stage-1 gate CLI, executed.
//
// The mutation review found `scripts/check-tests.mjs` (353 lines) executed by NO test at all:
// syntax-destroying its first line left the suite green, so every mutation of it was vacuously a
// survivor. These tests run the real CLI inside a throwaway repository shaped like this one.
//
// Running the CLI rather than importing it is not a stylistic choice. The file is a script, not a
// module — it reads `process.argv`, calls `git` against a real working tree and ends in
// `process.exit`. Its three most load-bearing behaviours (the diff fence, the fail-closed git reads,
// the judge report) exist ONLY as interactions with git, and a unit test with a stubbed git would
// pin the stub instead of the fence. The cost is one process and one temp repo per test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'framework/src/PetClinic.ApiTests';

const FEATURE = `Feature: Owner lifecycle

  @AC-F01-01
  Scenario: AC-F01-01 a new owner is registered and can be read back
    Given an owner is registered
    Then the owner details are returned
`;

const STEPS = `using Reqnroll;

[Binding]
public sealed class OwnerSteps
{
    [Given("an owner is registered")]
    public void GivenAnOwnerIsRegistered() { }

    [Then("the owner details are returned")]
    public void ThenTheOwnerDetailsAreReturned() { }
}
`;

const DATA = '{ "AC-F01-01": { "firstName": "Ada", "lastName": "Lovelace" } }';

const FLOW_DOC = `# F-01 owner lifecycle

| AC | Test |
|---|---|
| AC-F01-01 | \`AC-F01-01: a new owner is registered and can be read back\` |
`;

const TRACKER = `# Tests tracker

| id | group | wave | title | status |
|---|---|---|---|---|
| AC-F01-01 | F-01 | 1 | a new owner is registered and can be read back | pending |
`;

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trimEnd();
}

function write(root, relPath, text) {
  const absolute = join(root, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
  return absolute;
}

const commitAll = (root, message) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
};

/**
 * A throwaway repository shaped like this one, with the turn's output either committed or left in
 * the working tree.
 *
 * Three properties are load-bearing and each was arrived at by a measurement that came out wrong
 * without it:
 *
 *   - an EMPTY root commit under the skeleton, so `HEAD~1` resolves in every fixture. Without it the
 *     old fixed base failed with "unknown revision" and every case measured that artefact instead of
 *     the defect under test.
 *   - stage 0's three files committed in the SKELETON, which is what stage 1 always starts from.
 *     With the whole of `framework/` untracked, `--untracked-files=normal` collapses it to the single
 *     entry `framework/` and the fence reports that instead of the file the test is about.
 *   - `scripts/` copied in, so `repoRoot()` derives the fixture from the script's own location and no
 *     environment variable is involved. It also means these tests exercise the CURRENT sources.
 */
function makeRepo({ commitTurn = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-tests-'));

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'gate@example.test');
  git(root, 'config', 'user.name', 'gate');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'root');

  cpSync(join(ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'loop', 'tracker.mjs'), write(root, 'loop/tracker.mjs', ''));
  write(root, '.gitignore', 'loop/verdicts/\n');
  write(root, 'docs/specs/petclinic/flows/F-01-owner-lifecycle.md', FLOW_DOC);
  write(root, 'loop/trackers/tests.md', TRACKER);
  write(root, `${PROJECT}/Features/F01-owner-lifecycle.feature`, 'Feature: Owner lifecycle\n');
  write(root, `${PROJECT}/StepDefinitions/OwnerSteps.cs`, '[Binding]\npublic sealed class OwnerSteps { }\n');
  write(root, `${PROJECT}/Data/F01-owner-lifecycle.json`, '{}');
  commitAll(root, 'skeleton');

  write(root, `${PROJECT}/Features/F01-owner-lifecycle.feature`, FEATURE);
  write(root, `${PROJECT}/StepDefinitions/OwnerSteps.cs`, STEPS);
  write(root, `${PROJECT}/Data/F01-owner-lifecycle.json`, DATA);
  if (commitTurn) commitAll(root, 'the turn');

  return root;
}

function runCheck(root, ...args) {
  // CLAUDE_PROJECT_DIR is removed rather than trusted: `repoRoot` honours it when it points at any
  // tree holding scripts/lib.mjs, and this machine's copy points at the REAL repository — which would
  // silently make every one of these tests check the wrong working tree while looking healthy.
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;

  const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-tests.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Registers the temp repo for removal and returns it. */
function repo(t, options) {
  const root = makeRepo(options);
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

// ── The diff fence, B3 ────────────────────────────────────────────────────────────

test('the diff fence catches a framework rewrite made in an EARLIER commit of the same turn', (t) => {
  // The defect this whole `--base` parameter exists for. A turn is not obliged to be one commit, and
  // the fence used a fixed `HEAD~1..HEAD`, so the first of two commits was invisible to it. Measured
  // green before the fix, on exactly this tree: exit 0, 14 checks, no mention of the framework file.
  //
  // Design §6.4 says this fence exists "to catch an agent quietly reworking the framework so its own
  // scenario turns green" and that it is "never delegated to the judge" — so nothing downstream would
  // have caught it either.
  const root = repo(t, { commitTurn: false });
  const base = git(root, 'rev-parse', 'HEAD');

  write(root, `${PROJECT}/Support/ResourceTracker.cs`, '// quietly reworked so my scenario turns green\n');
  git(root, 'add', `${PROJECT}/Support`);
  git(root, 'commit', '-qm', 'commit 1: rework the framework');
  commitAll(root, 'commit 2: the scenario');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01', '--base', base);
  assert.equal(status, 1, `the fence must not pass a turn that rewrote the framework:\n${out}`);
  assert.match(out, /diff fence/);
  assert.match(out, /Support\/ResourceTracker\.cs/);
});

test('the fence reads the WORKING TREE, so the agent can run the gate before it commits', (t) => {
  // The other half of one fix. PROMPT.tests.md tells the agent to run this and THEN commit on green,
  // but the fence read `HEAD~1..HEAD` — the previous commit — so it judged files no turn had touched.
  // Measured before the fix on this fixture: exit 1, "a stage-1 turn must not touch .gitignore,
  // docs/..., loop/tracker.mjs, scripts/..." — twelve skeleton files from the commit before the turn.
  // The agent's only legal moves were `blocked` or disobedience.
  const root = repo(t, { commitTurn: false });

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 0, `a valid uncommitted turn must pass:\n${out}`);
  assert.match(out, /check:tests OK/);
});

test('an UNCOMMITTED framework edit is inside the fence, which git diff alone cannot see', (t) => {
  // `git diff` is blind to an untracked file entirely, which is why the union needs the status read.
  const root = repo(t, { commitTurn: false });
  write(root, `${PROJECT}/Support/ResourceTracker.cs`, '// reworked, never committed\n');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 1, `an uncommitted stray must fail the fence:\n${out}`);
  assert.match(out, /diff fence/);
  assert.match(out, /Support/);
});

test('an untracked stray is caught even under status.showUntrackedFiles=no', (t) => {
  // `--untracked-files=normal` is not decoration. Measured six times in this project: under that
  // config — which a corporate global template can carry — the BARE `git status --porcelain` returns
  // EMPTY for a tree holding untracked files, so the whole status half of the union would silently
  // contribute nothing and the fence would go quiet exactly when someone had configured it away.
  const root = repo(t, { commitTurn: false });
  git(root, 'config', 'status.showUntrackedFiles', 'no');
  write(root, `${PROJECT}/Support/sneaky.cs`, '// written by the turn, never committed\n');

  assert.doesNotMatch(
    git(root, 'status', '--porcelain'),
    /sneaky|Support/,
    'the bare form is expected to be blind to the untracked file under this config'
  );

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 1, `the explicit flag must still see the stray:\n${out}`);
  assert.match(out, /diff fence/);
  assert.match(out, /Support/);
});

test('the status half is scoped to framework/, or the loop dies at iteration 2', (t) => {
  // The status half CANNOT be repo-wide, and this is the measurement that says so rather than a
  // preference. The runner writes `loop/trackers/<stage>.md` at the end of every iteration and never
  // commits it — ralph.mjs contains no `git commit` at all — and `--allow-dirty` is documented as
  // letting the operator keep unrelated edits outside `framework/`.
  //
  // Measured with the status half left repo-wide: this exact tree failed with "a stage-1 turn must
  // not touch loop/trackers/tests.md", a file no agent had touched, on every iteration after the
  // first. An uncommitted change outside framework/ is not attributable to a turn; a COMMITTED one
  // is, and the diff half — which is repo-wide — catches that the moment it lands.
  const root = repo(t, { commitTurn: false });
  const base = git(root, 'rev-parse', 'HEAD');
  commitAll(root, 'the turn');

  write(root, 'loop/trackers/tests.md', TRACKER.replace('pending', 'rework'));
  write(root, 'docs/specs/petclinic/flows/F-01-owner-lifecycle.md', `${FLOW_DOC}\nan operator's note\n`);

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01', '--base', base);
  assert.equal(status, 0, `the loop's own bookkeeping must not read as a stray:\n${out}`);
});

test('but a change outside framework/ that the turn COMMITTED is still a stray', (t) => {
  // The other side of the same boundary, and what keeps the scoping above from being a hole: the
  // diff half is repo-wide and based on the pre-turn SHA, so anything the turn committed anywhere is
  // unambiguously its own.
  const root = repo(t, { commitTurn: false });
  const base = git(root, 'rev-parse', 'HEAD');
  write(root, 'loop/rubrics/tests.md', '# rewritten by the turn\n');
  commitAll(root, 'the turn, plus a rubric it had no business editing');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01', '--base', base);
  assert.equal(status, 1, `a committed edit outside the fence must fail:\n${out}`);
  assert.match(out, /diff fence/);
  assert.match(out, /loop\/rubrics\/tests\.md/);
});

test('a new file inside the fence passes, committed or not', (t) => {
  const root = repo(t, { commitTurn: false });
  write(root, `${PROJECT}/StepDefinitions/ExtraSteps.cs`, '[Binding]\npublic sealed class ExtraSteps { }\n');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 0, `Features/, StepDefinitions/ and Data/ are the allowed three:\n${out}`);
});

test('a base that does not resolve fails CLOSED, and names the base', (t) => {
  // `gitTry`, not `git`. A `git()` failure returns '' and would read as "the turn changed nothing" —
  // a confidently wrong diagnosis of a turn that may have produced a perfect scenario. A read that
  // fails must never be allowed to shrink the fenced set to an empty, passing one.
  const root = repo(t);
  const missing = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01', '--base', missing);
  assert.equal(status, 1, `an unreadable base must never produce a green gate:\n${out}`);
  assert.match(out, /cannot read the diff/);
  assert.match(out, new RegExp(missing), 'the message must name the base, which is the thing to fix');
});

test('the Excluding inventory covers the whole turn, not only its last commit', (t) => {
  // check-tests.mjs:~303 forbids this by name: the report "must never quietly say nothing when it
  // means unknown". On a two-commit turn the fixed `HEAD~1` base told exactly that lie — an
  // `Excluding` added in the first commit was reported to the judge as `_None._`, silently retiring
  // rubric item 5, which requires every one of them to be justified against the AC text.
  const root = repo(t, { commitTurn: false });
  const base = git(root, 'rev-parse', 'HEAD');

  write(
    root,
    `${PROJECT}/StepDefinitions/OwnerSteps.cs`,
    'using Reqnroll;\n[Binding]\npublic sealed class OwnerSteps {\n' +
      '  [Given("an owner is registered")]\n  public void A() { }\n' +
      '  [Then("the owner details are returned")]\n' +
      '  public void B() { actual.Should().BeEquivalentTo(expected, o => o.Excluding(x => x.Id)); }\n}\n'
  );
  // The Excluding lands in commit 1 and nothing else does, so a base of `HEAD~1` cannot see it.
  git(root, 'add', `${PROJECT}/StepDefinitions`);
  git(root, 'commit', '-qm', 'commit 1: adds an Excluding');
  commitAll(root, 'commit 2: the feature file and the data');

  runCheck(root, '--ac', 'AC-F01-01', '--base', base, '--report', 'loop/verdicts/AC-F01-01.report.md');
  const report = readFileSync(join(root, 'loop/verdicts/AC-F01-01.report.md'), 'utf8');

  const section = report.split('## `Excluding` calls in this diff')[1].split('##')[0];
  assert.doesNotMatch(section, /_None\._/, 'an Excluding in the turn’s first commit must be reported');
  assert.match(section, /Excluding/);
  assert.match(section, /Rubric item 5/);
});

// ── The checks the fence lets through, B10 / B11 / falsy JSON ─────────────────────

test('a literal record id in Data/*.json fails the gate', (t) => {
  // B10. `Data/` is inside the fence and rubric item 15 pushes all of a scenario's data into it, so
  // it is the one writable surface no literal-id check touched: section 4 reads only
  // StepDefinitions/**.cs and section 2 only the feature file. Measured green before the fix.
  const root = repo(t, { commitTurn: false });
  write(root, `${PROJECT}/Data/F01-owner-lifecycle.json`, '{"AC-F01-01": {"path": "/owners/1"}}');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 1, `a seeded id in the data file must fail:\n${out}`);
  assert.match(out, /F01-owner-lifecycle\.json/);
  assert.match(out, /\/owners\/1/);
});

test('the scenario count counts SCENARIOS, so a second untagged one is caught', (t) => {
  // B11. The check counted AC tags, and spec §6.4 gives it one job — "catches a turn that wrote two
  // scenarios or none". Measured green before the fix: a second `Scenario:` with no tag above it.
  const root = repo(t, { commitTurn: false });
  write(
    root,
    `${PROJECT}/Features/F01-owner-lifecycle.feature`,
    `${FEATURE}\n  Scenario: an extra scenario nobody asked for\n    Given an owner is registered\n`
  );

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 1, `two scenarios in one turn must fail:\n${out}`);
  assert.match(out, /scenario count: 2 scenarios against 0 done rows/);
});

test('a data file that parses to a FALSY value still produces a verdict', (t) => {
  // The old guard was `if (data)`, so `null` — and `0`, `false`, `""` — emitted neither a pass nor a
  // fail and section 3 vanished from the report entirely. Measured: 13 check(s) instead of 14, exit 0.
  // A check that can silently not run is the one outcome this design exists to prevent.
  const root = repo(t, { commitTurn: false });
  write(root, `${PROJECT}/Data/F01-owner-lifecycle.json`, 'null');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01');
  assert.equal(status, 1, `a null data file must be reported, not skipped:\n${out}`);
  assert.match(out, /F01-owner-lifecycle\.json/);
  assert.match(out, /top level is null/);
});

test('a valid turn passes every check, so none of the above is a fence that rejects everything', (t) => {
  // The control. Each test above asserts a FAILURE, and a check that always fails would satisfy all
  // of them at once while being useless.
  const root = repo(t, { commitTurn: false });
  const base = git(root, 'rev-parse', 'HEAD');
  commitAll(root, 'the turn');

  const { status, out } = runCheck(root, '--ac', 'AC-F01-01', '--base', base);
  assert.equal(status, 0, `a correct turn must pass:\n${out}`);
  assert.match(out, /check:tests OK — \d+ check\(s\)/);
  assert.doesNotMatch(out, /FAIL/);
});

// ── One sentence bound as both Given and When ─────────────────────────────────────

test('the same sentence bound as Given and When is reuse, not a near-duplicate', (t) => {
  // Measured against the real framework after stage 0 built its 22 request steps: the gate hard-failed
  // on six pairs with "reuse the existing sentence instead of rewording it" — against sentences that
  // were byte identical. Reqnroll's documented way to make a step usable as a precondition and as an
  // action is exactly this, so the check was punishing the maximum reuse it exists to encourage, and
  // stage 1 could not have taken its first turn.
  const root = repo(t);
  write(
    root,
    `${PROJECT}/StepDefinitions/DualSteps.cs`,
    `using Reqnroll;

[Binding]
public sealed class DualSteps
{
    [Given("a visit is recorded for the pet")]
    public void GivenAVisitIsRecorded() { }

    [When("a visit is recorded for the pet")]
    public void WhenAVisitIsRecorded() { }
}
`
  );
  commitAll(root, 'dual binding');

  const result = runCheck(root, '--ac', 'AC-F01-01');
  assert.doesNotMatch(result.out, /near-duplicate/, result.out);
});

test('a rewording across kinds is still caught, so the exemption is not a hole', (t) => {
  // Only IDENTICAL text is exempt. `an owner is registered` against `an owner has been registered`
  // scores 1.00 and is a rewording whichever attributes carry it — and that pair is the canonical
  // one this band was rebuilt for, after `has` was left out of the stop words and it scored 0.33.
  const root = repo(t);
  write(
    root,
    `${PROJECT}/StepDefinitions/RewordedSteps.cs`,
    `using Reqnroll;

[Binding]
public sealed class RewordedSteps
{
    [When("an owner has been registered")]
    public void WhenAnOwnerHasBeenRegistered() { }
}
`
  );
  commitAll(root, 'reworded');

  const result = runCheck(root, '--ac', 'AC-F01-01');
  assert.match(result.out, /near-duplicate steps \(1\.00\)/, result.out);
  assert.equal(result.status, 1);
});

test('two Givens of the same sentence are still a duplicate, because the kind is the same', (t) => {
  const root = repo(t);
  write(
    root,
    `${PROJECT}/StepDefinitions/TwiceSteps.cs`,
    `using Reqnroll;

[Binding]
public sealed class TwiceSteps
{
    [Given("an owner is registered")]
    public void GivenAgain() { }
}
`
  );
  commitAll(root, 'twice');

  const result = runCheck(root, '--ac', 'AC-F01-01');
  assert.match(result.out, /near-duplicate steps \(1\.00\)/, result.out);
  assert.equal(result.status, 1);
});
