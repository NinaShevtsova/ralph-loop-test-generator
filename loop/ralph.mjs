// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// This is the loop itself — the program you start when you want tests generated.
//
// It looks at the to-do list, picks the first unfinished row, and asks an AI worker to do
// that one row. Then it checks the result for itself: it rebuilds the project, resets the
// test database, runs every test, and runs the automatic file checks. Only if all of that
// is green does it call a SECOND AI, the grader, and show it the work.
//
// If the grader says PASS, the loop marks the row finished and moves to the next one. If
// not, the row goes back into the queue with the grader's reasons attached, and the next
// turn starts from those. The loop stops by itself when every row is finished, or when it
// has spent too many turns, failed too often, or stopped making progress.
//
// The important idea: the worker gets a FRESH, EMPTY memory every turn. Everything that
// has to survive lives on disk — git history, the to-do list, the notes file. So a turn
// never "remembers" the last one; it reads it.
// ══════════════════════════════════════════════════════════════════════════════════════

// ralph.mjs — the blind loop over one stage of this repository.
//
// The cycle is deliberately dumb: it feeds ONE prompt to an agent in headless mode over and over
// (a fresh context each time) until every tracker row of the target stage is `done`. Everything
// that must survive a turn lives on disk — git, the tracker, loop/JOURNAL.md. That is why the
// context does not rot on long runs: an iteration does not remember the previous one, it READS it.
//
// RUN (from the repository root, on your own branch):
//
//   git checkout -b feat/api-tests
//   npm run ralph -- --dry-run                          smoke check, 0 tokens
//   npm run ralph -- --stage scaffold                    ~8 iterations
//   npm run ralph -- --stage tests --flow F-01           ~5 iterations, then look at the result
//
// THREE HARD STOPS. The loop never spins forever:
//   1. Iteration ceiling   MAX_ITER          no more than N turns
//   2. K failures running  K_FAILURES=3      gate red K times in a row -> stop
//   3. No progress         NO_IMPROVEMENT=3  metric flat for N iterations -> plateau
//
// There is no budget stop, and that is a decision: the cost of a turn arrives AFTER it is spent,
// so a budget would be a surprise rather than a ceiling. MAX_ITER is the ceiling; the provider
// sets the financial limit.
//
// EXIT CODES
//   0  every row of the target stage is `done` (or --dry-run finished)
//   1  a hard stop fired
//   2  broken configuration, or the loop's own state could not be read or written
//   3  nothing to do
//   4  everything remaining is `blocked` — questions printed

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { repoRoot, run, git, gitTry } from '../scripts/lib.mjs';
import { parseArgs, stageConfig, FLOW_GROUPS, flowDocPath, featurePath } from './config.mjs';
import {
  parseRows,
  countByStatus,
  pickTarget,
  setStatus,
  firstDone,
  validateTable,
  forbiddenStatusWrites,
} from './tracker.mjs';
import { gateSteps, preGateSteps, runGate } from './gates.mjs';
import { targetSection, judgePrompt, runAgent, runJudge } from './invoke.mjs';
import {
  parseJudgeReply,
  addUsage,
  summaryHeader,
  summaryRow,
  summaryTotals,
  summaryPath,
} from './telemetry.mjs';
import {
  parseVerdict,
  findings as verdictFindings,
  isWellFormed,
  isRunnerNote,
  RUNNER_NOTE,
} from './verdict.mjs';

const ROOT = repoRoot(import.meta.url);
const args = parseArgs(process.argv.slice(2));

/** Broken configuration. Not "let us try anyway" — a stop before the first token. */
const die = (message) => {
  console.error(`ralph: ${message}`);
  process.exit(2);
};

const abs = (relativePath) => join(ROOT, relativePath);
const readFile = (relativePath) => readFileSync(abs(relativePath), 'utf8');

/**
 * A row's verdict file: the judge's reply, or the runner's own note when the turn never reached it.
 *
 * Named in one place because three things now depend on it — the next turn's prompt reads it, the
 * blocked stop points the operator at it, and the failure branch writes it.
 */
const verdictPath = (id) => abs(`loop/verdicts/${id}.md`);

// `git()` returns '' when the command fails, so without this guard a broken repository would read
// as "branch '' , tree clean" and the loop would happily start on it. Checked once, here, so the
// two callers below can stay one-liners.
const repoProbe = gitTry(ROOT, 'rev-parse', '--git-dir');
if (!repoProbe.ok) die(`${ROOT} is not a git repository — ${repoProbe.error.split('\n')[0]}`);

/**
 * The current branch, or a stop.
 *
 * `gitTry`, not the fail-open `git()`. The probe above proves this is a repository, and it succeeds
 * on an UNBORN HEAD — measured, `rev-parse --git-dir` exits 0 while `rev-parse --abbrev-ref HEAD`
 * exits 128 in the same tree. `git()` turns that 128 into `''`, and `''` is the one value that
 * satisfies the `main`/`master` refusal below: the loop would start on a repository with no commits,
 * where `HEAD~1` cannot resolve and every diff the judge is shown is a git error.
 */
