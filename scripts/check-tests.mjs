// scripts/check-tests.mjs — step 4 of the stage-1 gate (design §6.4).
//
// Reads the working tree and the turn's diff, runs every deterministic check, and also EMITS a
// machine report the runner passes to the judge (the Excluding inventory and the 0.65..0.90
// near-duplicate band). Those two are inputs for a human-grade decision, not verdicts.
//
//   node scripts/check-tests.mjs --ac AC-F02-01
//   node scripts/check-tests.mjs --ac AC-F02-01 --base 9a3f21c
//   node scripts/check-tests.mjs --ac AC-F02-01 --report loop/verdicts/AC-F02-01.report.md

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

import { repoRoot, gitTry, Verdict } from './lib.mjs';
import {
  literalIds,
  literalIdsInFeature,
  literalIdsInData,
  forbiddenApis,
  scenarioOutlines,
  foreignLanguageHeader,
  scenarioTags,
  malformedAcTags,
  scenarioTitles,
  excludings,
  outsideFence,
} from './checks.mjs';
import { extractSteps, similarity, isReordering } from './steps-inventory.mjs';
import {
  FLOW_GROUPS,
  PROJECT as PROJECT_DIR,
  flowGroupOfAc,
  flowSlug as slugOf,
  flowDocPath,
  featurePath as featurePathOf,
  dataPath as dataPathOf,
} from './flows.mjs';
import { parseRows } from '../loop/tracker.mjs';

const ROOT = repoRoot(import.meta.url);
// From flows.mjs, not spelled out again. This was a fifth copy of a derivation that file exists to
// own — one directory above the three paths it already builds.
const PROJECT = join(ROOT, PROJECT_DIR);
const v = new Verdict('check:tests');

const argAt = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const targetAc = argAt('--ac');
if (!targetAc) {
  console.error('check:tests: --ac <AC-Fxx-yy> is required');
  process.exit(2);
}

// Flow group, slug and every derived path come from scripts/flows.mjs. This file used to carry its
// own copy of the map under a second name, plus its own version of all four path formulas, under a
// comment claiming there was nothing to keep in sync. There were four things to keep in sync.
//
// Membership is tested before `slugOf`, which throws: an unusable `--ac` is a broken invocation, and
// exit 2 with a sentence beats exit 1 with a stack trace.
const flowGroup = flowGroupOfAc(targetAc);

if (!FLOW_GROUPS[flowGroup]) {
  console.error(`check:tests: cannot derive a flow from "${targetAc}"`);
  process.exit(2);
}

const flowSlug = slugOf(flowGroup);

/** Every file with the given extension under `dir`, recursively. */
function filesUnder(dir, extension) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(extension)) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

const rel = (absolute) => relative(ROOT, absolute).split('\\').join('/');

// ── 1. Diff fence: a stage-1 turn touches only Features/, StepDefinitions/, Data/ ──
//
// The base defaults to HEAD, which makes the union below degenerate to "the working tree" — the right
// answer for the agent, which runs this BEFORE it commits and whose HEAD has therefore not moved. The
// runner passes `--base <pre-turn SHA>` after the turn has committed, where the working tree is clean
// and the union degenerates the other way, to the committed range. One code path, no mode flag.
//
// The old fixed `HEAD~1..HEAD` was wrong for both callers at once. For the runner it assumed a turn is
// exactly one commit: measured, commit 1 rewriting `Support/ResourceTracker.cs` and commit 2 adding the
// feature file passed the fence GREEN, with the framework edit invisible — and this fence is the one
// thing design §6.4 says is "never delegated to the judge". For the agent it fenced the PREVIOUS
// commit, so a stage-1 turn could not legally finish: the gate rejected files no turn had touched.
const baseRef = argAt('--base') ?? 'HEAD';

/**
 * The repo-relative paths named by one `git status --porcelain` line.
 *
 * The first two characters are the status code and the third is a space, so the path starts at 3.
 * A rename is written `old -> new` and BOTH sides are returned: a rename out of the fence must be
 * caught by its destination, and a rename within it must not be flagged by accident.
 *
 * git C-quotes a path containing a space or a non-ASCII character (`?? "a b/file.cs"`), and the
 * quoted form is passed through UNCHANGED — `outsideFence` then refuses it, because it no longer
 * starts with the project prefix. That is deliberate: this fence fails closed on anything it cannot
 * understand, and unquoting by hand would silently mistranslate an escape.
 */
