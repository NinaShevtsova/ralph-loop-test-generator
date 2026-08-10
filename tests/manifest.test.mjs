// tests/manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';
import { parseRows } from '../loop/tracker.mjs';
import {
  SCAFFOLD_MANIFEST,
  SCAFFOLD_ROWS,
  PROJECT_DIR,
  entriesThroughRow,
} from '../scripts/manifest.scaffold.mjs';

const ROOT = repoRoot(import.meta.url);
const tracker = () => readFileSync(join(ROOT, 'loop/trackers/scaffold.md'), 'utf8');

test('the manifest covers every file design §4 assigns to stage 0', () => {
  assert.equal(SCAFFOLD_MANIFEST.length, 39);
});

test('every entry has a path and at least one probe', () => {
  for (const entry of SCAFFOLD_MANIFEST) {
    assert.equal(typeof entry.path, 'string', 'path must be a string');
    assert.ok(entry.path.length > 0, 'path must not be empty');
    assert.ok(Array.isArray(entry.probes), `${entry.path}: probes must be an array`);
    assert.ok(entry.probes.length >= 1, `${entry.path}: needs at least one probe`);
    for (const probe of entry.probes) {
      assert.ok(probe instanceof RegExp, `${entry.path}: every probe must be a RegExp`);
    }
  }
});

test('paths are unique', () => {
  const paths = SCAFFOLD_MANIFEST.map((entry) => entry.path);
  assert.equal(new Set(paths).size, paths.length);
});

test('paths use forward slashes and are repo-relative', () => {
  for (const entry of SCAFFOLD_MANIFEST) {
    assert.ok(!entry.path.includes('\\'), `${entry.path}: use forward slashes`);
    assert.ok(entry.path.startsWith('framework/'), `${entry.path}: must be under framework/`);
  }
});

test('the manifest requires all four services', () => {
  for (const name of ['Owners', 'Pets', 'Visits', 'PetTypes']) {
    assert.ok(
      SCAFFOLD_MANIFEST.some((entry) => entry.path.endsWith(`Services/${name}Service.cs`)),
      `missing Services/${name}Service.cs`
    );
  }
});

test('the manifest requires all four step definition files', () => {
  for (const name of ['Owner', 'Pet', 'Visit', 'PetType']) {
    assert.ok(
      SCAFFOLD_MANIFEST.some((entry) => entry.path.endsWith(`StepDefinitions/${name}Steps.cs`)),
      `missing StepDefinitions/${name}Steps.cs`
    );
  }
});

test('the manifest requires the three feature skeletons', () => {
  for (const name of ['F01-owner-lifecycle', 'F02-owner-pet-lifecycle', 'F03-pet-visit-flow']) {
    assert.ok(
      SCAFFOLD_MANIFEST.some((entry) => entry.path.endsWith(`Features/${name}.feature`)),
      `missing Features/${name}.feature`
    );
  }
});

test('the manifest does NOT require the stage-1 data files', () => {
  for (const name of ['F01-owner-lifecycle', 'F02-owner-pet-lifecycle', 'F03-pet-visit-flow']) {
    assert.ok(
      !SCAFFOLD_MANIFEST.some((entry) => entry.path.endsWith(`Data/${name}.json`)),
      `Data/${name}.json is written by stage 1 and must not gate stage 0`
    );
  }
});

