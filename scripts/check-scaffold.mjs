// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The automatic inspector for the FIRST stage — the one that builds the test framework
// itself, before any tests are written.
//
// It asks one simple question: are the files this stage was told to create SO FAR present,
// and are they real rather than empty placeholders? Nothing about quality — that is the
// grader's job.
//
// "So far" is the whole trick. The framework is built in eight waves, so checking all of
// it on turn one would fail every early turn by construction and stop the loop before it
// started. The check is therefore always scoped to the step being worked on.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/check-scaffold.mjs — step 1 of the stage-0 gate (design §5.2).
//
// Answers exactly one question: are the files stage 0 was told to build **so far** present and
// non-trivial? Everything semantic is the judge's job.
//
// "So far" is the whole point. Stage 0 builds in eight waves, so checking all 39 entries at every
// gate run is red by construction from wave 1 until wave 8 — and the runner's pre-turn gate treats a
// red HEAD as fatal. Measured: with wave 1 built, the unfiltered check reported 37 problems and exit
// 1, which would have killed stage 0 at iteration 2.
//
// "So far" has TWO meanings, and conflating them is the second way this gate goes red by
// construction. A wave is a set of rows and a turn builds ONE row (design §6.2), so:
//
//   --through-row S6    every file of S1..S6. What must exist when the S6 turn is done, and the
//                       only scope a POST-turn gate can fairly demand: four of the eight waves hold
//                       more than one row, so a wave-scoped gate on the first row of any of them
//                       demands files from turns nobody has been asked to take. Measured on the live
//                       run: `--through-wave 5` for S6 was red with `ResourceTracker.cs` (S7) and
//                       `ReadinessProbe.cs` (S8) missing, while S6's own file passed every probe.
//   --through-wave 4    every file of waves 1..4. What must ALREADY exist before a wave-5 turn
//                       starts — while any row of wave 5 is open, wave 4 is the last complete one.
//                       This is loop/gates.mjs's pre-turn gate, and it is correct as it stands.
//
//   node scripts/check-scaffold.mjs --through-row S6
//   node scripts/check-scaffold.mjs --through-wave 3
//   npm run check:scaffold                       (no scope: checks everything, i.e. the final state)

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, Verdict } from './lib.mjs';
import { SCAFFOLD_MANIFEST, SCAFFOLD_ROWS, entriesThroughRow } from './manifest.scaffold.mjs';

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

// How much of the manifest should be complete by now. Without a scope the gate checks the finished
// framework, which is what `npm run check:scaffold` means on its own.
const rowAt = process.argv.indexOf('--through-row');
const waveAt = process.argv.indexOf('--through-wave');

// Refused rather than resolved by precedence. The two flags answer different questions and a caller
// that passes both has one of them wrong; silently honouring the other would run the gate at a scope
// nobody asked for, and the header line would then be the only evidence — in a log the runner only
// reads when the gate is already red.
if (rowAt !== -1 && waveAt !== -1) {
  console.error(
    'check:scaffold: --through-row and --through-wave are two different scopes — pass one.\n' +
      '  --through-row  S6   the rows up to and including S6 (a turn builds one row)\n' +
      '  --through-wave 4    the waves up to and including 4 (what is complete before a turn starts)'
  );
  process.exit(2);
}

let inScope;
let scope;

if (rowAt !== -1) {
  const throughRow = process.argv[rowAt + 1];
  inScope = entriesThroughRow(throughRow);

  // Never falls through to "check everything": a typo would then run the FINAL-state gate, which is
  // red until the last row of stage 0 and would be read as a verdict on the turn.
  if (inScope === null) {
    console.error(
      `check:scaffold: --through-row ${throughRow ?? '(missing)'} — no such row; ` +
        `the manifest knows ${SCAFFOLD_ROWS.join(', ')}`
    );
    process.exit(2);
  }

  scope = `${inScope.length} entries from rows ${SCAFFOLD_ROWS[0]}..${throughRow}`;
} else {
  const throughWave = waveAt === -1 ? Infinity : Number(process.argv[waveAt + 1]);

  if (waveAt !== -1 && (!Number.isInteger(throughWave) || throughWave < 1)) {
    console.error(`check:scaffold: --through-wave ${process.argv[waveAt + 1]} — must be a positive integer`);
    process.exit(2);
  }

  inScope = SCAFFOLD_MANIFEST.filter((entry) => entry.wave <= throughWave);

  if (inScope.length === 0) {
    console.error(`check:scaffold: no manifest entry belongs to wave ${throughWave} or earlier`);
    process.exit(2);
  }

  scope =
    throughWave === Infinity
      ? `all ${inScope.length} manifest entries`
      : `${inScope.length} entries from waves 1..${throughWave}`;
}

console.log(`check:scaffold: ${scope}`);

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