function statusPaths(line) {
  return line
    .slice(3)
    .split(' -> ')
    .map((path) => path.trim())
    .filter(Boolean);
}

// `gitTry` for both, and both fail CLOSED. `git()` returns '' for a failure as well as for an empty
// result, so an unresolvable base — a root commit, a shallow clone, a recorded SHA lost to a rebase —
// would have been reported as "the turn changed nothing", a confidently wrong diagnosis of a turn that
// may have produced a perfect scenario. A read that fails must never be allowed to SHRINK this set.
//
// `--untracked-files=normal` is not decoration. Measured six times in this repository: under
// `status.showUntrackedFiles=no` — a setting a corporate global template can carry — the bare form
// returns EMPTY for a tree holding untracked files. And `git diff` cannot see an untracked file at
// all, which is the whole reason the union needs the status read in the first place.
//
// The DIFF half is repo-wide; the STATUS half is scoped to `framework/`, and the asymmetry is the
// point. A committed change anywhere is unambiguously this turn's, because the base is the SHA
// recorded before the turn began. An UNCOMMITTED change is not: the runner itself writes
// `loop/trackers/<stage>.md` at the end of every iteration and never commits it — ralph.mjs contains
// no `git commit` at all — and `--allow-dirty` exists precisely to let the operator keep unrelated
// edits outside `framework/`. Measured with the status half left repo-wide: iteration 2 of a normal
// run failed with "a stage-1 turn must not touch loop/trackers/tests.md", a file no agent had
// touched, and one operator edit under `--allow-dirty` failed every turn after it.
//
// `framework/` is the runner's own `WATCHED` scope, chosen there for the same reason: it is where a
// turn's work lives and the one place the loop can attribute an uncommitted change to a turn. Inside
// it this fence is total — `Support/`, the `.sln`, a sibling project all fail — and outside it the
// diff half takes over the moment anything is committed.
const diffNames = gitTry(ROOT, 'diff', '--name-only', baseRef, 'HEAD');
const statusNames = gitTry(
  ROOT, 'status', '--porcelain', '--untracked-files=normal', '--', 'framework'
);

const changed = [
  ...new Set([
    ...diffNames.out.split('\n').map((line) => line.trim()).filter(Boolean),
    ...statusNames.out.split('\n').filter((line) => line.trim()).flatMap(statusPaths),
  ]),
];

if (!diffNames.ok) {
  v.fail(`cannot read the diff ${baseRef}..HEAD — ${diffNames.error.split('\n')[0]}`);
}
if (!statusNames.ok) {
  v.fail(`cannot read the working tree status — ${statusNames.error.split('\n')[0]}`);
}

// Still fenced on whatever WAS readable, so a half-failed read reports the strays it can see rather
// than only the read failure. The v.fail above already guarantees the gate is red either way.
if (changed.length > 0) {
  const strays = outsideFence(changed);
  v.check(
    strays.length === 0,
    `diff fence: ${changed.length} file(s), all inside Features/, StepDefinitions/, Data/`,
    `diff fence: a stage-1 turn must not touch ${strays.join(', ')} — ` +
      'a genuine framework change is escalated as `blocked` with a question, not made silently'
  );
} else if (diffNames.ok && statusNames.ok) {
  v.fail(`the turn changed nothing since ${baseRef} — no scenario was produced`);
}

// ── 2. Feature file: the tag, the title, and no Scenario Outline ───────────────────
const featurePath = join(ROOT, featurePathOf(flowGroup));