const branch = () => {
  const probe = gitTry(ROOT, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (!probe.ok) {
    // The `fatal:` line, not the first line. `run()` merges stdout into the error text, and on an
    // unborn HEAD this command prints the literal word `HEAD` to STDOUT before failing — so
    // `.split('\n')[0]` reported `cannot read the current branch — HEAD`, which says nothing at all.
    const lines = probe.error.split('\n');
    const reason = lines.find((line) => /^(fatal|error):/i.test(line.trim())) ?? lines[0];
    die(
      `cannot read the current branch — ${reason}\n` +
        '      a repository with no commits yet has no branch to be on; make one commit first'
    );
  }
  return probe.out;
};

/**
 * Why this HEAD cannot be worked on, or `null`.
 *
 * `HEAD` is not a branch name — it is git's answer to "you are in detached HEAD", and until this
 * function existed nothing refused it. Measured: on a detached HEAD the dry run printed
 * `branch: HEAD` and `start: ready`. A turn's commits would land on no branch at all, and the next
 * `git checkout` throws the whole run away with a message about dangling commits.
 */
const refuseHead = (name) => {
  if (name === 'HEAD') {
    return 'HEAD is detached — a turn\'s commits would belong to no branch. Create one: git checkout -b feat/api-tests';
  }
  if (['main', 'master'].includes(name)) {
    return `HEAD is on ${name} — create a branch: git checkout -b feat/api-tests`;
  }
  return null;
};

// `--untracked-files=normal`, spelled out. Measured: under `status.showUntrackedFiles=no` — an
// ordinary setting, and one a corporate global git template can carry — a bare `status --porcelain`
// returns EMPTY for a tree holding untracked files, so the check that exists to refuse a dirty tree
// would let the loop start on one. This is the rule for every `status --porcelain` in this repository:
// if the answer matters, say what you mean rather than inherit it from the operator's config.
const treeIsDirty = () => git(ROOT, 'status', '--porcelain', '--untracked-files=normal').length > 0;

// ── Configuration, resolved before anything else ────────────────────────────────────

if (!args.stage) {
  die('no stage given — pass --stage scaffold or --stage tests');
}

let config;
try {
  config = stageConfig(args.stage, process.env);
} catch (error) {
  die(error.message);
}

// Checked on the FLAG, not on its value. `--flow` as the last argument, or `--flow ""`, yields a
// falsy value, which skips the validation below and then reads as "no filter" — so the loop would
// quietly run all 20 acceptance criteria where the operator asked for four. Slices exist to keep the
// spend a series of small decisions, and silently widening one is the opposite of that.
if (process.argv.includes('--flow') && !args.flow) {
  die('--flow was given with no value — pass a flow group such as F-01, or omit the flag entirely');
}

if (args.flow && args.stage !== 'tests') {
  die('--flow only applies to --stage tests; the scaffold tracker runs in wave order');
}
if (args.flow && !FLOW_GROUPS[args.flow]) {
  die(`unknown flow "${args.flow}" — use one of ${Object.keys(FLOW_GROUPS).join(', ')}`);
}

for (const required of [config.tracker, config.prompt, config.rubric]) {
  if (!existsSync(abs(required))) die(`missing ${required} — the loop has nothing to feed the agent`);
}

// acceptEdits lets the agent edit files and does NOT allow Bash. In headless mode there is nobody
// to confirm, so it would run neither a test nor `git commit` — the whole turn is impossible there,
// and an iteration costs real money. Catch it before the first token.
if (config.agentCmd.includes('acceptEdits')) {
  die('AGENT_CMD uses acceptEdits — the agent would edit files but run neither tests nor `git commit`. Use auto.');
}

/**
 * The tracker, validated on every read.
 *
 * Validated every time, not once at startup: the AGENT writes into this file mid-run, and a status
 * cell it mangles makes the whole row invisible to the parser. Measured — one backticked `review`
 * turned 20 rows into 19, and the runner then announced that every row was done and exited 0 with
 * one acceptance criterion never generated. There is nothing to notice unless something looks.
 */
const tracker = () => {
  const markdown = readFile(config.tracker);
  const verdict = validateTable(markdown);
  if (!verdict.ok) {
    console.error(`ralph: ${config.tracker} is not trustworthy:\n`);
    for (const problem of verdict.problems) console.error(`  - ${problem}`);
    console.error('\nralph: fix the tracker by hand — the loop will not guess what it meant.');
    process.exit(2);
  }
  return markdown;
};

const counts = () => countByStatus(tracker(), args.flow);

/**
 * What the operator is shown when the loop stops on a blocked row.
 *
 * The verdict file is NAMED, and that is the fix for a measured lie. `SPEC_UNCLEAR` set the row to
 * `blocked` and recorded the judge's question nowhere the operator would look: the stop printed the
 * tracker's Open questions section, which still said `_None._`, so the run ended by asking a human to
 * answer a question it did not show them. `recordQuestion` below now writes a line into that section
 * as `loop/trackers/*.md` has always claimed the runner does — this names where the full text is.
 */
const reportBlocked = (id) => {
  console.error(`\nralph: ${id} is blocked — a human must answer before the loop can continue`);
  const questions = tracker().split('## Open questions')[1]?.trim();
  if (questions) console.error(`\n${questions}`);
  console.error(
    `\nralph: the full text of the judge's reply for ${id} is in ${verdictPath(id)}.\n` +
      '      Answer in the tracker, set the row back to `rework`, and run again.'
  );
};

// ── Dry run: zero tokens ────────────────────────────────────────────────────────────
//
// It exists so the configuration can be verified without spending anything, and so a gate that
// runs the runner does not need a hard-coded stage.

if (args.dryRun) {
  const target = pickTarget(tracker(), args.flow);
  const c = counts();
  const dryRunRefusal = refuseHead(branch());
  const ready = dryRunRefusal
    ? `not ready — ${dryRunRefusal}`
    : treeIsDirty() && !args.allowDirty
      ? 'not ready — commit or stash your changes'
      : 'ready';

  console.log(`  stage:     ${config.stage}`);
  console.log(`  agent:     ${config.agentCmd}`);
  console.log(`  judge:     ${config.judgeCmd}`);
  console.log(`  prompt:    ${config.prompt}`);
  console.log(`  tracker:   ${config.tracker}`);
  console.log(`  rubric:    ${config.rubric}`);
  console.log(`  slice:     ${args.flow ?? 'whole stage'}`);
  console.log(
    `  rows:      ${c.done} done · ${c.review} review · ${c.rework} rework · ${c.blocked} blocked · ${c.todo} todo`
  );
  console.log(`  next:      ${target ? `${target.row.id} (${target.phase})` : 'nothing — all rows done'}`);
  console.log(`  exemplar:  ${firstDone(tracker())?.id ?? 'none accepted yet'}`);
  console.log(`  branch:    ${branch()} · tree ${treeIsDirty() ? 'dirty' : 'clean'}`);
  console.log(`  start:     ${ready}`);
  console.log(
    `  stops:     MAX_ITER=${config.maxIter} · K_FAILURES=${config.kFailures} · NO_IMPROVEMENT=${config.noImprovement}`
  );
  console.log('  Zero tokens spent. Drop --dry-run to run for real.');
  process.exit(0);
}

// ── Preflight for a real run ────────────────────────────────────────────────────────

// The branch is created by a HUMAN. This script never writes to git — it only refuses to work on
// the default branch, and on no branch at all.
const headRefusal = refuseHead(branch());
if (headRefusal) die(headRefusal);

// Checked only here. In a dry run a dirty tree bothers nobody, and a verification gate runs the dry
// one — otherwise the gate would go red on any unsaved edit.
if (!args.allowDirty && treeIsDirty()) {
  die('working tree is dirty — commit, stash, or pass --allow-dirty');
}

const initial = pickTarget(tracker(), args.flow);
if (!initial) {
  console.log(`ralph: every row of stage ${config.stage}${args.flow ? ` in ${args.flow}` : ''} is done`);
  process.exit(0);
}
if (initial.phase === 'blocked') {
  reportBlocked(initial.row.id);
  process.exit(4);
}
if (counts().todo === 0 && counts().rework === 0 && counts().review === 0) {
  console.log('ralph: no actionable rows left');
  process.exit(3);
}

console.log(
  `ralph: stage ${config.stage}${args.flow ? `, slice ${args.flow}` : ''} — ` +
    `${counts().done} done, ${counts().todo} todo, branch ${branch()}`
);

// ── Helpers that touch disk ─────────────────────────────────────────────────────────

const SOLUTION = abs('framework/ApiTests.sln');
const JOURNAL = abs('loop/JOURNAL.md');

/**
 * Written to a temporary file and renamed into place.
 *
 * The tracker is this loop's durable state, and the repository has already invested in its integrity:
 * `validateTable` on every read, line endings preserved byte for byte. A truncate-then-write was the
 * weak link left. Ctrl-Break, `taskkill`, or a power loss between the truncate and the write leaves a
 * half-written table, and the next read cannot tell a mangled row from a row that was never there —
 * which is the exact failure `validateTable` exists to catch and cannot repair. A rename is one
 * operation, and on Windows Node's `renameSync` replaces the destination.
 */
const writeTracker = (markdown) => {
  const path = abs(config.tracker);
  const temp = `${path}.tmp`;
  try {
    // Both statements inside the try, not just the rename: a `writeFileSync` that throws part-way
    // leaves the same orphan, and the `.gitignore` rule covers the symptom rather than the cause.
    writeFileSync(temp, markdown);
    renameSync(temp, path);
  } catch (error) {
    // Left behind, it makes the NEXT run refuse to start with "working tree is dirty" — pointing at a
    // file the operator never created and cannot explain.
    rmSync(temp, { force: true });
    // `die`, not a rethrow. A rethrow left Node printing a raw stack trace and exiting 1 — the code the
    // documented table gives to "a hard stop fired", so an unwritable tracker was indistinguishable
    // from a loop that ran out of iterations.
    die(`cannot write ${config.tracker} — ${error.message}`);
  }
};

const setRow = (id, status) => writeTracker(setStatus(tracker(), id, status));

/**
 * The failure text for a turn that wrote a tracker row it had no right to write.
 *
 * The row and the transition are NAMED, one line each. "The tracker changed" sends the operator to
 * diff a 200-line file, and this same text is what the next turn's prompt carries as its findings —
 * an agent told only that something moved cannot tell which cell to leave alone.
 */
const describeForbiddenWrites = (writes) =>
  [
    'the turn rewrote tracker rows an agent may not write:',
    ...writes.map(({ id, from, to }) =>
      from === null
        ? `  - ${id}: added by the turn as \`${to}\` — the row list is fixed before the run starts`
        : to === null
          ? `  - ${id}: was \`${from}\` and the turn removed the row from the table`
          : `  - ${id}: \`${from}\` -> \`${to}\` (restored to \`${from}\`)`
    ),
    '',
    'A turn may move the row it was given from `todo` or `rework` to `review` or `blocked`, and must',
    'leave every other row exactly as it found it. `done` is written by the RUNNER on a PASS from an',
    'independent judge — so a row a turn sets to `done` is one the loop then skips for the rest of the',
    'run, with the work never built and nothing else looking.',
  ].join('\n');

/** The code of the exemplar scenario, for the judge. Null until something is accepted. */
function exemplarFor(row) {
  if (config.stage !== 'tests') return null;
  const accepted = firstDone(tracker());
  if (!accepted || accepted.id === row.id) return null;

  const feature = abs(featurePath(accepted.group));
  if (!existsSync(feature)) return null;

  // The scenario block: from its tag line to the next blank-line-separated tag or end of file.
  const text = readFileSync(feature, 'utf8');
  const start = text.indexOf(`@${accepted.id}`);
  if (start === -1) return null;
  const rest = text.slice(start);
  const nextTag = rest.slice(1).search(/\n\s*@AC-F\d{2}-\d{2}\b/);
  const code = nextTag === -1 ? rest : rest.slice(0, nextTag + 1);

  return { id: accepted.id, code: code.trimEnd() };
}

/**
 * Why a row is in `rework`, and who said so. `{ text: '', from: 'judge' }` when there is nothing.
 *
 * `from` exists because the file has two authors. A judge REJECT means the scenario is wrong; a
 * runner note means the turn never reached the judge at all, and the two call for different work.
 * Before the runner wrote anything here, a turn that committed nothing was handed the PREVIOUS
 * judge call's findings under "These are the problems an independent judge found" — measured across
 * three iterations, with the real reason in `console.error` and nowhere else.
 */
function previousFindings(row) {
  const path = verdictPath(row.id);
  if (row.status !== 'rework' || !existsSync(path)) return { text: '', from: 'judge' };
  const raw = readFileSync(path, 'utf8');
  return { text: verdictFindings(raw), from: isRunnerNote(raw) ? 'runner' : 'judge' };
}

/**
 * Records a `blocked` row's question in the tracker's Open questions section.
 *
 * Both trackers have claimed since they were written that this section is "populated at runtime by
 * the agent or by the runner on a `SPEC_UNCLEAR` verdict", and the scaffold one adds that "a question
 * written anywhere else is a question nobody sees". Neither was true: the runner set the row to
 * `blocked` and wrote the question nowhere, so the run ended telling a human to answer a question and
 * then showing them `_None._`.
 *
 * A bullet, never a table row. `tracker.mjs` stops parsing rows at the first non-table line, but its
 * own comment records a four-column line in this very section being read as a phantom row — so
 * anything written here must not be able to look like one.
 *
 * One sentence, as the section asks: the first non-empty line of what the judge said, plus the path
 * to the whole thing. Truncated, because a judge is under no obligation to be brief and a tracker
 * that swallows a page of prose is a tracker nobody reads.
 */
function recordQuestion(id, text) {
  const marker = '## Open questions';
  const markdown = tracker();
  if (!markdown.includes(marker)) return;

  const sentence = (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? 'the judge gave no reason';
  const short = sentence.length > 300 ? `${sentence.slice(0, 300)}…` : sentence;

  const [before, after] = [
    markdown.slice(0, markdown.indexOf(marker)),
    markdown.slice(markdown.indexOf(marker)),
  ];
  // `_None._` is the section's empty marker; leaving it above a real question reads as a contradiction.
  const body = after.replace(/^_None\._\s*$/m, '').trimEnd();

  // The file's own line ending. `writeTracker` exists because this file's integrity is load-bearing,
  // and this repository checks out with CRLF — appending LF would leave the one file the runner
  // validates on every read with two conventions in it.
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const entry =
    `- **${id}** — the judge returned \`SPEC_UNCLEAR\`: ${short}${eol}` +
    `  Full text: \`loop/verdicts/${id}.md\`. Answer here, then set the row to \`rework\`.`;

  writeTracker(`${before}${body}${eol}${eol}${entry}${eol}`);
}

/**
 * `wave-3` -> 3. Undefined for the tests stage, where neither gate builder asks for it.
 *
 * `Number`, not the raw capture: both builders guard the wave with `Number.isInteger`, and a string
 * would fail that guard on every single scaffold iteration.
 */
const waveOf = (row) => {
  const m = /^wave-(\d+)$/.exec(row.group);
  return m ? Number(m[1]) : undefined;
};

/**
 * The gate on the CURRENT HEAD, before the agent is let in. An agent sent onto a broken foundation
 * debugs someone else's problem.
 *
 * `preGateSteps`, not `gateSteps` — see the note there. Skipped in two further cases:
 *
 *   - the solution does not exist yet. On the first iteration of stage 0 there is nothing to build,
 *     and a gate that cannot pass would stop the loop before it started.
 *   - the row is in `rework`. Then the broken state IS the subject of the turn: the judge's findings
 *     are in the prompt and the agent is being sent in precisely to fix what is red. Without this the
 *     loop could not rework anything at all — a red post-turn gate leaves the tree red, the next
 *     iteration would read that same tree as a foundation fault, and the run would die one iteration
 *     after the first red instead of retrying it. `K_FAILURES` would never reach 2.
 */
function preGate(row) {
  if (row.status === 'rework') return { green: true, failedAt: null, log: 'skipped — row is in rework' };
  if (!existsSync(SOLUTION)) return { green: true, failedAt: null, log: 'skipped — no solution yet' };
  return runGate(preGateSteps(config.stage, { wave: waveOf(row) }), { root: ROOT, run });
}

/**
 * What the left-behind probe watches: all of `framework/`, for both stages.
 *
 * An earlier version scoped this to the three directories a stage-1 turn may write to, on the argument
 * that `framework/` also collects files neither the operator nor the agent put there. That argument was
 * about the wrong risk, and the trade is settled by the asymmetry this whole design is built on — a
 * wrong rejection costs one iteration, a wrong acceptance ships a lie and is then copied as approved
 * style.
 *
 * Scoped to the fence, an agent that edits a file OUTSIDE it and does not commit it is invisible twice
 * over: this probe does not look there, and `check-tests.mjs`'s diff fence inspects only the commit. Yet
 * `dotnet test` compiles that file from the WORKING TREE, so it can be the reason a scenario is green.
 * Measured, and it is not one file — the scaffold manifest puts compiled C# in eight directories the
 * fence does not cover: `Config/`, `Hooks/`, `Http/`, `Models/`, `Services/`, `Support/`, `TestData/`,
 * `Tests/`. Green gate, judge shown a diff without the change, row `done`, change still uncommitted.
 *
 * Watching everything risks the opposite: a false failure from some future artifact `.gitignore` does
 * not cover. That failure is self-diagnosing — the message lists the file, and the fix is one ignore
 * line. There is no known source of it today: `bin/`, `obj/` and `TestResults/` are ignored, `dotnet
 * test` writes no TRX without `--logger` and the gate passes none, `sut reset` touches nothing here, and
 * the two escapees that land outside `bin/obj` are now ignored by name — `packages.lock.json`, which
 * appears beside the csproj when a machine-level `Directory.Build.props` sets
 * `RestorePackagesWithLockFile`, and `*.feature.cs`, which Reqnroll emits beside the feature files
 * rather than into `obj/` under one configuration.
 *
 * A diagnosable stop, against a silent accept. Take the stop.
 */
const WATCHED = ['framework'];

/**
 * Uncommitted work in the probe's scope is REPORTED, not refused.
 *
 * It was a refusal, and one real iteration proved that wrong. A turn hit a red gate; the prompt
 * forbids committing on a red gate, so it left its work on disk — correct on every count — and the
 * loop then could not resume: exit 2, "these are uncommitted". Obeying the protocol made the loop
 * unresumable, and the only way out was a human committing the agent's work for it.
 *
 * The refusal was redundant as well as harmful. Its purpose was that a dirty file here could mask a
 * turn's work, because a porcelain line is byte-identical whether a file holds the operator's edit
 * alone or their edit PLUS the agent's — measured, ` M …/F.feature` in both cases. But the POST-turn
 * probe does not compare, it requires the scope CLEAN: anything still uncommitted when the turn ends
 * fails it, whoever wrote it. Masking is impossible either way, so the strictness bought nothing and
 * cost the ability to recover from an honest refusal.
 *
 * Saying it out loud still matters. The turn is told what it inherited and that committing it is its
 * job, rather than finding files it did not write and having to guess.
 */
const dirtyWatched = gitTry(ROOT, 'status', '--porcelain', '--untracked-files=normal', '--', ...WATCHED);
if (!dirtyWatched.ok) die(`cannot read the working tree — ${dirtyWatched.error.split('\n')[0]}`);
if (dirtyWatched.out !== '') {
  console.error(
    `ralph: uncommitted in ${WATCHED.join(', ')} before this run:\n${dirtyWatched.out}\n` +
      'ralph: a turn must commit what it inherits, or it is refused for leaving work behind.'
  );
}

/**
 * The commit a turn started from, kept on disk because a crash must not lose it.
 *
 * A `review` row is one whose agent finished and whose judge never ran, so on resume there is no
 * pre-turn HEAD in memory and `diffBase` fell back to `HEAD~1` — the one-commit assumption this design
 * rejected two rounds earlier for phase `agent`. A turn that made two commits and then died before the
 * judge would have shown the judge only the second. `loop/verdicts/` is gitignored, so this file never
 * appears in a status probe.
 */
const basePath = (id) => abs(`loop/verdicts/${id}.base`);

/**
 * The step inventory as it stood BEFORE the turn, kept beside the base and for the same reason.
 *
 * The gate regenerates `loop/STEPS.md` as its LAST step — after the turn — so the file the judge was
 * handed contained the turn's own brand-new steps, listed as pre-existing with a non-zero use count.
 * Measured: a turn that added `the owner details show the submitted values` was judged against an
 * inventory containing exactly that sentence. The rubric calls that file "every step definition that
 * **already exists**" and item 23 tells the judge to check it for a reworded duplicate — against an
 * inventory that already contains the rewording, the check can never fire. Design §6.3 says step 5
 * regenerates it "for the **next** iteration".
 *
 * On disk rather than only in memory, because a `review` row resumes in a NEW process: the turn ran
 * in an earlier iteration, its in-memory snapshot died with it, and reading the file then gives the
 * same post-turn inventory this exists to avoid.
 */
const stepsPath = (id) => abs(`loop/verdicts/${id}.steps.md`);

const stopRun = (code, reason) => {
  finishSummary(reason);
  console.log(`\n=== STOP: ${reason} (iterations: ${iteration}) ===`);
  process.exit(code);
};

// ── The loop ────────────────────────────────────────────────────────────────────────

let iteration = 0;
let failures = 0;
let best = counts().done;
let stagnant = 0;
let malformedVerdicts = 0;
let journalOpened = false;
let activeChild = null;

// ── Telemetry ───────────────────────────────────────────────────────────────────────
//
// The run summary is the one artefact of a run that is COMMITTED. The journal is the agent's
// self-report and gitignored; the verdicts are bulky and gitignored; the tracker records where the
// run ended but nothing about how it got there. So until this file existed, the answer to "did that
// rubric edit make the loop better or worse" was an opinion — the previous run's rejections had
// already been overwritten by the reworks that fixed them.
//
// Rows are appended AS THEY HAPPEN rather than collected and written at the end. A run that is
// Ctrl-C'd, crashes, or hits a `die()` is exactly the run whose trace is most worth having, and the
// totals block simply does not appear for it.
const runStartedAt = new Date().toISOString();
const runStartedMs = Date.now();
const SUMMARY = abs(summaryPath(runStartedAt, config.stage, args.flow));
let summaryOpened = false;
let summaryFinished = false;
const summaryOutcomes = [];
let judgeUsageTotal = null;

const openSummary = () => {
  if (summaryOpened) return;
  summaryOpened = true;
  mkdirSync(dirname(SUMMARY), { recursive: true });
  appendFileSync(
    SUMMARY,
    summaryHeader({
      startedAt: runStartedAt,
      stage: config.stage,
      flow: args.flow,
      branch: branch(),
      agentCmd: config.agentCmd,
      judgeCmd: config.judgeCmd,
      stops: config,
    })
  );
};

/**
 * One iteration recorded. Never throws: a summary that cannot be written must not be able to end a
 * run that is otherwise healthy — this file informs the next decision, it does not gate this one.
 */
const record = (entry) => {
  try {
    openSummary();
    summaryOutcomes.push(entry.outcome);
    judgeUsageTotal = addUsage(judgeUsageTotal, entry.usage ?? null);
    appendFileSync(SUMMARY, `${summaryRow(entry)}\n`);
  } catch (error) {
    console.error(`ralph: could not write the run summary — ${error.message}`);
  }
};

/** The totals block. Called from every exit that can follow at least one iteration. */
function finishSummary(reason) {
  if (!summaryOpened || summaryFinished) return;
  summaryFinished = true;
  try {
    appendFileSync(
      SUMMARY,
      summaryTotals({
        iterations: iteration,
        rows: summaryOutcomes,
        usage: judgeUsageTotal,
        wallSeconds: (Date.now() - runStartedMs) / 1000,
        reason,
        // Through the validated read, like every other count in this runner. A tracker that has gone
        // unreadable stops the run anyway; it must not do it from inside the summary writer.
        counts: (() => {
          try {
            return counts();
          } catch {
            return null;
          }
        })(),
      })
    );
    console.log(`ralph: run summary in ${summaryPath(runStartedAt, config.stage, args.flow)}`);
  } catch (error) {
    console.error(`ralph: could not finish the run summary — ${error.message}`);
  }
}

/**
 * The run header, written on the first real iteration rather than before the loop.
 *
 * Written eagerly it appeared even for a run that spent nothing — `MAX_ITER=0`, or a stage that turned
 * out to be finished — and a journal of headers with no turns beneath them has to be read twice to
 * learn nothing.
 *
 * Append, never overwrite: a run interrupted with Ctrl-C and resumed must not lose the lessons of
 * earlier turns.
 */
const openJournal = () => {
  if (journalOpened) return;
  journalOpened = true;
  mkdirSync(dirname(JOURNAL), { recursive: true });
  appendFileSync(
    JOURNAL,
    `\n## Run ${new Date().toISOString()} — stage \`${config.stage}\`` +
      `${args.flow ? `, slice \`${args.flow}\`` : ''}, branch \`${branch()}\`\n`
  );
};

/**
 * Ctrl-C must take the child with it.
 *
 * `process.exit` on its own does not. The agent runs with inherited stdio behind a `cmd.exe` wrapper
 * on Windows, so the runner died and the agent carried on editing files — and possibly committing —
 * with nobody watching, while this handler printed that the state was on disk. `taskkill /T` is what
 * reaches through the wrapper to the process actually doing the work.
 */
process.on('SIGINT', () => {
  console.log(`\nInterrupted at iteration ${iteration}.`);
  if (activeChild?.pid) {
    if (process.platform === 'win32') {
      run('taskkill', ['/PID', String(activeChild.pid), '/T', '/F'], { cwd: ROOT });
    } else {
      activeChild.kill('SIGTERM');
    }
    console.log('Stopped the process it was running.');
  }
  // The interrupted run is the one whose trace is most worth keeping, and the rows are already on
  // disk — this only closes them off with what the run managed to spend.
  finishSummary('interrupted (SIGINT)');
  console.log('State is on disk — see git status.');
  process.exit(130);
});

for (;;) {
  const target = pickTarget(tracker(), args.flow);

  if (!target) {
    // Named, because a slice finishing is NOT the stage finishing — and exit 0 is what a wrapper
    // reads as "the whole job is done".
    stopRun(
      0,
      args.flow
        ? `every row of slice ${args.flow} is done — the rest of stage ${config.stage} is untouched`
        : `every row of stage ${config.stage} is done`
    );
  }
  if (target.phase === 'blocked') {
    reportBlocked(target.row.id);
    finishSummary(`blocked on ${target.row.id} — a human must answer`);
    process.exit(4);
  }

  // Stop 1 fires BEFORE the agent is called: MAX_ITER=0 must not leave a single token behind.
  if (iteration >= config.maxIter) {
    stopRun(1, `iteration ceiling (MAX_ITER=${config.maxIter}) reached without finishing the stage`);
  }
  iteration += 1;
  openJournal();

  const { row, phase } = target;
  console.log(`\n--- iteration ${iteration}/${config.maxIter} · ${row.id} · ${phase} ---`);

  // Read before the turn so "did the agent commit anything?" has an answer after it. Stays null for a
  // `review` row, where the commit legitimately happened in an earlier iteration.
  let headBeforeTurn = null;

  // The tracker exactly as the agent found it, for the same reason and with the same null. No agent
  // runs on the recovery path, so there is no window in which the file could have been rewritten.
  let trackerBeforeTurn = null;

  // Wall clock for the turn. The only cost signal there is for the agent — its stdio is inherited so
  // a human can watch it, which rules out `--output-format json` and the usage that comes with it.
  const iterationStartedMs = Date.now();

  // ── The agent turn (skipped when recovering a row left in `review`) ───────────────
  if (phase === 'agent') {
    const pre = preGate(row);
    if (!pre.green) {
      console.error(`ralph: HEAD is already red at "${pre.failedAt}" — not sending the agent in`);
      console.error(pre.log);
      stopRun(1, `the repository was red before the turn (${pre.failedAt})`);
    }

    headBeforeTurn = gitTry(ROOT, 'rev-parse', 'HEAD');
    if (!headBeforeTurn.ok) {
      stopRun(2, `cannot read HEAD before the turn: ${headBeforeTurn.error.split('\n')[0]}`);
    }
    mkdirSync(dirname(basePath(row.id)), { recursive: true });
    writeFileSync(basePath(row.id), headBeforeTurn.out);

    // Regenerate the inventory the prompt calls mandatory reading, so the agent reads today's list.
    //
    // Checked, because the prompt sends the agent to STEPS.md for the steps it should reuse. A silent
    // failure leaves yesterday's list in place, the agent writes a duplicate of a step that already
    // exists, and the run dies at the reuse band a few iterations later with the agent looking like
    // the culprit. The tests gate runs this script again, so the failure would surface eventually;
    // eventually is the problem.
    const inventory = run(process.execPath, ['scripts/steps-inventory.mjs'], { cwd: ROOT });
    if (!inventory.ok) {
      console.error(inventory.out);
      stopRun(2, 'scripts/steps-inventory.mjs failed — the agent would read a stale step inventory');
    }

    // Kept, because this is the last moment the file means what the judge's rubric says it means.
    // See `stepsPath` above.
    if (existsSync(abs('loop/STEPS.md'))) {
      writeFileSync(stepsPath(row.id), readFile('loop/STEPS.md'));
    }

    const previous = previousFindings(row);
    const prompt =
      readFile(config.prompt) +
      targetSection({
        stage: config.stage,
        iteration,
        maxIter: config.maxIter,
        row,
        branch: branch(),
        findings: previous.text,
        findingsFrom: previous.from,
        isExemplarCandidate: config.stage === 'tests' && firstDone(tracker()) === null,
      });

    // Taken as late as possible, and through `tracker()` — the same validated read every other part
    // of the runner uses. Both halves matter. From here until the comparison below the AGENT is the
    // only writer: during a turn the runner touches `loop/verdicts/` and nothing else. And a row the
    // runner itself set to `done` at the end of the previous iteration is already `done` here, so the
    // agent folding that still-uncommitted file into its own commit is not a change — measured, that
    // is exactly what the wave-4 turn did with the runner's `done` for S4.
    trackerBeforeTurn = tracker();

    const { ok, why } = await runAgent(config.agentCmd, prompt, {
      root: ROOT,
      // The SessionStart hook has no other way to know which stage's tracker to read.
      env: { RALPH_STAGE: config.stage, RALPH_TRACKER: config.tracker, RALPH_TARGET: row.id },
      onSpawn: (child) => {
        activeChild = child;
      },
    });
    activeChild = null;

    // An agent that crashed is not a "turn without progress", it is a broken runner. Do not be quiet.
    if (!ok) stopRun(1, `the agent "${config.agentCmd}" did not complete: ${why}`);
  }

  /*
   * Did the turn rewrite a row it had no right to touch?
   *
   * The agent writes its OWN row and the runner writes `done` on a judge PASS. Nothing deterministic
   * looked at the rest of the file: `check-scaffold.mjs` grades a file manifest and has no tracker
   * check at all, the left-behind probe watches only `framework/`, and `validateTable` inspects the table's
   * STRUCTURE rather than the TRUTH of its statuses. So a turn that flipped an unrelated row to `done`
   * passed every gate, and `pickTarget` skips a `done` row — the stage then reports complete with a
   * task never built, which design §6 names as the one outcome this arrangement exists to refuse.
   *
   * Not theoretical: the wave-4 turn folded the runner's uncommitted `done` for S4 into its own commit.
   * That instance was harmless — the diff was exactly the two rows the runner and the agent had each
   * legitimately written — but nothing would have objected had it not been.
   *
   * RESTORED, not merely refused, and that is the half that actually closes the hole. Refusing writes
   * `rework` on the TARGET row; the tampered row keeps whatever the turn gave it, the next iteration's
   * snapshot reads that as its baseline, and the skip happens one iteration later in silence. One
   * logged failure followed by the same silent skip is not a closed hole. The `before` snapshot is the
   * truth by construction, so putting it back cannot itself be wrong; a row that vanished or appeared
   * cannot be repaired this way and is reported alone.
   */
  let tampering = null;
  if (trackerBeforeTurn !== null) {
    const writes = forbiddenStatusWrites(trackerBeforeTurn, tracker(), row.id);
    if (writes.length > 0) {
      tampering = describeForbiddenWrites(writes);
      for (const write of writes) {
        if (write.from !== null && write.to !== null) setRow(write.id, write.from);
      }
    }
  }

  /*
   * The point this turn is measured from — by the gate AND by the judge. One value, one meaning.
   *
   * The pre-turn HEAD, because a turn is not obliged to be one commit: `HEAD~1..HEAD` shows only the
   * last of two, so the judge grades half the work and `check-tests.mjs`'s diff fence sees half the
   * files. Measured on exactly that shape — commit 1 rewriting `Support/ResourceTracker.cs`, commit 2
   * adding the feature file — the fence passed GREEN with the framework rewrite invisible, the judge
   * was called, and the row went `done`. Design §6.4 says that fence is "never delegated to the
   * judge"; delegating it to a base that cannot see the commit is worse, because nobody looks at all.
   *
   * `HEAD~1` remains the base only for a `review` row whose recorded base is gone.
   *
   * COMPUTED here, above the gate, but the diff itself is still READ below the failure block, and
   * that split is load-bearing. An earlier draft read the diff up here too, and its `stopRun(2)` then
   * fired before the gate result was ever used: measured, a run with an unresolvable `HEAD~1` printed
   * only "cannot read the diff for the judge" and no `gate red` line at all, so the operator was told
   * the diff was unreadable when the real condition was a red gate — and the row's status was never
   * written and the failure never counted. Nothing computed here can fail: `existsSync` and a read of
   * a file this runner wrote itself.
   */
  const recordedBase = !headBeforeTurn && existsSync(basePath(row.id))
    ? readFileSync(basePath(row.id), 'utf8').trim()
    : '';
  const diffBase = headBeforeTurn ? headBeforeTurn.out : recordedBase || 'HEAD~1';

  // Said out loud, because the fallback is silently wrong for a multi-commit turn and the file that
  // would have prevented it is gitignored — which is what keeps it out of the probes above and also
  // what makes `git clean -xd` delete it. A routine trigger, not an exotic one.
  if (!headBeforeTurn && !recordedBase) {
    console.error(
      `ralph: no recorded base for ${row.id} (${basePath(row.id)} is absent — \`git clean\` removes it), ` +
        'so the gate fence and the judge both see HEAD~1..HEAD. If that turn made more than one commit ' +
        'they will see only the last.'
    );
  }

  // ── The gate, run by the runner — the agent is not taken at its word ──────────────

  // `acId` and `row` are the same tracker id under two names, and only one is read per stage: stage
  // 1's rows are acceptance criteria, stage 0's are structural tasks that no AC names. The scaffold
  // gate takes the ROW rather than `waveOf(row)` — this turn built one row, and a wave-scoped gate on
  // a wave with several rows demands files from turns nobody has been asked to take. `waveOf` is
  // still what the PRE-turn gate wants; see the note in gates.mjs.
  const gate = runGate(gateSteps(config.stage, { acId: row.id, row: row.id, base: diffBase }), {
    root: ROOT,
    run,
  });

  /*
   * One failure path for both ways a turn can come back ungradeable. The second is not obvious and is
   * the more dangerous of the two.
   *
   * Every check in check-tests.mjs reads the WORKING TREE, so the gate goes green on a scenario the
   * agent wrote and never committed — measured. The judge, though, is shown `git diff HEAD~1 HEAD`.
   * Together that means a row could be marked `done` on a diff holding the previous, already-accepted
   * scenario and nothing of this turn at all: an accepted lie, which design §6 names as the one
   * outcome this whole arrangement exists to refuse.
   */
  let failure = null;
  if (tampering) {
    // FIRST, ahead of the gate. A rewritten row is the more dangerous of the two findings and the one
    // the next turn must be told about by name: a red gate is about the work, and the work can be
    // redone, but a `done` written by an agent removes a row from the loop's future entirely. The gate
    // still ran, so its side effects are unchanged; only its log is not what gets reported.
    failure = tampering;
  } else if (!gate.green) {
    failure = `gate red at "${gate.failedAt}"\n${gate.log}`;
  } else {
    /*
     * Did the turn leave any of its work uncommitted? Asked on EVERY phase, not only after an agent
     * turn — and that is a correction, not a detail. This test used to live inside
     * `else if (headBeforeTurn)`, which is assigned only for phase `agent`, so a `review` row skipped
     * it entirely. A `review` row is one whose agent finished and whose judge never ran: a crash, a
     * Ctrl-C, a stop. The work can be half-committed for exactly that reason, and on resume the gate
     * read the working tree, passed, and the judge was shown the previous, already-accepted turn. The
     * hole this test closed for phase `agent` was still open on the recovery path.
     *
     * `status --porcelain`, not `diff HEAD`. Measured: `diff HEAD` reports a MODIFIED tracked file and
     * is blind to an untracked new one, so a brand-new step-definition file left uncommitted would
     * pass it. Porcelain reports both (` M` and `??`) and still excludes ignored build output.
     *
     * `--untracked-files=normal` is spelled out because that pair is the entire reason porcelain was
     * chosen, and it is NOT porcelain's to guarantee. Measured: with `status.showUntrackedFiles=no` —
     * an ordinary setting, and one a corporate global git template can carry — the bare command
     * returns EMPTY for a repository holding an untracked file. Not degraded: blind.
     *
     * This replaced a test that looked for `row.id` in the committed diff, which was wrong in a way
     * worth keeping: on a first attempt the scenario is ADDED, so the tag is a `+` line and cannot be
     * missed, but on a REWORK the tag is already committed and appears only if git prints it as
     * CONTEXT — and `git diff` prints three lines of it. Measured: a rework confined to a step
     * definition mentions the id nowhere at all, and a rework eight lines below its tag is invisible
     * at `-U3`. Step definitions carry no AC tags because they are shared, so "the assertion is too
     * weak" and "reuse the existing step" are exactly the reworks it would have failed — each one
     * writing `rework`, making no progress, and counting toward stop 2. Three correct turns would have
     * stopped the run and blamed the agent.
     */
    const leftBehind = gitTry(ROOT, 'status', '--porcelain', '--untracked-files=normal', '--', ...WATCHED);
    if (!leftBehind.ok) {
      stopRun(2, `cannot read the working tree after the turn: ${leftBehind.error.split('\n')[0]}`);
    }

    // Only meaningful when there WAS an agent turn this iteration.
    let headUnmoved = false;
    if (headBeforeTurn) {
      const headAfterTurn = gitTry(ROOT, 'rev-parse', 'HEAD');
      if (!headAfterTurn.ok) {
        stopRun(2, `cannot read HEAD after the turn: ${headAfterTurn.error.split('\n')[0]}`);
      }
      headUnmoved = headAfterTurn.out === headBeforeTurn.out;
    }

    /*
     * Does the range the judge is about to be shown contain any WORK?
     *
     * `headUnmoved` measures HEAD movement, which is not the same question, and the difference is a
     * measured accepted lie: a turn that did nothing but flip its own tracker row to `review` and
     * commit that moved HEAD, passed this block, was judged, and went `done`. Stage 0's gate has no
     * diff fence at all, so nothing else was looking.
     *
     * Asked on EVERY phase, including `review`, for the reason the left-behind probe is: on the
     * recovery path the commit happened in an earlier iteration and the recorded base is what makes
     * the range mean anything. A range with no `framework/` file in it is a diff the judge cannot
     * grade — whatever verdict comes back is about the wrong thing.
     *
     * `WATCHED` rather than the stage-1 fence, because this must hold for stage 0 too, where the work
     * legitimately lands in `Config/`, `Http/`, `Models/` and five more.
     */
    const committed = gitTry(ROOT, 'diff', '--name-only', diffBase, 'HEAD');
    if (!committed.ok) {
      stopRun(
        2,
        `cannot read what the turn committed (${diffBase}..HEAD): ${committed.error.split('\n')[0]}` +
          (recordedBase ? ` — the base came from ${basePath(row.id)}; delete it to fall back to HEAD~1` : '')
      );
    }
    const committedWork = committed.out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((path) => WATCHED.some((dir) => path === dir || path.startsWith(`${dir}/`)));

    if (headUnmoved) {
      failure =
        'the gate is green but the agent committed nothing. The checks read the working tree, the ' +
        'judge reads the committed diff — it would be graded on the previous turn.';
    } else if (committedWork.length === 0) {
      failure =
        `the gate is green and something was committed, but nothing under ${WATCHED.join(', ')} in ` +
        `${diffBase}..HEAD:\n` +
        `${committed.out || '(the range is empty)'}\n` +
        'The judge grades that range. A turn whose only commit is its own tracker row, or a file ' +
        'outside the framework, has produced no work to grade.';
    } else if (leftBehind.out !== '') {
      failure =
        `the turn left work uncommitted in ${WATCHED.join(', ')}:\n` +
        `${leftBehind.out}\n` +
        'Every check reads the working tree; the judge reads the commit. What is listed above was ' +
        'graded green and would not have been shown to the judge.';
    }
  }

  if (failure) {
    console.error(`ralph: ${failure}`);
    // Recorded before the row is written, so a `die()` inside `setRow` still leaves the reason on
    // disk. `tampering` and a red gate are separated in the OUTCOME column because they are different
    // faults with different fixes, and a summary that called both "failed" would need the note column
    // read to tell them apart.
    record({
      iteration,
      row: row.id,
      phase,
      outcome: tampering ? 'refused' : 'gate red',
      seconds: (Date.now() - iterationStartedMs) / 1000,
      note: tampering ? failure : `red at ${gate.failedAt}`,
    });
    if (parseRows(tracker()).find((r) => r.id === row.id)?.status !== 'blocked') {
      /*
       * The note design §6.2 Step 3 requires, written where the NEXT turn will actually read it.
       *
       * Before this, the failure text went to `console.error` and nowhere else, and
       * `loop/verdicts/<id>.md` was written only after a judge call. `previousFindings` reads that
       * file for any `rework` row — so a turn that failed the runner's own checks was handed the
       * LAST judge call's findings instead. Measured end to end: judge call #2 returned REJECT, two
       * later turns failed the "committed nothing" check, and the 4th agent prompt carried judge call
       * #2's findings under "These are the problems an independent judge found. Fix **all** of them"
       * with zero mention of the real reason. Three such turns trip `K_FAILURES` and stop the run
       * blaming the agent.
       *
       * Written only on the `rework` path, and that is deliberate: a `blocked` row's verdict file
       * holds the judge's question, which is the one thing the operator is being sent to read.
       */
      mkdirSync(dirname(verdictPath(row.id)), { recursive: true });
      writeFileSync(
        verdictPath(row.id),
        `${RUNNER_NOTE}\n\nIteration ${iteration}, row ${row.id}:\n\n${failure}\n`
      );
      setRow(row.id, 'rework');
    }
    // Stop 2: K failed turns running. A green turn cannot stop the loop, even at K=0 — this test sits
    // inside the failure branch, and a good turn resets the counter below without ever reaching it.
    failures += 1;
    if (failures >= config.kFailures) {
      stopRun(1, `${failures} failed turn(s) in a row (K_FAILURES=${config.kFailures})`);
    }
    await sleep(1000);
    continue; // the judge is NOT called on a failed turn — grading a red test is burnt tokens
  }
  failures = 0;

  // ── The judge — a separate read-only process ──────────────────────────────────────
  //
  // `gitTry`, not `git`, on purpose. `git()` returns '' when the command fails, so if both the
  // before and the after probe failed — a held `index.lock` is enough — both sides would be '',
  // compare equal, and a judge that DID modify the repository would be certified read-only.
  // This guard has to fail CLOSED: an unprovable green is the one thing this design refuses.
  //
  // `--untracked-files=normal` on both probes, for the same reason it is on the left-behind probe and
  // with a sharper consequence. Measured: under `status.showUntrackedFiles=no` a bare
  // `status --porcelain` returns EMPTY for a repository holding an untracked file, so a judge that
  // CREATED a file left both sides equal and was certified read-only. That is precisely the
  // unprovable green the paragraph above says this design refuses, defeated by a git setting a
  // corporate global template can carry.
  const headBefore = gitTry(ROOT, 'rev-parse', 'HEAD');
  const statusBefore = gitTry(ROOT, 'status', '--porcelain', '--untracked-files=normal');
  if (!headBefore.ok || !statusBefore.ok) {
    stopRun(2, `cannot read the git state before the judge call: ${headBefore.error || statusBefore.error}`);
  }

  /*
   * The diff the judge will grade — the same `diffBase` the gate fenced against, read HERE.
   *
   * The base is computed above the gate so one value serves both; the READ stays below the failure
   * block, and that position is load-bearing. An earlier draft read it above, and its `stopRun(2)`
   * then fired on every iteration BEFORE the gate result was used: measured, a run with an
   * unresolvable `HEAD~1` printed only "cannot read the diff for the judge" and no `gate red` line at
   * all, so the operator was told the diff was unreadable when the real condition was a red gate —
   * and the row's status was never written and the failure never counted. `HEAD~1` is the base for a
   * `review`-phase row whose recorded base is gone, so a shallow clone or a root commit was enough.
   *
   * `gitTry`, not `git`: `git()` returns '' when the command fails, so the judge would be handed an
   * empty diff and would grade the empty string. That is the fail-open check-tests.mjs refuses by name
   * one file over, and it must fail closed here for the same reason.
   */
  const judgeDiff = gitTry(ROOT, 'diff', `${diffBase}..HEAD`);
  if (!judgeDiff.ok) {
    // The base is named, because when it is a recorded SHA that no longer resolves — the operator
    // rebased or reset between runs — the fix is to delete one file, and nothing in a bare git error
    // says which.
    stopRun(
      2,
      `cannot read the diff ${diffBase}..HEAD for the judge: ${judgeDiff.error.split('\n')[0]}` +
        (recordedBase ? ` — the base came from ${basePath(row.id)}; delete it to fall back to HEAD~1` : '')
    );
  }

  const reportPath = abs(`loop/verdicts/${row.id}.report.md`);
  const judgeInput = judgePrompt({
    rubric: readFile(config.rubric),
    acText:
      config.stage === 'tests'
        ? readFile(flowDocPath(row.group))
        : `Task \`${row.id}\` of \`${row.group}\`: ${row.title}\n\nSee loop/trackers/scaffold.md for its file list and DoD.`,
    diff: judgeDiff.out,
    report: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '',
    // The PRE-turn snapshot, not `loop/STEPS.md`. The gate regenerates that file as its last step,
    // after the turn, so the live file lists this turn's own new steps as pre-existing — see
    // `stepsPath`. The file on disk is the fallback for a `review` row resumed after `git clean`, and
    // it is the old, wrong answer: better a stale inventory than none, and the run is not stopped for
    // it, but nothing else should ever reach it.
    steps: existsSync(stepsPath(row.id))
      ? readFileSync(stepsPath(row.id), 'utf8')
      : existsSync(abs('loop/STEPS.md'))
        ? readFile('loop/STEPS.md')
        : '',
    exemplar: exemplarFor(row),
  });

  console.log(`ralph: calling the judge (${config.judgeCmd})`);
  const judged = await runJudge(config.judgeCmd, judgeInput, {
    root: ROOT,
    onSpawn: (child) => {
      activeChild = child;
    },
  });
  activeChild = null;

  /*
   * The envelope unwrapped, once, here — and `judgeText` is what every line below reads.
   *
   * `JUDGE_CMD` defaults to `--output-format json` so the call's usage can be recorded, and the
   * verdict is then a FIELD of a JSON object rather than the first line of the output. Handing
   * `parseVerdict` the raw envelope would have it read `{` and resolve to REJECT — every verdict,
   * forever, with the malformed-verdict counter stopping the run on the second one. `parseJudgeReply`
   * returns the text unchanged for any tool that does not speak the envelope, so nothing here depends
   * on which tool JUDGE_CMD names.
   */
  const { text: judgeText, usage: judgeUsage } = parseJudgeReply(judged.out);

  // A judge that changed anything was not read-only, and its verdict cannot be trusted.
  const headAfter = gitTry(ROOT, 'rev-parse', 'HEAD');
  const statusAfter = gitTry(ROOT, 'status', '--porcelain', '--untracked-files=normal');

  // Recorded after both probes have been READ — so this write cannot pollute the comparison, which
  // `loop/verdicts/` being gitignored already prevents — and above all THREE of the stops below.
  // Every case where you most want to read what the judge actually said is a case that ends the run,
  // and two earlier drafts threw its output away in one or another of them: the first in two of the
  // three, the second in the git-probe one, whose own comment miscounted them as two.
  //
  // `|| ...`: when the judge could not be spawned at all, `out` is empty, and a zero-byte file records
  // nothing. The reason belongs in the artefact, not only in the console.
  mkdirSync(dirname(verdictPath(row.id)), { recursive: true });
  const verdictText = judgeText || `<the judge produced no output — ${judged.why}>\n`;
  writeFileSync(verdictPath(row.id), verdictText);

  /*
   * The same text again, under a name no later iteration can take.
   *
   * `loop/verdicts/<id>.md` is what the next turn reads, so it must always hold the LATEST reply —
   * which means the rework that fixes a scenario overwrites the rejection that explained it. Those
   * rejections are the only real material for a judge eval, and this loop was producing and
   * destroying them at the same rate. Gitignored like the rest of `loop/verdicts/`: bulky, and the
   * committed record of what happened is the run summary.
   */
  const history = abs(`loop/verdicts/history/${row.id}.${String(iteration).padStart(3, '0')}.md`);
  try {
    mkdirSync(dirname(history), { recursive: true });
    writeFileSync(history, verdictText);
  } catch (error) {
    // Never fatal. This copy exists to be mined later; a run must not end because an archive write
    // failed while the verdict the loop acts on was written fine one line above.
    console.error(`ralph: could not archive the verdict — ${error.message}`);
  }

  if (!headAfter.ok || !statusAfter.ok) {
    stopRun(2, `cannot verify the judge left the repository untouched: ${headAfter.error || statusAfter.error}`);
  }

  if (headAfter.out !== headBefore.out || statusAfter.out !== statusBefore.out) {
    stopRun(2, 'the judge modified the repository — it must be read-only; check JUDGE_CMD');
  }

  if (!judged.ok) stopRun(1, `the judge "${config.judgeCmd}" did not complete: ${judged.why}`);

  // A judge that exits 0 and prints nothing is a broken judge, and it must stop the run here rather
  // than fall through. Otherwise: `parseVerdict('')` is REJECT, the row becomes `rework`, and the NEXT
  // turn is handed the placeholder written above as its findings — `findings()` returns the whole
  // string when there is no findings section, so the agent reads
  // "<the judge produced no output — exit code 0>" under the heading "These are the problems an
  // independent judge found. Fix all of them." A paid turn, working on a diagnostic message.
  //
  // Reachable in practice: the wrong `--output-format`, or a judge writing to stderr. Measured —
  // `runJudge` returns `{ok: true, out: ''}` for both.
  if (judgeText.trim() === '') {
    stopRun(2, `the judge "${config.judgeCmd}" exited 0 and printed nothing — check JUDGE_CMD and its output format`);
  }

  const verdict = parseVerdict(judgeText);

  // Written before the malformed check below. Otherwise a stop there left the row in `review` while
  // the failed-turn path writes `rework` — two paths disagreeing on what an ungraded row looks like.
  if (verdict === 'PASS') setRow(row.id, 'done');
  else if (verdict === 'SPEC_UNCLEAR') {
    setRow(row.id, 'blocked');
    // The question goes into the tracker, where both trackers have always said the runner puts it and
    // where the operator is about to be sent to look. Without this the run ended by printing
    // "a human must answer" above a section still reading `_None._` — measured.
    recordQuestion(row.id, verdictFindings(judgeText));
  } else setRow(row.id, 'rework');

  console.log(`ralph: verdict ${verdict} for ${row.id}`);

  // The note is the judge's FIRST finding, not all of them: the summary is a file to scan, and the
  // whole reply is one directory away under a name this row's iteration number makes unambiguous.
  record({
    iteration,
    row: row.id,
    phase,
    outcome: 'judged',
    verdict,
    usage: judgeUsage,
    seconds: (Date.now() - iterationStartedMs) / 1000,
    note: verdict === 'PASS' ? '' : verdictFindings(judgeText),
  });

  // A malformed verdict resolves to REJECT, which is right — but it must not LOOK like an honest
  // rejection. A judge that decorates its first line (a code fence, `**bold**`, a preamble) has its
  // real verdict thrown away, and if it does so consistently the loop grinds to its ceiling emitting
  // rework after rework with nothing wrong with the work. The parser stays strict; this says so.
  if (!isWellFormed(judgeText)) {
    malformedVerdicts += 1;
    console.error(
      `ralph: the judge's first line is not a verdict (${malformedVerdicts} in a row) — read as REJECT.\n` +
        `      first line: ${JSON.stringify((judgeText ?? '').split('\n').find((l) => l.trim()) ?? '')}\n` +
        '      it must be plain `VERDICT: PASS|REJECT|SPEC_UNCLEAR` with no fence, bold or preamble.'
    );
    // Two in a row is a broken judge, not two bad scenarios. That is a configuration fault: the
    // prompt or JUDGE_CMD is wrong, and burning iterations on it would teach us nothing. One IS burnt
    // — the first malformed verdict sets `rework`, so the next turn is paid for before this fires.
    // Accepted, because one decorated verdict really can be a one-off, and stopping the run on it
    // would make the strict parser an unrecoverable trap.
    if (malformedVerdicts >= 2) {
      stopRun(
        2,
        `the judge returned a malformed verdict ${malformedVerdicts} times running — see ${verdictPath(row.id)}`
      );
    }
  } else {
    malformedVerdicts = 0;
  }

  // Stop 3: the metric has plateaued. An iteration that made progress cannot stop the loop. Counted
  // once, and scoped to the slice, so the number that stops the run is the number that gets printed.
  const c = counts();
  const improved = c.done > best;
  best = Math.max(best, c.done);
  stagnant = improved ? 0 : stagnant + 1;

  console.log(
    // `review` included, because without it the line does not add up and the operator cannot see
    // where the missing rows went. Measured: a wave that put three rows into `review` printed
    // `5 done · 1 rework · 0 blocked · 6 todo` against a 14-row tracker, and the two rows in `review`
    // were simply absent from the arithmetic.
    `  ${args.flow ?? config.stage}: ${c.done} done · ${c.review} review · ${c.rework} rework · ` +
      `${c.blocked} blocked · ${c.todo} todo`
  );

  if (!improved && stagnant >= config.noImprovement) {
    stopRun(1, `no progress for ${stagnant} iteration(s) (NO_IMPROVEMENT=${config.noImprovement})`);
  }

  await sleep(1000); // so Ctrl-C between turns lands reliably
}
