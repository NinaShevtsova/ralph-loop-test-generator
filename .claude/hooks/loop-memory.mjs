// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// Every turn the AI worker starts with a completely empty memory. This little program runs
// automatically at the start of each one and hands it a short briefing.
//
// The briefing has two halves, and they are kept apart on purpose. First, FACTS the program
// measures for itself right now: which branch, is anything uncommitted, how many rows are
// finished, how many reusable sentences exist. Second, the NOTES the previous turn wrote
// for itself. Notes are the AI's own account and can be wrong, so the briefing ends by
// telling it that if the two disagree, believe the facts.
//
// One more thing it does is stay SILENT for the grader. The grader must form its own
// opinion from the rulebook and the code change; letting the worker's self-written notes
// into its head would quietly undo the independence the whole design rests on.
// ══════════════════════════════════════════════════════════════════════════════════════

// loop-memory.mjs — the memory bridge between iterations (SessionStart event).
//
// The Ralph loop is blind: every iteration is a NEW session with an empty context. Whatever this
// hook prints to stdout, Claude Code adds to that session's context. So the next iteration does not
// start from nothing: it immediately knows where the repository stands and what the previous turn
// tripped over.
//
// The hook pours out TWO sources and deliberately does NOT mix them:
//
//   1. FACTS — it measures them itself, right now (git, the tracker). A recorded fact goes stale
//      with the next commit; a computed one never does. That is why nothing here is cached.
//   2. THE JOURNAL — the agent's self-report. Only the model knows what it tripped over, and no
//      script will ever ask it. The price of a self-report is that it can lie, which is exactly why
//      the facts sit next to it: "the journal says AC-F01-01 is done, the tracker says todo" is
//      visible at a glance.
//
// The hook blocks nothing and grades nothing. It speaks only during a ralph AGENT turn: any other
// session — the judge, an ordinary interactive one — gets silence and exit 0 (see the gates below).
//
// Check it by hand:
//   RALPH_STAGE=tests RALPH_TRACKER=loop/trackers/tests.md \
//     node .claude/hooks/loop-memory.mjs < /dev/null
//
// The env is not decoration: without `RALPH_STAGE` the hook is silent by design. On Windows use Git
// Bash — `printf` and the inline env prefix are not PowerShell syntax. The stdin redirect is not
// decoration either: the drain below waits for EOF, so without it the command never returns.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// NOT `$CLAUDE_PROJECT_DIR`. That variable is expanded by the SHELL in a hook command line, not by
// Claude Code, and on Windows the path turns to mush. The root is computed from this file's own
// location instead: .claude/hooks/ -> ../..
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JOURNAL = join(ROOT, 'loop', 'JOURNAL.md');
const STEPS = join(ROOT, 'loop', 'STEPS.md');

// The tail, not the whole file. The journal grows with every iteration; the context must not.
const TAIL_CHARS = 6000;

// Claude Code sends the hook JSON on stdin. Not consuming it means a hang or an EPIPE.
await new Promise((done) => {
  process.stdin.resume();
  process.stdin.on('data', () => {});
  process.stdin.on('end', done);
  process.stdin.on('error', done);
});

/*
 * Only a ralph AGENT turn gets this, and it takes two gates to say so.
 *
 * Measured: a plain `claude -p` in this repository DOES fire SessionStart. That settles two things at
 * once — the memory bridge works at all, and `runJudge` spawns a session that fires this hook too.
 * `runJudge` passes no `env`, so its child inherits the runner's, and the hook's only previous gate
 * was "does a journal exist". From iteration 2 onward the judge would therefore have opened every
 * session with the AGENT'S OWN SELF-REPORT injected ahead of its rubric, under a heading that says
 * "Read this FIRST" and a closing line that says to trust it.
 *
 * That inverts what the surrounding code is built for. `judgePrompt` composes the judge's input from a
 * fixed list — rubric, AC text, diff, report, steps, exemplar — and the journal is pointedly not on it.
 * The runner gives the judge `--permission-mode plan` and then proves it changed nothing. All of that
 * guards independence at the front door. This was the back one, and the failure is one-directional and
 * invisible: `parseVerdict`, `isWellFormed` and the malformed counter all see a well-formed PASS.
 *
 * The POSITIVE gate: `RALPH_STAGE` is set by `runAgent` for the agent child and by nothing else — not
 * by the runner's own process, not by `runJudge`, not by an interactive session. Measured null in a
 * plain `claude -p`.
 *
 * The NEGATIVE gate: `runJudge` marks itself. Without it the judge is protected only by the accident
 * that the runner does not put `RALPH_STAGE` in its own environment, and one ordinary refactor that
 * does — `process.env.RALPH_STAGE = stage` — would silently reopen this. A wrong acceptance ships a
 * lie and is then copied as approved style; two one-line gates are cheap against that.
 */