if (!existsSync(featurePath)) {
  v.fail(`${rel(featurePath)}: missing — stage 0 was supposed to create the skeleton`);
} else {
  const feature = readFileSync(featurePath, 'utf8');
  const tags = scenarioTags(feature);
  const titles = scenarioTitles(feature);

  // Checked FIRST, because it invalidates every check below it. With a `# language:` header naming
  // another dialect, `Структура сценарію:` is a valid Scenario Outline that `scenarioOutlines` cannot
  // see, so §10.8 would go quietly unenforced. Stage 0 writes these headers in English, so a language
  // header appearing at all is itself the anomaly.
  const foreign = foreignLanguageHeader(feature);
  v.check(
    foreign.length === 0,
    `${flowSlug}.feature: English Gherkin`,
    `${flowSlug}.feature: line ${foreign[0]?.line} declares ${foreign[0]?.match} — these checks read ` +
      'only English Gherkin, and a dialect would leave the Scenario Outline rule unenforced'
  );

  // A tag one character wrong yields NO tag at all, and the check below would then report the AC as
  // uncovered — sending the agent to look for a missing tag rather than at the typo in the one it
  // wrote.
  const malformed = malformedAcTags(feature);
  v.check(
    malformed.length === 0,
    `${flowSlug}.feature: every AC tag is well formed`,
    `${flowSlug}.feature: ${malformed.map((hit) => `line ${hit.line} ${hit.match}`).join(', ')} — ` +
      'not a valid AC id; the expected shape is @AC-Fxx-yy'
  );

  // §10.1 again, on the side that had no coverage at all. A feature file writes routes unquoted, so
  // the C# check cannot see them, and it is the likeliest place for a generated scenario to pin a
  // seeded id. A route in a feature file is doubly wrong: the prompt forbids paths there entirely.
  const featureIds = literalIdsInFeature(feature);
  v.check(
    featureIds.length === 0,
    `${flowSlug}.feature: no literal record ids`,
    `${flowSlug}.feature: ${featureIds.map((hit) => `line ${hit.line} (${hit.match})`).join(', ')} — ` +
      'every id comes from an API response, and a feature file must not name a route at all'
  );

  v.check(
    tags.includes(targetAc),
    `${flowSlug}.feature: carries the @${targetAc} tag`,
    `${flowSlug}.feature: no @${targetAc} tag — the tag is the entire traceability mechanism`
  );

  v.check(
    tags.length === new Set(tags).size,
    `${flowSlug}.feature: every AC tag is unique`,
    `${flowSlug}.feature: duplicate AC tag(s) — one AC must map to exactly one scenario`
  );

  const outlines = scenarioOutlines(feature);
  v.check(
    outlines.length === 0,
    `${flowSlug}.feature: no Scenario Outline`,
    `${flowSlug}.feature: ${outlines.map((h) => `line ${h.line}`).join(', ')} use Scenario Outline / ` +
      'Examples — §10.8 forbids it, a skipped case would be invisible in the trace'
  );

  // The flow's Test plan table already holds the exact expected name of every test.
  const flowDoc = join(ROOT, flowDocPath(flowGroup));
  const flowText = existsSync(flowDoc) ? readFileSync(flowDoc, 'utf8') : '';
  const planned = new RegExp(String.raw`\`${targetAc}:\s*([^\`]+)\``).exec(flowText)?.[1]?.trim();
  const actual = titles.find((title) => title.startsWith(targetAc));

  if (!actual) {
    v.fail(`${flowSlug}.feature: no scenario whose title starts with "${targetAc}"`);
  } else if (planned) {
    // Titles are compared on content words: the plan writes "AC-F02-01: text", the scenario
    // writes "AC-F02-01 text", and a colon must not fail the gate.
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    v.check(
      norm(actual) === norm(`${targetAc} ${planned}`),
      `${flowSlug}.feature: scenario title matches the Test plan table`,
      `${flowSlug}.feature: scenario title diverges from the Test plan table\n` +
        `      plan:     ${targetAc} ${planned}\n` +
        `      scenario: ${actual}`
    );
  } else {
    v.pass(`${flowSlug}.feature: scenario "${actual}" present (no Test plan row found to compare)`);
  }
}

// ── 3. Data file: a block under exactly this AC id ─────────────────────────────────
const dataPath = join(ROOT, dataPathOf(flowGroup));

