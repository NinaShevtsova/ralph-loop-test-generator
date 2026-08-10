// tests/flows.test.mjs
//
// scripts/flows.mjs is the single home for the flow groups and the four paths derived from them.
// Three files used to carry their own copy, and the fix for a bad error message reached one of them.
// These tests exist so the next copy has somewhere to be deleted into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLOW_GROUPS,
  PROJECT,
  flowGroupOfAc,
  flowSlug,
  flowDocPath,
  featurePath,
  dataPath,
  RUNNER_STATE,
} from '../scripts/flows.mjs';
import { STAGE1_ALLOWED } from '../scripts/checks.mjs';
import { SCAFFOLD_MANIFEST, PROJECT_DIR } from '../scripts/manifest.scaffold.mjs';
import { run } from '../scripts/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('FLOW_GROUPS maps every flow group to its slug', () => {
  assert.deepEqual(FLOW_GROUPS, {
    'F-01': 'F01-owner-lifecycle',
    'F-02': 'F02-owner-pet-lifecycle',
    'F-03': 'F03-pet-visit-flow',
  });
});

test('flowGroupOfAc reads the flow out of an AC id', () => {
  assert.equal(flowGroupOfAc('AC-F01-01'), 'F-01');
  assert.equal(flowGroupOfAc('AC-F02-03'), 'F-02');
  assert.equal(flowGroupOfAc('AC-F03-07'), 'F-03');
  // Every id in both trackers must round-trip, since the tag is the only link between a scenario
  // and its flow, and check:tests derives the feature file from it.
  for (const group of Object.keys(FLOW_GROUPS)) {
    assert.equal(flowGroupOfAc(`AC-${group.replace('-', '')}-01`), group);
  }
});

test('flowSlug returns the slug both file names are built from', () => {
  for (const [group, slug] of Object.entries(FLOW_GROUPS)) {
    assert.equal(flowSlug(group), slug);
  }
});

test('the three paths are derived from FLOW_GROUPS and stay repository-relative', () => {
  for (const [group, slug] of Object.entries(FLOW_GROUPS)) {
    assert.equal(flowDocPath(group), `docs/specs/petclinic/flows/${group}-${slug.slice(4)}.md`);
    assert.equal(featurePath(group), `framework/src/PetClinic.ApiTests/Features/${slug}.feature`);
    assert.equal(dataPath(group), `framework/src/PetClinic.ApiTests/Data/${slug}.json`);
    // Repository-relative: a caller joins them onto its own root, so a leading slash or a drive
    // letter here would silently escape whichever root the caller resolved.
    for (const path of [flowDocPath(group), featurePath(group), dataPath(group)]) {
      assert.ok(!path.startsWith('/') && !/^[A-Za-z]:/.test(path), `${path} is not relative`);
      assert.ok(!path.includes('\\'), `${path} must use forward slashes`);
    }
  }
});

test('flowDocPath names a file that actually exists', () => {
  // The only one of the three that is checkable today: the flow documents are committed, while the
  // feature and data files are stage 0's output. A formula is only correct if it hits a real file.
  for (const group of Object.keys(FLOW_GROUPS)) {
    assert.ok(existsSync(join(ROOT, flowDocPath(group))), `${flowDocPath(group)} does not exist`);
  }
});

test('every derivation names the unknown group rather than throwing a bare TypeError', () => {
  // The failure this replaces was `Cannot read properties of undefined (reading 'slice')`, which
  // named neither the group, the file, nor the fix — and which was fixed in one of three copies.
  for (const [name, fn] of [
    ['flowSlug', flowSlug],
    ['flowDocPath', flowDocPath],
    ['featurePath', featurePath],
    ['dataPath', dataPath],
  ]) {
    assert.throws(
      () => fn('F-09'),
      new RegExp(`${name}: "F-09" is not a known flow.*expected one of F-01, F-02, F-03`, 's'),
      `${name} must name itself and the bad group`
    );
  }
});

test('no other module spells out a path that flows.mjs derives', () => {
  // This is the test the last three copies did not have. `loop/config.mjs` held the map,
  // `loop/invoke.mjs` built two of the paths, `scripts/check-tests.mjs` held a second copy of the map
  // under another name and rebuilt all four — so the fix for one bad error message reached one of them.
  // If a new site legitimately needs a path, it imports the helper; that is the whole point.
  const OWNER = join('scripts', 'flows.mjs');
  const FORMULAS = [
    'PetClinic.ApiTests/Features/',
    'PetClinic.ApiTests/Data/',
    'petclinic/flows/',
  ];

  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.mjs')) {
        const relative = full.slice(ROOT.length + 1).split('\\').join('/');
        if (relative === OWNER.split('\\').join('/')) continue;
        const text = readFileSync(full, 'utf8');
        for (const formula of FORMULAS) {
          if (text.includes(formula)) offenders.push(`${relative} spells out "${formula}"`);
        }
      }
    }
  };
  // `loop/` and `scripts/` only. A test file is where a literal path BELONGS — an assertion that
  // derived the expected value the same way the code did would pass no matter what either said.
  for (const dir of ['loop', 'scripts']) walk(join(ROOT, dir));

  assert.deepEqual(
    offenders,
    [],
    `these must import from scripts/flows.mjs instead:\n  ${offenders.join('\n  ')}`
  );
});