test('the csproj probe pins FluentAssertions inside 7.x — D-03', () => {
  const csproj = SCAFFOLD_MANIFEST.find((entry) => entry.path.endsWith('PetClinic.ApiTests.csproj'));
  const source = csproj.probes.map((p) => p.source).join(' ');
  assert.match(source, /FluentAssertions/);
  assert.match(source, /\\\[7\\\./, 'the probe must require the bracketed exact-version form [7.x.y]');
});

test('the FluentAssertions probe accepts and rejects the right versions', () => {
  // D-03 is a licensing decision: 7.x is Apache 2.0, 8.x is commercial. This probe is the only
  // deterministic thing standing between a restore and that line, so it gets a real table.
  const probe = SCAFFOLD_MANIFEST.find((entry) => entry.path.endsWith('PetClinic.ApiTests.csproj')).probes.find(
    (candidate) => /FluentAssertions/.test(candidate.source)
  );
  const csproj = (version, neighbour) => `<Project><ItemGroup>
    <PackageReference Include="FluentAssertions" Version="${version}" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Json" Version="${neighbour}" />
  </ItemGroup></Project>`;

  assert.equal(probe.test(csproj('[7.2.0]', '9.0.0')), true, 'an exact 7.x pin must be accepted');
  assert.equal(probe.test(csproj('7.*', '9.0.0')), false, 'a floating range must be rejected');
  assert.equal(probe.test(csproj('8.0.0', '9.0.0')), false, 'an 8.x pin must be rejected');
  assert.equal(probe.test(csproj('[8.0.0]', '9.0.0')), false, 'an exact 8.x pin must be rejected');

  // The measured false pass this probe was tightened for: with an any-character window, a neighbouring
  // package pinned `[7.` sat 93 characters away — inside 120 — and a wrongly pinned FluentAssertions
  // was accepted. `[^>]` cannot cross out of the element.
  assert.equal(
    probe.test(csproj('8.0.0', '[7.0.0]')),
    false,
    'a [7. pin on the NEXT package must not satisfy the FluentAssertions probe'
  );
});

test('PROJECT_DIR points at the single project', () => {
  assert.equal(PROJECT_DIR, 'framework/src/PetClinic.ApiTests');
});

// ── The row tags, against the tracker that owns them ──────────────────────────────────
//
// Two files must agree about which row builds which file. `loop/trackers/scaffold.md` tells the
// AGENT what to build — its details sections are the authority, written for a human. The manifest
// tells the GATE what to demand, and `check-scaffold.mjs --through-row S6` scopes that demand to the
// target row and everything before it. A tag that disagrees with the tracker makes the gate ask a
// turn for a file it was never told to write, which is the defect the row scope exists to remove,
// pointed the other way.
//
// So this is a derivation, and six copies of a derivation have already been found in this harness.
// It is kept HERE rather than in production code deliberately: one datum (the tag), one place that
// re-derives it (this file). A gate that parsed the tracker at run time would take its scope from a
// file the agent edits mid-turn.
//
// `parseRows` is the loop's own tracker parser, so "a row" means here exactly what it means to the
// runner — a renamed or deleted row cannot be invisible to the guard and visible to the loop.

/**
 * The files each row's details section names, keyed by row id.
 *
 * Two spellings appear in the live file and both are honoured, because both are how a person writes
 * a file list: `PROJECT/Config/TestSettings.cs` — `PROJECT` being the project directory — and a bare
 * `PetCase.cs` following a full path, which inherits that path's directory the way a reader reads it.
 */
function filesByRow(markdown) {
  const lines = markdown.split(/\r?\n/);
  const byRow = new Map();
  let row = null;

  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^###\s+(S\d+)\s+—/.exec(lines[i]);
    if (heading) {
      row = heading[1];
      byRow.set(row, []);
      continue;
    }
    // A new chapter ("## Open questions") ends the details sections. Without this, a backticked
    // file name in the free text an agent writes there would be attributed to the last row seen.
    if (/^##\s/.test(lines[i])) row = null;
    if (row === null || !lines[i].includes('**Files:**')) continue;

    // The list runs to the blank line before the DoD. Three rows spill onto a second line, so
    // reading only the `**Files:**` line itself would silently lose half of S1, S10 and S12.
    const paragraph = [];
    for (let j = i; j < lines.length && (j === i || lines[j].trim() !== ''); j += 1) paragraph.push(lines[j]);

    let directory = null;
    for (const token of paragraph.join(' ').match(/`[^`]+`/g) ?? []) {
      let path = token.slice(1, -1).trim();
      if (!/\.[A-Za-z0-9]+$/.test(path)) continue; // backticked prose, not a file name
      if (path.startsWith('PROJECT/')) path = `${PROJECT_DIR}/${path.slice('PROJECT/'.length)}`;
      if (path.includes('/')) {
        directory = path.slice(0, path.lastIndexOf('/'));
      } else {
        assert.ok(directory, `${row}: the details section names \`${path}\` before naming any directory`);
        path = `${directory}/${path}`;
      }
      byRow.get(row).push(path);
    }
  }

  return byRow;
}

/** `{ S1: [path, …] }` with each list sorted, so the two sides compare as sets. */
const asMapping = (byRow) => Object.fromEntries([...byRow].map(([id, files]) => [id, [...files].sort()]));

function manifestMapping() {
  const byRow = new Map();
  for (const entry of SCAFFOLD_MANIFEST) {
    if (!byRow.has(entry.row)) byRow.set(entry.row, []);
    byRow.get(entry.row).push(entry.path);
  }
  return asMapping(byRow);
}