if (process.env.RALPH_JUDGE || !process.env.RALPH_STAGE) process.exit(0);

/**
 * Reads a file, or returns `null` and says why. Never throws.
 *
 * The dynamic import below was already wrapped for one stated reason — "a hook that throws fails
 * EVERY session start in this repository, interactive ones included" — but the two `readFileSync`
 * calls around it were not, which left the invariant false. Measured: with `loop/JOURNAL.md`
 * unreadable the bare read exited 1 and printed a raw `EISDIR` stack trace, so every session in
 * this repository would open with a Node traceback from a hook whose whole promise is silence.
 */
const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    process.stderr.write(`loop-memory: cannot read ${path} — ${error.message}\n`);
    return null;
  }
};

// The second silent path: a ralph turn that ran before anything was written down — the first
// iteration of the first run. The gate above already turned away every session that is not an agent
// turn, so this one no longer carries the interactive case on its own; both still write nothing to
// stdout, nothing to stderr, and exit 0.
if (!existsSync(JOURNAL)) process.exit(0);
const journal = readText(JOURNAL)?.trim();
if (!journal) process.exit(0);

// Returns `null` for a failure, never `''`. `''` is a real answer — "clean tree", "no history" —
// and collapsing the two makes a broken git read as a healthy repository, in the one block that
// tells the agent to trust what it says. The same fail-open cost task 21 five separate fixes.
const git = (...args) => {
  const result = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
};

// The tracker is parsed by the module the RUNNER parses it with, not by a regex of the hook's own.
//
// This hook's entire claim is "the facts below were measured just now — trust them over the
// journal". A second parser makes that claim false the moment the two disagree, and they do:
// `tracker.mjs` anchors on the `| ID | Group | Title | Status |` header, so a status-shaped
// four-column row in the prose BELOW the table is not a row. A plain `gm` regex counts it.
// Measured on the real tracker with one such line appended to the Open questions section — the
// regex reported 21 rows and 1 done, `countByStatus` reported 20 rows and 0 done. The hook would
// have told the agent a row was finished that the runner still sees as todo.
//
// Imported dynamically inside a try, because a hook that throws fails EVERY session start in this
// repository, interactive ones included. Advisory output degrades; it never crashes.
// `pathToFileURL`, not the bare path. Measured: `await import('C:\\…\\tracker.mjs')` throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows — and inside a silent catch that failure is invisible,
// so the hook would simply have stopped reporting tracker facts with nothing to say why.
// `STATUSES` comes from that same import rather than being re-declared here. A local copy would be
// one more derivation of something the module already exports: add a status and the hook's report
// silently omits it while every count on the line still adds up, which is the failure mode that
// costs the most to notice.
let countByStatus = null;
let parseRows = null;
let STATUSES = null;
try {
  ({ countByStatus, parseRows, STATUSES } = await import(
    pathToFileURL(join(ROOT, 'loop', 'tracker.mjs')).href
  ));
} catch (error) {
  // Never fatal — a hook that throws fails EVERY session start in this repository, interactive ones
  // included. But never silent either: `trackerFacts` would just go quiet, and a missing fact reads
  // exactly like a fact that is absent.
  process.stderr.write(`loop-memory: tracker facts unavailable — ${error.message}\n`);
}

/**
 * Status counts for the target stage's tracker. Which one it is, the runner says via env.
 *
 * `null` is returned only where silence is the honest answer — no `RALPH_TRACKER` at all, which is
 * every interactive session. Where the tracker was named but could not be read, the block SAYS so.
 * An omitted fact is indistinguishable from an absent one, and the two mean opposite things here:
 * the runner sets `RALPH_TRACKER` precisely when there is a row being worked on.
 */