if (!existsSync(dataPath)) {
  v.fail(`${rel(dataPath)}: missing — the scenario's data must live in JSON, not in the steps`);
} else {
  const dataText = readFileSync(dataPath, 'utf8');

  // `Data/` is inside the stage-1 fence and rubric item 15 pushes ALL of a scenario's data into it,
  // which makes it the one writable surface in the fence no literal-id check used to touch: section 4
  // reads only `StepDefinitions/**.cs` and section 2 only the feature file. Measured green before
  // this line existed: `{"AC-F01-01": {"path": "/owners/1"}}`.
  //
  // Read from the TEXT, not from the parsed object, so a file that fails to parse is still scanned and
  // so hit line numbers are the ones the agent will see in its editor.
  const dataIds = literalIdsInData(dataText);
  v.check(
    dataIds.length === 0,
    `${flowSlug}.json: no literal record ids`,
    `${flowSlug}.json: ${dataIds.map((h) => `line ${h.line} (${h.match})`).join(', ')} — ` +
      '§10.1 applies to the data file too; every id comes from an API response at run time'
  );

  // `parsed`, not the truthiness of `data`. A file containing `null` — or `0`, `false`, `""` — parses
  // fine and is falsy, so the old `if (data)` emitted NEITHER a pass nor a fail and section 3 vanished
  // from the report entirely. Measured: `13 check(s)` instead of 14, exit 0, no mention of the data
  // file anywhere. A check that can silently not run is the one outcome this design refuses.
  let data;
  let parsed = false;
  try {
    data = JSON.parse(dataText);
    parsed = true;
  } catch (error) {
    v.fail(`${rel(dataPath)}: invalid JSON — ${error.message}`);
  }

  if (parsed) {
    // `hasOwnProperty.call(null, …)` throws, so the shape is established before it is asked about a
    // key — a gate that crashes cannot tell the loop "the check failed" from "the checker broke".
    const keyed = data !== null && typeof data === 'object' && !Array.isArray(data);
    v.check(
      keyed && Object.prototype.hasOwnProperty.call(data, targetAc),
      `${flowSlug}.json: has a block for ${targetAc}`,
      keyed
        ? `${flowSlug}.json: no "${targetAc}" key — the provider resolves data by the scenario tag`
        : `${flowSlug}.json: the top level is ${Array.isArray(data) ? 'an array' : JSON.stringify(data)}, ` +
          'not an object keyed by AC id — the provider resolves data by the scenario tag'
    );
  }
}

// ── 4. Step definitions: no waits, no switches, no literal ids ─────────────────────
const stepFiles = filesUnder(join(PROJECT, 'StepDefinitions'), '.cs');
v.check(
  stepFiles.length > 0,
  `step definitions: ${stepFiles.length} file(s) found`,
  'step definitions: none found — stage 0 was supposed to create four files'
);

for (const file of stepFiles) {
  const source = readFileSync(file, 'utf8');

  const ids = literalIds(source);
  v.check(
    ids.length === 0,
    `${rel(file)}: no literal record ids`,
    `${rel(file)}: literal id(s) at ${ids.map((h) => `line ${h.line} (${h.match})`).join(', ')} — ` +
      '§10.1 calls this a generation defect even when the test passes'
  );

  const forbidden = forbiddenApis(source);
  v.check(
    forbidden.length === 0,
    `${rel(file)}: no waits and no disabled tests`,
    `${rel(file)}: ${forbidden.map((h) => `line ${h.line} (${h.match})`).join(', ')} — ` +
      'a wait makes a flaky test pass, and Ignore/Assert.Pass switches the test off'
  );
}

// ── 5. Near-duplicate step sentences ──────────────────────────────────────────────
const allSteps = stepFiles.flatMap((file) =>
  extractSteps(readFileSync(file, 'utf8')).map((step) => ({ ...step, file: rel(file) }))
);

const reportable = [];
for (let i = 0; i < allSteps.length; i += 1) {
  for (let j = i + 1; j < allSteps.length; j += 1) {
    const score = similarity(allSteps[i].text, allSteps[j].text);
    const reordered = isReordering(allSteps[i].text, allSteps[j].text);

    // A reordering is NEVER hard-failed, however high it scores. `the count of pets exceeds the count
    // of owners` against its reverse measures 0.9167 while being the opposite assertion, and no
    // textual measure fixes that — a longer repeated frame only pushes the score higher. The
    // deterministic gate declines to rule and the judge decides.
    if (score >= 0.9 && !reordered) {
      v.fail(
        `near-duplicate steps (${score.toFixed(2)}): "${allSteps[i].text}" and "${allSteps[j].text}" ` +
          '— reuse the existing sentence instead of rewording it'
      );
    } else if (reordered || score >= 0.65) {
      // 0.65, not 0.70: the canonical reworded near-duplicate measures 0.67, so a 0.70 floor would
      // have kept the very case this band exists for out of the judge's hands.
      reportable.push({ score, a: allSteps[i], b: allSteps[j] });
    }
  }
}
v.pass(`step similarity: ${allSteps.length} step(s) compared, ${reportable.length} in the review band`);