test('the derivation reads the tracker — 14 rows naming 39 files', () => {
  // FIRST, because every check below compares against this parse. A parser that silently found
  // nothing would make the whole guard vacuous and green: measured on this shape, an empty result
  // agrees with an empty manifest about everything.
  const byRow = filesByRow(tracker());
  assert.equal(byRow.size, 14, 'the details sections did not parse into 14 rows');
  const named = [...byRow.values()].reduce((total, files) => total + files.length, 0);
  assert.equal(named, 39, `the details sections name ${named} file(s), not 39`);
});

test('every manifest entry names the tracker row that builds it', () => {
  const known = new Set(parseRows(tracker()).map((row) => row.id));
  for (const entry of SCAFFOLD_MANIFEST) {
    assert.equal(typeof entry.row, 'string', `${entry.path}: no row tag — the gate cannot scope it`);
    assert.ok(known.has(entry.row), `${entry.path}: tagged ${entry.row}, which is not a tracker row`);
  }
});

test('every tracker row owns at least one manifest entry', () => {
  for (const row of parseRows(tracker())) {
    assert.ok(
      SCAFFOLD_MANIFEST.some((entry) => entry.row === row.id),
      `${row.id} owns no manifest entry, so its turn is gated on nothing of its own`
    );
  }
});

test('the tracker and the manifest agree, path for path, about which row builds what', () => {
  assert.deepEqual(manifestMapping(), asMapping(filesByRow(tracker())));
});

test('the guard has teeth — a file attributed to the wrong row is caught', () => {
  // The one thing a mapping test can do wrong is agree with everything. This moves S8's file into
  // S7's details section, exactly the drift the guard exists for, and requires the comparison to go
  // red. `ScenarioState.cs` is chosen because S9's section still names it too, so the drifted file
  // is double-claimed — the shape a careless edit actually produces.
  const drifted = tracker().replace(
    '**Files:** `PROJECT/Support/ReadinessProbe.cs`',
    '**Files:** `PROJECT/Support/ScenarioState.cs`'
  );
  assert.notEqual(drifted, tracker(), 'the fixture edit did not apply — the guard would prove nothing');
  assert.notDeepEqual(manifestMapping(), asMapping(filesByRow(drifted)));
});

test('SCAFFOLD_ROWS is the tracker table order, which is what --through-row scopes by', () => {
  // `--through-row S6` means "S6 and every row before it", and "before" is a position in THIS list.
  // If it drifted from the tracker's order, the gate would move the boundary without anyone editing
  // a scope: rows the loop has not reached yet would be demanded, or rows already built dropped.
  assert.deepEqual(
    [...SCAFFOLD_ROWS],
    parseRows(tracker()).map((row) => row.id)
  );
});

test('every entry carries the wave its row sits in', () => {
  // `--through-wave` and `--through-row` read two fields of the same entry, and the pre-turn and
  // post-turn gates use one each. A row whose entries disagreed with its tracker group would make
  // the two gates describe different trees. The mutation review noted the wave field was pinned by
  // nothing at all; this pins all 39.
  const waveOfRow = new Map(
    parseRows(tracker()).map((row) => [row.id, Number(row.group.replace('wave-', ''))])
  );
  for (const entry of SCAFFOLD_MANIFEST) {
    assert.equal(
      entry.wave,
      waveOfRow.get(entry.row),
      `${entry.path}: tagged wave ${entry.wave}, but ${entry.row} is in wave ${waveOfRow.get(entry.row)}`
    );
  }
});

test('entriesThroughRow returns that row and every row before it', () => {
  const rowsOf = (entries) => [...new Set(entries.map((entry) => entry.row))];

  assert.deepEqual(rowsOf(entriesThroughRow('S1')), ['S1']);
  assert.equal(entriesThroughRow('S1').length, 5);

  // The measured case: S6 is the first row of a three-row wave, so its scope is waves 1-4 whole plus
  // one file. Wave-scoped, the same gate demanded 22 entries and two of them belonged to later turns.
  assert.deepEqual(rowsOf(entriesThroughRow('S6')), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.equal(entriesThroughRow('S6').length, 20);
  assert.equal(entriesThroughRow('S7').length, 21);

  assert.equal(entriesThroughRow(SCAFFOLD_ROWS.at(-1)).length, SCAFFOLD_MANIFEST.length);
});

test('entriesThroughRow returns null for a row the manifest does not know', () => {
  // Not an empty list: an empty scope reaching the gate would be reported by `Verdict` as "no checks
  // ran", and a caller that treated it as "nothing to check" would have a green gate on a typo.
  for (const unknown of ['S99', 's6', 'S6 ', '', undefined, null]) {
    assert.equal(entriesThroughRow(unknown), null, `${JSON.stringify(unknown)} must not resolve to a scope`);
  }
});