function trackerFacts(relativePath) {
  if (!relativePath) return null;
  if (!countByStatus) return ['tracker: **unreadable — the parser would not load** (see stderr)'];

  const path = join(ROOT, relativePath);
  if (!existsSync(path)) return null;

  const markdown = readText(path);
  if (markdown === null) return [`tracker \`${relativePath}\`: **unreadable**`];

  const counts = countByStatus(markdown);
  const rows = parseRows(markdown);

  // Zero rows is not "an empty tracker", it is a BROKEN one — `pickTarget` throws on exactly this
  // state and `validateTable` rejects it. Measured on a table whose two status cells had been
  // written as `` `todo` `` and `**todo**`: 0 rows parsed, `validateTable.ok` false. Returning
  // `null` here printed no tracker line at all, and printing the counts would have been worse —
  // `0 todo · 0 review · 0 rework · 0 blocked · 0 done` reads as a finished stage.
  if (rows.length === 0) {
    return [
      `tracker \`${relativePath}\`: **0 rows parsed — the table is malformed, so there are no ` +
        'counts to trust. A status cell must be one bare word: no backticks, no bold, no trailing text.**',
    ];
  }

  const blocked = rows.filter((row) => row.status === 'blocked').map((row) => row.id);

  return [
    `tracker \`${relativePath}\`: ` +
      STATUSES.map((status) => `${counts[status]} ${status}`).join(' · '),
    ...(blocked.length > 0 ? [`blocked rows: ${blocked.join(', ')} — a human must answer these`] : []),
  ];
}

/** How many step definitions already exist — the reuse pool. */
function stepFacts() {
  if (!existsSync(STEPS)) return null;
  const text = readText(STEPS);
  if (text === null) return null;
  const total = /\*\*Total:\*\*\s*(\d+)/.exec(text)?.[1];
  return total ? `step inventory: ${total} step definitions exist — reuse them, do not reword them` : null;
}

// `--untracked-files=normal`, for the fifth time in this harness. Measured under
// `status.showUntrackedFiles=no`, the bare form returns EMPTY for a tree holding untracked files —
// so this line would report a dirty tree as clean, under the heading "trust these".
const dirty = git('status', '--porcelain', '--untracked-files=normal');

// Kept as its own value so the failure and the empty answer stay distinguishable below. Written
// inline as `git(...) || '(no history yet)'` — which is how it read — a git that could not run at
// all reported "no history yet", an affirmative and false claim about the repository, printed
// under the heading "trust them". Measured, with git off PATH: the branch line correctly said
// `(git failed)` and the working tree correctly said `unknown`, and the history fence two lines
// below told the agent the repository had no commits. `||` is the whole bug: `null` and `''` are
// different answers and only one of them is an answer.
const history = git('log', '--oneline', '-3');

const tracker = trackerFacts(process.env.RALPH_TRACKER);
const steps = stepFacts();

// Cut the tail on a line boundary: a block chopped mid-word reads as a corrupted file.
const tail =
  journal.length > TAIL_CHARS
    ? `…\n${journal.slice(-TAIL_CHARS).replace(/^[^\n]*\n/, '')}`
    : journal;

const out = [
  'State left by the previous loop iteration. Read this FIRST and do not redo finished work.',
  '',
  '## Facts (the hook just measured these — trust them)',
  '',
  `branch \`${git('rev-parse', '--abbrev-ref', 'HEAD') ?? '(git failed)'}\` · working tree ` +
    (dirty === null ? '**unknown — git failed, which is not the same as clean**' : dirty ? 'dirty' : 'clean'),
  ...(process.env.RALPH_STAGE ? [`stage \`${process.env.RALPH_STAGE}\``] : []),
  ...(process.env.RALPH_TARGET ? [`target row \`${process.env.RALPH_TARGET}\``] : []),
  ...(tracker ?? []),
  ...(steps ? [steps] : []),
  '',
  '```',
  history === null
    ? '(git failed — the history is unknown, which is not the same as an empty one)'
    : history || '(no commits yet)', // '' here really does mean no commits
  '```',
  '',
  '## Journal of previous turns (the agent’s self-report — check it against the facts above)',
  '',
  tail,
  '',
  'If the journal and the facts disagree, **trust the facts** and say so in your own journal entry.',
  '',
].join('\n');

process.stdout.write(out);
process.exit(0);
