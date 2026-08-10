// loop/tracker.mjs — pure reading and mutation of a tracker table.
//
// The loop's progress metric is the number of `done` rows here, and `done` is written by the
// RUNNER on an independent judge verdict (design D-11). That is the whole reason this module is
// pure and unit-tested: the metric must not be able to drift because of a sloppy regex.
//
// Both trackers share one row shape, so one parser serves both:
//
//   | ID | Group | Title | Status |
//
// Group is `wave-1`…`wave-8` for the scaffold tracker and `F-01`/`F-02`/`F-03` for the tests
// tracker. Everything else is derived, so there is no fifth column to keep in sync.

export const STATUSES = ['todo', 'review', 'rework', 'blocked', 'done'];

/**
 * A data row.
 *
 * `^\s*\|`, not `^\|`. Markdown renders one to three leading spaces identically, so an indented row
 * looks perfectly correct in the file — but anchoring on `^\|` skipped it while the table-stop check
 * accepted it, so the row dropped out of the metric with nothing at all to show for it.
 *
 * The trailing `\s*` is load-bearing on Windows. This repository has `core.autocrlf=true` and no
 * `.gitattributes`, so a fresh checkout of `loop/trackers/*.md` has CRLF endings; without it the
 * real trackers parse to ZERO rows and the runner reports the stage complete.
 *
 * The status alternative is spelled out so a typo cannot be counted as a valid state. That makes a
 * malformed status cell invisible to THIS regex, which is why `validateTable` exists: an invisible
 * row is far more dangerous than a rejected one.
 */
const ROW = new RegExp(
  String.raw`^\s*\|\s*([A-Za-z0-9._-]+)\s*\|\s*([A-Za-z0-9._-]+)\s*\|\s*(.+?)\s*\|\s*(${STATUSES.join('|')})\s*\|\s*$`
);

/**
 * The tracker table's own header. The scan anchors HERE rather than on "the first line that looks
 * like a row": otherwise a four-column decoy above the real table captures the scan and hides the
 * whole tracker. Measured — a preamble table ending in a bare `done` cell gave one row and
 * `pickTarget → null`, so the runner exited 0 on a tracker whose 20 rows were all still `todo`.
 */
const HEADER = /^\s*\|\s*ID\s*\|\s*Group\s*\|\s*Title\s*\|\s*Status\s*\|\s*$/;

const TABLE_LINE = /^\s*\|/;
const SEPARATOR = /^\s*\|[\s|:-]+\|\s*$/;

/**
 * The single pass both the reader and the writer share. Splitting the file once, here, is what
 * keeps `parseRows` and `setStatus` from disagreeing about what counts as a row — a disagreement
 * would mean the runner reads one set of rows and writes into another.
 *
 * Scanning STOPS at the first line that is not part of a markdown table once rows have started.
 * Without that stop, any four-column row anywhere else in the file whose last cell happens to read
 * like a status becomes a phantom tracker row — measured:
 * `| some-test | integration | nobody | done |` parsed as a row with the id `some-test`, because
 * `-` is inside the id character class and the status word is the only real guard.
 *
 * That is not hypothetical here. `tests.md` carries an "Open questions" section that the runner and
 * the agent fill with free text at RUNTIME, and the scaffold tracker carries per-task detail
 * sections with their own tables. A row-count test on the pristine file would never catch it, so
 * the metric could drift mid-run.
 */
function scanTable(markdown) {
  const lines = (markdown ?? '').split('\n');
  const rows = [];
  const malformed = [];

  const start = lines.findIndex((line) => HEADER.test(line));
  if (start === -1) return { lines, rows, malformed, found: false };

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!TABLE_LINE.test(line)) break;
    if (SEPARATOR.test(line)) continue;

    const m = ROW.exec(line);
    if (m) {
      rows.push({ id: m[1], group: m[2], title: m[3], status: m[4], line: index });
      continue;
    }

    // A `|`-line inside the table that is neither the separator nor a valid row. COLLECTED, never
    // just skipped. An unrecognised status cell used to make the whole row vanish from the metric,
    // and the loop then reported the stage complete with that work never done.
    malformed.push({ line: index, text: line.trim() });
  }

  return { lines, rows, malformed, found: true };
}

/** Every data row of the tracker table, in file order. */
export function parseRows(markdown) {
  return scanTable(markdown).rows;
}

/**
 * Whether the tracker file is trustworthy enough to drive a loop. Call this before reading the
 * metric; a problem here means "stop", not "carry on with what parsed".
 *
 * The failure it exists for is silent by nature. The agent under review is the party that writes
 * `review` and `blocked` into this file, and it is shown those words in backticks — so a cell
 * holding `` `review` ``, `**review**`, `Review` or `review ✅` is an ordinary mistake. Any of them
 * made `parseRows` return 19 rows out of 20, after which the runner announced that every row was
 * done and exited 0, with one acceptance criterion never generated and no error anywhere.
 *
 * Two independent detectors, because one of them is only as good as its regex:
 *
 * 1. a `|`-line inside the table that is not a valid row;
 * 2. the parsed count against the `**Total:** N` line both trackers already carry.
 *
 * Plus duplicate ids, which make the reader and the writer target different rows: measured, the
 * runner then re-targeted the same criterion every iteration — paying for an agent turn and a judge
 * call each time — until the no-improvement stop ended the run with a false "the metric has
 * plateaued".
 */