test('PROJECT is the root every project path is built from', () => {
  assert.equal(PROJECT, 'framework/src/PetClinic.ApiTests');
  for (const group of Object.keys(FLOW_GROUPS)) {
    assert.ok(featurePath(group).startsWith(`${PROJECT}/`), `${featurePath(group)} must sit under PROJECT`);
    assert.ok(dataPath(group).startsWith(`${PROJECT}/`), `${dataPath(group)} must sit under PROJECT`);
  }
  // The flow documents are specs, not project files — they must NOT move with PROJECT.
  for (const group of Object.keys(FLOW_GROUPS)) {
    assert.ok(!flowDocPath(group).startsWith(PROJECT), 'a flow document is a spec, not project output');
  }
});

test('the stage-1 fence does NOT cover every directory dotnet test compiles', () => {
  // This is why the runner's left-behind probe watches all of `framework/` rather than the fence.
  //
  // An earlier version scoped it to the three fenced directories. An agent editing a file outside them
  // and not committing it was then invisible twice over — the probe did not look there, and
  // `check-tests.mjs`'s diff fence inspects only the commit — while `dotnet test` compiled that file
  // from the working tree, so it could be the reason a scenario went green. This asserts the gap is
  // real and names its size, so nobody re-narrows the probe on the assumption that the fence is the
  // whole compiled surface.
  const compiledDirs = new Set();
  for (const entry of SCAFFOLD_MANIFEST) {
    if (!entry.path.endsWith('.cs') || !entry.path.startsWith(`${PROJECT}/`)) continue;
    const inner = entry.path.slice(PROJECT.length + 1);
    if (inner.includes('/')) compiledDirs.add(`${inner.split('/')[0]}/`);
  }

  const outsideFence = [...compiledDirs].filter((dir) => !STAGE1_ALLOWED.includes(dir)).sort();
  assert.deepEqual(outsideFence, [
    'Config/',
    'Hooks/',
    'Http/',
    'Models/',
    'Services/',
    'Support/',
    'TestData/',
    'Tests/',
  ]);
  assert.ok(
    STAGE1_ALLOWED.includes('StepDefinitions/'),
    'the fence must still cover the one compiled directory a stage-1 turn may write to'
  );
});

test('the project path is not spelled out twice', () => {
  // `scripts/manifest.scaffold.mjs` declares its own `PROJECT_DIR` with the same literal, and it has no
  // imports by design — it is the specification stage 0 is graded against. So the duplicate stays, but
  // it does not get to drift silently: this is the sixth copy of a derivation found in this task, and
  // the previous five were all found by accident.
  assert.equal(PROJECT, PROJECT_DIR, 'flows.mjs PROJECT and manifest.scaffold.mjs PROJECT_DIR disagree');
});

test('the two toolchain escapees are ignored, and real work in the same directory is not', () => {
  // The runner watches Features/, StepDefinitions/ and Data/ for work an agent failed to commit.
  // Reqnroll's generated `*.feature.cs` lands INSIDE Features/ under one configuration, and
  // `packages.lock.json` appears beside the csproj when a machine-level Directory.Build.props sets
  // RestorePackagesWithLockFile. Both would have read as the agent's uncommitted work.
  const ignored = (path) => run('git', ['-C', ROOT, 'check-ignore', path]).status === 0;

  assert.ok(ignored(`${PROJECT}/Features/F01-owner-lifecycle.feature.cs`), '*.feature.cs must be ignored');
  assert.ok(ignored(`${PROJECT}/packages.lock.json`), 'packages.lock.json must be ignored');
  assert.ok(ignored(`${PROJECT}/obj/Debug/x.dll`), 'obj/ was already ignored');

  // And the files a turn actually produces are still visible, or the probe would see nothing at all.
  for (const group of Object.keys(FLOW_GROUPS)) {
    assert.ok(!ignored(featurePath(group)), `${featurePath(group)} must NOT be ignored`);
    assert.ok(!ignored(dataPath(group)), `${dataPath(group)} must NOT be ignored`);
  }
  assert.ok(!ignored(`${PROJECT}/StepDefinitions/OwnerSteps.cs`), 'step definitions must NOT be ignored');
});

// ── The runner and the fence must name the same files ───────────────────────────────

test('every stage the runner can run has a tracker the fence exempts', async () => {
  // This is the drift guard, and it is the point of putting the paths in one file. `checks.mjs`
  // exempts RUNNER_STATE from the stage-1 diff fence; `config.mjs` points each stage at a tracker.
  // Spelled out separately they could disagree, and the failure is quiet and one-directional: the
  // runner writes a file the fence then refuses, so every rework turn fails for touching it.
  const { STAGES } = await import('../loop/config.mjs');
  const { RUNNER_STATE } = await import('../scripts/flows.mjs');

  for (const [name, stage] of Object.entries(STAGES)) {
    assert.ok(
      RUNNER_STATE.includes(stage.tracker),
      `stage ${name} writes ${stage.tracker}, which the stage-1 fence would refuse`
    );
  }
  assert.equal(RUNNER_STATE.length, Object.keys(STAGES).length, 'RUNNER_STATE has an entry no stage uses');
});

test('the exempted trackers exist on disk', () => {
  for (const relative of RUNNER_STATE) {
    assert.ok(existsSync(join(ROOT, relative)), `${relative} is exempted from the fence but does not exist`);
  }
});