// ── 6. Scenario count matches the tracker ─────────────────────────────────────────
const trackerPath = join(ROOT, 'loop', 'trackers', 'tests.md');
if (existsSync(trackerPath)) {
  const rows = parseRows(readFileSync(trackerPath, 'utf8'));
  const doneCount = rows.filter((row) => row.status === 'done').length;

  // `scenarioTitles`, not `scenarioTags`. Spec §6.4 gives this check exactly one job — "catches a turn
  // that wrote two scenarios or none" — and counting AC TAGS does not do it. Measured green before
  // this line changed: a second `Scenario:` with no tag above it. An untagged extra scenario is the
  // likeliest shape of the defect, because the tag is what the agent is thinking about and the
  // scenario is what it copied. `scenarioTitles` counts real `Scenario:` lines, excludes Gherkin
  // comments, and does not match `Scenario Outline:` — which §10.8 forbids and section 2 already fails.
  const scenarioCount = filesUnder(join(PROJECT, 'Features'), '.feature')
    .flatMap((file) => scenarioTitles(readFileSync(file, 'utf8'))).length;

  v.check(
    scenarioCount === doneCount + 1,
    `scenario count: ${scenarioCount} = ${doneCount} done + 1 in flight`,
    `scenario count: ${scenarioCount} scenarios against ${doneCount} done rows — ` +
      'a turn writes exactly one scenario, so this turn wrote ' +
      `${scenarioCount - doneCount} of them`
  );
}

// ── 7. Machine report for the judge ───────────────────────────────────────────────
const reportPath = argAt('--report');
if (reportPath) {
  // `gitTry` again, and here the consequence is a fail-OPEN rather than a wrong diagnosis. `git()`
  // returns '' on failure, `excludings('')` is empty, and the report would then tell the judge
  // `_None._` — which reads as "there are no Excluding calls", not as "nobody looked". Rubric item 5
  // requires the judge to justify every one of them against the AC text, so an empty report silently
  // retires that check. This is the one artefact whose entire purpose is to inform a human-grade
  // decision, and it must never quietly say nothing when it means unknown.
  //
  // The SAME base as the fence, and for the same reason. Fixed at `HEAD~1` this told exactly the lie
  // the paragraph above forbids by name: on a two-commit turn the range covered only the last commit,
  // so an `Excluding` added in the first was reported as `_None._` — "nobody looked" rendered as
  // "there are none". `baseRef..HEAD` is also the range ralph.mjs hands the judge as the diff, so the
  // inventory and the diff it annotates now describe the same commits.
  const diff = gitTry(ROOT, 'diff', baseRef, 'HEAD');
  const diffExcludings = diff.ok ? excludings(diff.out) : null;

  if (!diff.ok) {
    v.fail(
      `cannot read the diff for the judge report — ${diff.error.split('\n')[0]}; ` +
        'the report would have claimed there are no Excluding calls when in fact none were looked for'
    );
  }

  const lines = [
    `# Machine report for ${targetAc}`,
    '',
    '> Produced by `scripts/check-tests.mjs`. These are **inputs**, not verdicts.',
    '',
    '## `Excluding` calls in this diff',
    '',
  ];

  if (diffExcludings === null) {
    lines.push('**Unknown — the diff could not be read. This is not the same as none.**', '');
  } else if (diffExcludings.length === 0) {
    lines.push('_None._', '');
  } else {
    lines.push('Rubric item 5: every one must be justified by the AC text.', '');
    for (const hit of diffExcludings) lines.push(`- \`${hit.match}\``);
    lines.push('');
  }

  lines.push('## Step sentences the gate declined to fail on its own', '');
  lines.push('Pairs scoring 0.65–0.90, plus any pair that is the same words reordered, at any');
  lines.push('score — a reordering is never hard-failed, because no textual measure separates a');
  lines.push('reversed relationship from a rewording. Rubric item 23 is where they get ruled on.');
  lines.push('');
  if (reportable.length === 0) {
    lines.push('_None._', '');
  } else {
    lines.push('Rubric item 23: confirm each new step is genuinely new.', '');
    for (const pair of reportable) {
      lines.push(`- ${pair.score.toFixed(2)} — \`${pair.a.text}\` (${pair.a.file})`);
      lines.push(`  vs \`${pair.b.text}\` (${pair.b.file})`);
    }
    lines.push('');
  }

  mkdirSync(dirname(join(ROOT, reportPath)), { recursive: true });
  writeFileSync(join(ROOT, reportPath), lines.join('\n'));
  console.log(`check:tests: wrote ${reportPath}`);
}

v.report({ quiet: process.argv.includes('--quiet') });