export function validateTable(markdown) {
  const { rows, malformed, found } = scanTable(markdown);
  const problems = [];

  if (!found) {
    problems.push('no tracker table found — expected a header row `| ID | Group | Title | Status |`');
  }

  for (const bad of malformed) {
    problems.push(
      `line ${bad.line + 1}: inside the table but not a valid row — ${bad.text}` +
        `\n    the status cell must be one bare word from ${STATUSES.join(', ')}` +
        ' — no backticks, no bold markers, no trailing text'
    );
  }

  const firstLineOf = new Map();
  for (const row of rows) {
    if (firstLineOf.has(row.id)) {
      problems.push(
        `line ${row.line + 1}: duplicate id ${row.id}, already on line ${firstLineOf.get(row.id) + 1}` +
          ' — the reader and the writer would target different rows'
      );
    } else {
      firstLineOf.set(row.id, row.line);
    }
  }

  const declared = /^\*\*Total:\*\*\s*(\d+)/m.exec(markdown ?? '')?.[1];
  if (declared !== undefined && Number(declared) !== rows.length) {
    problems.push(`the file declares **Total:** ${declared} but ${rows.length} row(s) parsed`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Counts for every status, zeroes included — a missing key would read as "no data".
 *
 * `group` narrows the count to one flow or wave, and the runner passes `--flow` straight through.
 * Without it the plateau metric and the printed tally under `--flow F-01` were dominated by the rows
 * the operator was not working on, so the number that stopped the run was not the number on screen.
 */
export function countByStatus(markdown, group) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of parseRows(markdown)) {
    if (group && row.group !== group) continue;
    counts[row.status] += 1;
  }
  return counts;
}

/**
 * The row the next iteration works on, plus what has to happen to it.
 *
 * Rows are walked in file order, and order is the only dependency mechanism: the scaffold tracker
 * is sorted by wave, the tests tracker by flow. A `blocked` row is REPORTED rather than skipped —
 * skipping it would let the loop build on a foundation whose open question is still unanswered.
 *
 * `review` means the agent finished but the judge never ran (a crash between the two). Returning
 * the judge phase makes that state recoverable without a second agent turn.
 */
export function pickTarget(markdown, group) {
  const all = parseRows(markdown);

  // `null` must mean exactly one thing — "every row I can see is done" — because the runner reads it
  // as success and exits 0. It used to also mean "no row matched the group" and "no rows at all", so
  // a tracker whose rows had gone unparseable was reported as a completed stage. Measured: with the
  // six F-03 rows mangled, `--flow F-03` announced that every row was done while `done` was 0.
  if (all.length === 0) {
    throw new Error('no tracker rows parsed — the table is missing or malformed, see validateTable');
  }

  const rows = group ? all.filter((row) => row.group === group) : all;
  if (rows.length === 0) {
    throw new Error(
      `no tracker rows in group ${group} — ${all.length} row(s) exist in other groups, so either the ` +
        'group name is wrong or those rows have gone unparseable'
    );
  }

  for (const row of rows) {
    if (row.status === 'done') continue;
    if (row.status === 'review') return { row, phase: 'judge' };
    if (row.status === 'blocked') return { row, phase: 'blocked' };
    return { row, phase: 'agent' };
  }
  return null;
}

/**
 * Returns the markdown with one row's status replaced. Throws rather than writing garbage.
 *
 * Goes through `scanTable`, which matters twice. An earlier version walked every line, so a
 * status-shaped four-column row in the free text below the table could be **rewritten** — the
 * runner would edit prose in the "Open questions" section. Worse, such a phantom row could satisfy
 * the found check on its own, which defeats the throw below: a missing real row would then be
 * silently accepted as updated, and the loop would carry on believing it had recorded a status it
 * never wrote.
 */
export function setStatus(markdown, id, status) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);

  const { lines, rows } = scanTable(markdown);
  const target = rows.find((row) => row.id === id);
  if (!target) throw new Error(`no tracker row with id ${id}`);

  const updated = [...lines];
  // Preserve the row's own line ending. On a CRLF checkout every write otherwise left one LF-only
  // line behind, one more per iteration, so the claim "the row is preserved exactly apart from its
  // status" was simply false.
  const eol = /\r$/.test(lines[target.line]) ? '\r' : '';
  updated[target.line] = `| ${target.id} | ${target.group} | ${target.title} | ${status} |${eol}`;
  return updated.join('\n');
}

/** The earliest accepted row — the exemplar fed to every later judge call (design §6.1). */
export function firstDone(markdown) {
  return parseRows(markdown).find((row) => row.status === 'done') ?? null;
}
