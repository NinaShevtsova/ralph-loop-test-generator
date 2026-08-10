// scripts/check-scaffold.mjs — step 1 of the stage-0 gate (design §5.2).
//
// Answers exactly one question: are the files stage 0 was told to build **so far** present and
// non-trivial? Everything semantic is the judge's job.
//
// "So far" is the whole point. Stage 0 builds in eight waves, so checking all 39 entries at every
// gate run is red by construction from wave 1 until wave 8 — and the runner's pre-turn gate treats a
// red HEAD as fatal. Measured: with wave 1 built, the unfiltered check reported 37 problems and exit
// 1, which would have killed stage 0 at iteration 2. Each entry therefore carries the wave that
// builds it, and the gate checks waves 1..N.
//
//   node scripts/check-scaffold.mjs --through-wave 3
//   npm run check:scaffold                       (no wave: checks everything, i.e. the final state)

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, Verdict } from './lib.mjs';
import { SCAFFOLD_MANIFEST } from './manifest.scaffold.mjs';

const ROOT = repoRoot(import.meta.url);
const v = new Verdict('check:scaffold');

// A file under this size is a stub in every realistic case, and a stub that satisfies its probes
// by accident would let a whole wave through.
//
// This floor is load-bearing for the manifest, and the coupling is not visible from there. Two
// entries — `framework/reqnroll.json` and `Data/FrameworkSmokeTests.json` — use the deliberate
// catch-all probe `/./s`, which any single character satisfies, whitespace included. A file
// containing `"\n\n  \n"` passes both and is caught here, at five bytes, and nowhere else. Lower or
// remove this and those two entries stop checking anything at all.
const MIN_BYTES = 40;

// Which waves should be complete by now. The runner passes the wave of the row it is working on;
// without the flag the gate checks the finished framework, which is what `npm run check:scaffold`
// means on its own.
const waveAt = process.argv.indexOf('--through-wave');
const throughWave = waveAt === -1 ? Infinity : Number(process.argv[waveAt + 1]);

if (waveAt !== -1 && (!Number.isInteger(throughWave) || throughWave < 1)) {
  console.error(`check:scaffold: --through-wave ${process.argv[waveAt + 1]} — must be a positive integer`);
  process.exit(2);
}

const inScope = SCAFFOLD_MANIFEST.filter((entry) => entry.wave <= throughWave);

if (inScope.length === 0) {
  console.error(`check:scaffold: no manifest entry belongs to wave ${throughWave} or earlier`);
  process.exit(2);
}

console.log(
  throughWave === Infinity
    ? `check:scaffold: all ${inScope.length} manifest entries`
    : `check:scaffold: ${inScope.length} entries from waves 1..${throughWave}`
);

for (const entry of inScope) {
  const absolute = join(ROOT, entry.path);

  if (!existsSync(absolute)) {
    v.fail(`${entry.path}: missing`);
    continue;
  }

  // The gate's verdict must describe what stage 0 wrote, not what the filesystem is willing to
  // resolve. Windows matches paths case-insensitively, so `models/owner.cs` satisfied an entry for
  // `Models/Owner.cs` — measured. That is not a cosmetic difference: `outsideFence` in
  // scripts/checks.mjs compares `Features/`, `StepDefinitions/` and `Data/` case-SENSITIVELY, so a
  // tree accepted here in the wrong case would make every stage-1 diff read as outside the fence.
  const onDisk = realpathSync.native(absolute).split('\\').join('/');
  if (!onDisk.endsWith(entry.path)) {
    // Two different faults land here and they need different messages. `realpathSync` resolves links
    // as well as case, so a junction inside the tree — a bind mount, or a developer checkout that
    // symlinks part of it — also lands here with its case perfectly correct. Telling that reader
    // "the case must match exactly" is a confidently wrong diagnosis, and the likeliest response to it
    // is renaming correct files back and forth. Measured before this branch existed, the message also
    // printed a fragment cut mid-segment, because slicing by character count is not slicing by path.
    const differsOnlyInCase = onDisk.toLowerCase().endsWith(entry.path.toLowerCase());
    v.fail(
      differsOnlyInCase
        ? `${entry.path}: on disk as ${onDisk.slice(-entry.path.length)} — the case must match exactly`
        : `${entry.path}: resolves to ${onDisk} — a link or junction points outside the expected tree`
    );
    continue;
  }

  const stats = statSync(absolute);

  // Checked explicitly rather than relying on the size floor. A directory at a manifest path reports
  // 0 bytes on Windows and is caught below, but 4096 on Linux — where it would clear the floor and
  // `readFileSync` would then throw EISDIR, replacing the verdict line with a stack trace.
  if (!stats.isFile()) {
    v.fail(`${entry.path}: exists but is not a file`);
    continue;
  }

  const size = stats.size;
  if (size < MIN_BYTES) {
    v.fail(`${entry.path}: only ${size} bytes — too small to be a built file`);
    continue;
  }

  const text = readFileSync(absolute, 'utf8');
  const missing = entry.probes.filter((probe) => !probe.test(text));

  if (missing.length > 0) {
    v.fail(
      `${entry.path}: exists but is missing ${missing.length} required marker(s): ` +
        missing.map((probe) => probe.source).join(' , ')
    );
    continue;
  }

  v.pass(`${entry.path} (${entry.probes.length} probe(s))`);
}

v.report({ quiet: process.argv.includes('--quiet') });
