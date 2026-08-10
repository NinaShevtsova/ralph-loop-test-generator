// tests/manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCAFFOLD_MANIFEST, PROJECT_DIR } from '../scripts/manifest.scaffold.mjs';

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
