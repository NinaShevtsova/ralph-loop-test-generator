// .claude/skills/spec-builder/check-spec.mjs — the deterministic gate on a spec package.
//
//   node check-spec.mjs --spec <dir> [--baseline <dir>] [--quiet]
//   node check-spec.mjs --list-checks
//
// Exit 0 = every check passed. Exit 1 = at least one failed. Exit 2 = the gate was invoked wrongly
// and checked nothing, which must never be confused with a pass.
//
// `--list-checks` prints the inventory in `CHECKS` and exits 0 without reading a package, so a test
// can require `references/spec-layout.md` to document every rule enforced here.
//
// SELF-CONTAINED ON PURPOSE. This file imports nothing from the repository around it, including
// `scripts/lib.mjs`, which already has a Verdict class. The Skill must keep its gate when the folder
// is copied into another project, and an import reaching three directories up would not survive the
// journey. Forty duplicated lines of console printing is the cheaper half of that trade.
//
// Warnings never fail the gate. A rule can be normative in a package and still be undecidable here:
// the reference itself puts two requests under one `When` for a stated reason, so the machine reports
// and the human rules.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// ── argv ────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function usage(problem) {
  console.error(`check-spec: ${problem}`);
  console.error('check-spec: usage — node check-spec.mjs --spec <dir> [--baseline <dir>] [--quiet]');
  process.exit(2);
}

/**
 * The value after a flag, refusing rather than returning null when there isn't one.
 *
 * `args[i + 1] ?? null` was the obvious spelling and it produces a FALSE GREEN further down: with
 * `--baseline` last on the command line the value is null, the append-only comparison in section 11 is
 * skipped by its own `if (baselineDir)`, and the gate exits 0 having compared nothing. An operator who
 * typed the flag believes it ran. A flag whose value is itself a flag is the same mistake typed
 * differently.
 */
const argAt = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) usage(`${flag} needs a value`);
  return value;
};

const specDir = argAt('--spec');
const quiet = args.includes('--quiet');

/**
 * The gate's own inventory of check KINDS, in the order the sections below run them.
 *
 * `--list-checks` prints it, and `self-check.test.mjs` — beside this file, so it travels with the
 * Skill — requires `references/spec-layout.md` to name every entry. That test is the only thing tying
 * the document to the code: without it the document describes whichever week it was written in, and an
 * author writing a package follows a rule the gate no longer enforces — or never hears about one it
 * started enforcing — with nothing red anywhere to say so.
 *
 * One entry per kind, not per printed line. The gate reports scores of results on a real package
 * because most kinds run once per flow, per criterion or per link; that many names would document the
 * package rather than the rules.
 *
 * The four warnings are listed too. They never fail the gate, which is exactly why they need
 * documenting: a warning an author cannot look up is a warning they read as noise.
 *
 * ADD AN ENTRY WHENEVER A CHECK IS ADDED BELOW. Nothing derives this list from the `v.check` calls —
 * a check that is not named here is invisible to the parity test, so the document can go silent about
 * it and stay green.
 */
const CHECKS = [
  // Section 1 — the files, and the flow file name the loop rebuilds from its flow map.
  'package structure',
  'flow file names',
  // Section 2.
  'conventions section numbering',
  // Section 3 — the Test plan table against the AC bodies, both directions, plus the two empty and
  // duplicate cases that make the rest of it vacuous.
  'a flow declares acceptance criteria',
  'exactly one Test plan row per AC',
  'AC body has a Test plan row',
  'Test plan row has an AC body',
  'AC ids are well formed',
  'a well-formed heading opens a body',
  // Section 4.
  'AC ids are unique',
  'AC prefix matches its flow file',
  'AC numbering is contiguous',
  // Section 5.
  'AC carries its five parts',
  // Section 6.
  'user stories are declared',
  'user story references resolve',
  'every user story is referenced',
  // Section 7 — a fragment resolves, and a link with no fragment still points at a file.
  'anchor links resolve',
  'link targets exist',
  // Section 8 — the paths resolve, and the entry was in a form this gate can read at all.
  'depends_on paths exist',
  'depends_on is readable',
  // Section 9.
  'criteria name at least one request',
  'endpoint containment',
  // Section 10 — warnings.
  'one request per When',
  'a chain of at least two requests',
  'no literal record ids',
  'a Then asserts a data value',
  // Section 11.
  'the baseline holds criteria',
  'baseline is unchanged',
];

// Above the `--spec` guard on purpose: this asks the gate about itself, not about a package. Below the
// guard it would exit 2 unless a package were named, and the test that ties spec-layout.md to this list
// — the document's only tether to the code — would then depend on having one to hand.
if (args.includes('--list-checks')) {
  console.log(CHECKS.join('\n'));
  process.exit(0);
}

if (!specDir) usage('--spec <dir> is required');
if (!existsSync(specDir) || !statSync(specDir).isDirectory()) {
  usage(`--spec "${specDir}" is not a directory`);
}

// A misspelled baseline path must not be read as "no baseline given". Section 11 skips its whole
// comparison on a falsy `baselineDir`, so exit 2 here is the difference between an operator being told
// the path is wrong and an operator being told the package appends only — having compared it to nothing.
const baselineDir = argAt('--baseline');
if (baselineDir && (!existsSync(baselineDir) || !statSync(baselineDir).isDirectory())) {
  usage(`--baseline "${baselineDir}" is not a directory`);
}

// ── Verdict ─────────────────────────────────────────────────────────────────────────
class Verdict {
  constructor(title) {
    this.title = title;
    this.ok = [];
    this.fails = [];
    this.warns = [];
  }

  check(condition, good, bad) {
    if (condition) this.ok.push(good);
    else this.fails.push(bad);
    return condition;
  }

  pass(message) {
    this.ok.push(message);
  }

  fail(message) {
    this.fails.push(message);
  }

  warn(message) {
    this.warns.push(message);
  }

  /**
   * Prints the summary and exits. Never returns.
   *
   * `quiet` arrives as an argument rather than being read from module scope, matching
   * `scripts/lib.mjs`. The class exists because it has to survive being copied into another project,
   * and a version that closed over a module-level binding would throw `ReferenceError` on the way out
   * — after every check had already run, which is the worst place to fail.
   */
  report({ quiet = false } = {}) {
    if (!quiet) for (const line of this.ok) console.log(`  ok   ${line}`);
    for (const line of this.warns) console.log(`  warn ${line}`);
    for (const line of this.fails) console.error(`  FAIL ${line}`);
    console.log('');

    // A gate that checked nothing is not a passing gate.
    if (this.ok.length === 0 && this.fails.length === 0) {
      console.error(`${this.title} FAIL — no checks ran at all; the gate itself is broken.`);
      process.exit(1);
    }
    if (this.fails.length > 0) {
      console.error(`${this.title} FAIL — ${this.fails.length} problem(s).`);
      process.exit(1);
    }
    const tail = this.warns.length > 0 ? `, ${this.warns.length} warning(s)` : '';
    console.log(`${this.title} OK — ${this.ok.length} check(s)${tail}.`);
    process.exit(0);
  }
}

const v = new Verdict('check-spec');

// ── Reading ─────────────────────────────────────────────────────────────────────────

/**
 * The ONE way this gate reads a markdown file: a byte-order mark stripped, line endings normalised.
 *
 * Both were once done inside `parseFlow` alone, and every other read site inherited the bug that
 * function's comment describes. Measured on the two that were left out:
 *
 *   - `context-and-conventions.md` was read raw, so a BOM ahead of a `## 1.` on the first line put the
 *     section numbering out by one;
 *   - a cross-document link target was read raw too, so a BOM ahead of that document's title made its
 *     first heading invisible to `headingCounts` and a correct anchor was reported as resolving to no
 *     heading. Restoring the same file without the BOM turned the package green.
 *
 * A BOM is what `Out-File` and `Set-Content -Encoding utf8` write, which `references/spec-layout.md`
 * names as the ordinary Windows case while promising the gate strips it "before parsing anything".
 * That promise is this function, and it is only true while every read goes through it.
 */
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/**
 * A text's lines with every fenced block removed.
 *
 * Defined here rather than beside the flow parsing it grew up in, because section 2 runs before that
 * point and needs it: the conventions numbering used to scan the raw file while the user-story scan of
 * the same file, three hundred lines lower, went through this. A `const` is in its temporal dead zone
 * until the line that defines it runs, so the fence-aware version simply was not reachable from there.
 */
const unfenced = (body) => {
  const lines = [];
  let fenced = false;

  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line);
  }

  return lines;
};

// ── 1. Package structure ────────────────────────────────────────────────────────────
for (const required of ['README.md', 'context-and-conventions.md']) {
  const path = join(specDir, required);
  // `isFile()`, not `existsSync` alone. Measured: a DIRECTORY named `context-and-conventions.md`
  // satisfied the bare existence check, then reached section 2's `readFileSync` and threw an uncaught
  // EISDIR out of the middle of the run — exit 1 with a stack trace and no verdict line at all. That
  // is the hazard `filesIn` below was written for, left open one function earlier.
  v.check(
    existsSync(path) && statSync(path).isFile(),
    `${required}: present`,
    `${required}: missing, or not a file — the package needs it, see references/spec-layout.md, ` +
      '"The files"'
  );
}

/**
 * Names in `dir` that match and are actually files.
 *
 * `isFile()` is not pedantry. Without it a DIRECTORY named `openapi.json` satisfies the contract check
 * and the gate exits 0 on a package holding no contract — measured. The flows case is worse: a
 * directory named `F-04-x.md` passes both the count and the name check here, and then `parseFlow`'s
 * `readFileSync` throws an uncaught EISDIR in section 3, so the loop gets a stack trace where it
 * needed a sentence.
 */
const filesIn = (dir, matches) =>
  existsSync(dir)
    ? readdirSync(dir).filter((name) => matches(name) && statSync(join(dir, name)).isFile())
    : [];

const contractsDir = join(specDir, 'contracts');
const contracts = filesIn(contractsDir, (name) => /\.(ya?ml|json)$/i.test(name));
v.check(
  contracts.length > 0,
  `contracts/: ${contracts.length} contract file(s)`,
  'contracts/: no .yaml, .yml or .json file — the contract is the one required input'
);

const flowsDir = join(specDir, 'flows');
const flowFiles = filesIn(flowsDir, (name) => name.endsWith('.md'));
v.check(
  flowFiles.length > 0,
  `flows/: ${flowFiles.length} flow document(s)`,
  'flows/: no .md file — a package with no flows describes no coverage'
);

// `flowDocPath` in scripts/flows.mjs builds this name from the flow map; a file named anything else
// is a flow the loop cannot find.
const FLOW_FILE = /^F-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
for (const file of flowFiles) {
  v.check(
    FLOW_FILE.test(file),
    `${file}: name matches F-NN-slug.md`,
    `flows/${file}: not a flow file name — the expected shape is F-NN-lower-case-slug.md`
  );
}

// ── 2. Conventions: the section numbering is an addressing scheme ───────────────────
//
// The judge rubric cites `§10.9` by number, and the stage-1 prompt cites `§10` and `§11`. A renumbered
// file leaves the judge unable to resolve its own references, and produces no error anywhere.
const conventionsPath = join(specDir, 'context-and-conventions.md');
// A readable FILE, or the empty string. `existsSync` alone is true for a directory, and this line was
// then the crash site: section 1 correctly reported `not a file` and this read threw an uncaught EISDIR
// two lines later, so the run ended in a stack trace with no verdict at all. A gate that crashes cannot
// tell the loop "the check failed" from "the checker broke".
const conventions =
  existsSync(conventionsPath) && statSync(conventionsPath).isFile() ? read(conventionsPath) : '';

if (conventions !== '') {
  // Fences removed, as in every other scan this gate performs — and this was the last one that read
  // its file raw. Measured: an illustration of the numbering shown inside a ```markdown block made the
  // gate report `section numbering is 1, 2, 1 — expected 1, 2, 3` on a correct package, so a file
  // documenting the addressing scheme it is required to keep failed for documenting it.
  const visible = unfenced(conventions).join('\n');
  const numbers = [...visible.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  const expected = numbers.map((_, i) => i + 1);
  const contiguous = numbers.length > 0 && numbers.every((n, i) => n === expected[i]);

  v.check(
    contiguous,
    `context-and-conventions.md: ${numbers.length} numbered section(s), contiguous from 1`,
    `context-and-conventions.md: section numbering is ${numbers.join(', ') || '(none found)'} — ` +
      `expected ${expected.join(', ') || '1..N'}; the numbers are an addressing scheme the judge cites`
  );
}

// ── Flow parsing ────────────────────────────────────────────────────────────────────

/**
 * The lines of one `## <title>` section, up to the next `## ` heading or the next criterion heading.
 *
 * Both ends are compared after `.trim()`, and two things end a section. Neither is cosmetic — each was
 * a measured vacuous green:
 *
 *   - trimming only the START let an indented `## ` open a section nothing could close, so the
 *     section ran to end of file;
 *   - stopping only at `## ` did the same thing to a flow document that goes straight from the
 *     behavior table to `### AC-F01-01` without a `## Acceptance criteria` heading — which no check
 *     requires and is a perfectly ordinary way to write the file. Measured: the behavior section grew
 *     from 1479 to 7941 characters, swallowing every AC step, and section 9 then counted the very
 *     request it was meant to catch as its own declaration. Its test went green.
 *
 * The second end used to be ANY `### `, which closed that hole and opened a smaller one beside it: a
 * `## ` section is entitled to a subheading, and every row below one became invisible. Measured — a
 * behavior table split by `### Setup-only requests` reported its own declared endpoint as
 * `used in an AC step but absent from "API behavior used in this flow"`, so the author is sent to
 * look for a row that is four lines above the criterion. The same cut through `## Test plan` demands
 * a row that is plainly there. `AC_CANDIDATE` is the narrower boundary: it ends the section at a
 * heading that means to be a criterion — including a malformed one, which is the case that mattered —
 * and lets an ordinary subheading through.
 */
function section(text, title) {
  // `unfenced`, so a fenced `## API behavior used in this flow` or `## Test plan` in a "how this
  // document is laid out" note cannot hijack a section. Measured before this: such a note made the
  // gate emit two failures on a correct package — every declaration lost and every criterion suddenly
  // rowless. Every table this gate reads arrives through here, so this one line covers all of them.
  const lines = unfenced(text);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## ') || AC_CANDIDATE.test(trimmed)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

/**
 * The criterion heading, in the two readings the gate needs — and ONE tolerance between them.
 *
 * `AC_HEADING` opens a body; `AC_CANDIDATE` is the looser shape section 3b uses to notice a heading
 * that means to be a criterion and is malformed. They must accept the same whitespace, and for a while
 * they did not: `acBodies` required exactly one space after `###` while 3b accepted `\s+`, so
 * `###  AC-F01-02` was pronounced well formed by 3b and opened no body at all. Measured — the gate
 * exited 0 printing `all 2 criterion heading(s) are well-formed AC ids` next to
 * `AC numbering is contiguous from 01 (1 criteria)`, and the second criterion never became a test.
 * That is precisely the invisibility 3b exists to refuse, reintroduced one character below it.
 *
 * Neither carries `g`: both are used with `.exec` against a single line, and a `g` regex holds
 * `lastIndex` between calls.
 */
const AC_HEADING = /^###\s+(AC-F\d{2}-\d{2})\b/;
const AC_CANDIDATE = /^###\s+(AC[^\s—]*)/;
const AC_ID = /^AC-F\d{2}-\d{2}$/;

/**
 * Every AC in document order, and every AC body keyed by id.
 *
 * A body runs from its `### AC-…` heading to the next `### AC-…` or any `## `. Note that it does NOT
 * end at an arbitrary `### `: a `### Teardown` subsection stays inside the criterion it belongs to.
 * That is the safer of the two errors available — the endpoints in such a subsection are then
 * attributed to that AC, which section 9 reports loudly, whereas ending the body early would drop
 * them and report nothing.
 *
 * Fenced blocks are tracked, because a `## ` line inside a fenced example otherwise ends the body.
 * Measured: a YAML sample containing `## the body actually sent` truncated an AC body, section 9 lost
 * every endpoint below the fence and reported ok, and section 11 would have baselined half a
 * criterion. The same tracking stops a `### AC-…` line inside an example from inventing a criterion.
 *
 * `order` is returned alongside the Map because the Map collapses a duplicated id — `set` overwrites
 * — and section 4 exists to catch exactly that duplication. Deriving one from the other would blind
 * it.
 */
function acBodies(text) {
  const bodies = new Map();
  const order = [];
  let current = null;
  let buffer = [];
  let fenced = false;

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;

    const heading = fenced ? null : AC_HEADING.exec(line);
    if (heading) {
      if (current) bodies.set(current, buffer.join('\n'));
      current = heading[1];
      order.push(current);
      buffer = [line];
      continue;
    }
    // `/^#{2} /` matches `## ` and cannot match `### `, because the third character of `### ` is `#`
    // rather than the space the pattern requires.
    if (!fenced && current && /^#{2} /.test(line)) {
      bodies.set(current, buffer.join('\n'));
      current = null;
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) bodies.set(current, buffer.join('\n'));
  return { order, bodies };
}

function parseFlow(path) {
  /*
   * Line endings are normalised BEFORE anything is parsed, and this is the highest-value line in the
   * file.
   *
   * This repository has `core.autocrlf` on and no `.gitattributes`, so a Windows checkout produces
   * CRLF files — measured on a real `git checkout-index` tree: 219 CRLF, 0 bare LF. `/^---\n/` has no
   * `m` flag, so it anchors at string start and does not match `---\r\n`; the frontmatter then comes
   * back empty and section 8 iterates nothing at all. No fail, no ok, silence — a stale `depends_on`
   * sails through, and the test suite copies the same working tree so it cannot notice either.
   *
   * Section 11 is the loud half of the same defect: an LF baseline against a CRLF package reports
   * every single criterion as changed, blaming the author for a line ending.
   */
  // A UTF-8 BOM is stripped alongside the newline normalisation, and for the same reason: `\uFEFF`
  // at offset 0 defeats `/^---\n/` exactly as `\r\n` did, so the frontmatter came back empty and
  // section 8's sentinel printed `declares no depends_on` over a package that declared some — the one
  // falsehood that sentinel exists to prevent. A BOM is what a Windows editor, `Out-File` and
  // `Set-Content -Encoding utf8` all write here, so this is not an exotic input.
  //
  // Both steps live in `read` now, so the two other files this gate opens get the same treatment.
  // They did not, and each carried its own version of this defect.
  const text = read(path);
  const { order, bodies } = acBodies(text);

  // Fences are already gone — `section` drops them — so a fenced "the row format, for reference"
  // example cannot stand in for a row that was deleted. Measured before that: exactly that, green.
  const planSection = section(text, 'Test plan');

  return {
    path,
    text,
    file: basename(path),
    group: /^F-(\d{2})-/.exec(basename(path))?.[1] ?? null,
    frontMatter: /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '',
    acHeadings: order,
    /*
     * The exact format `check-tests.mjs:246` parses, read from the `## Test plan` section only.
     *
     * Scanned over the whole file it was a phantom-row generator: measured, one prose sentence
     * quoting `AC-F01-02: an older wording of the name` left the gate green while `check-tests.mjs`
     * — which uses `.exec()` and so takes the FIRST match — and section 11, which keeps the last,
     * resolved one criterion to two different names.
     */
    planRows: [...planSection.matchAll(/`(AC-F\d{2}-\d{2}):\s*([^`]+)`/g)].map((m) => ({
      id: m[1],
      name: m[2].trim(),
    })),
    bodies,
  };
}

const flows = flowFiles
  .filter((file) => FLOW_FILE.test(file))
  .sort()
  .map((file) => parseFlow(join(flowsDir, file)));

// ── 3. Every AC body has a Test plan row, and every row has a body ──────────────────
for (const flow of flows) {
  // A flow document with no criteria describes no coverage, and every check below it is vacuously
  // satisfied by the empty case — `numbers.every()` is true for an empty array, and both set
  // comparisons below are true for empty sets. Measured: an AC-less flow file passed sections 3, 4 and
  // 5 at once. Section 1 refuses a package with no flow files for exactly this reason; this is the same
  // hole one level down, and section 2 already guards its own version of it with `numbers.length > 0`.
  v.check(
    flow.acHeadings.length > 0,
    `${flow.file}: declares ${flow.acHeadings.length} acceptance criteria`,
    `${flow.file}: declares no acceptance criteria — a flow document with none describes no coverage ` +
      'and leaves every id and completeness check below it vacuously green'
  );

  const rowIds = flow.planRows.map((row) => row.id);
  const planned = new Set(rowIds);
  const headed = new Set(flow.acHeadings);

  // Two rows for one criterion resolve it to two names, and the two consumers disagree about which:
  // `check-tests.mjs` takes the first match, section 11 keeps the last. Measured before this check
  // existed: a duplicated row with a different name left the gate at exit 0, silent.
  const duplicated = [...new Set(rowIds.filter((id, i) => rowIds.indexOf(id) !== i))];
  v.check(
    duplicated.length === 0,
    `${flow.file}: every AC has exactly one Test plan row`,
    `${flow.file}: ${duplicated.join(', ')} — more than one Test plan row. The gate compares the ` +
      'generated title against the first, and section 11 pins the last, so the criterion has two names'
  );

  const unplanned = [...headed].filter((id) => !planned.has(id));
  v.check(
    unplanned.length === 0,
    `${flow.file}: every AC body has a Test plan row`,
    `${flow.file}: ${unplanned.join(', ')} — no Test plan row. The row carries the verbatim test ` +
      'name the gate compares against, so an AC without one cannot be generated'
  );

  const bodiless = [...planned].filter((id) => !headed.has(id));
  v.check(
    bodiless.length === 0,
    `${flow.file}: every Test plan row has an AC body`,
    `${flow.file}: ${bodiless.join(', ')} — a Test plan row with no matching "### <id> —" body`
  );
}

// ── 3b. A criterion heading is shaped like an AC id ────────────────────────────────
//
// A heading that LOOKS like a criterion but is not shaped like one is invisible to everything above
// and below it: `acBodies` opens no body, so no Test plan row is demanded of it, its five parts are
// never read, and the numbering does not notice the hole. Measured — an appended `### AC-F03-7 —`,
// one digit short, with no US line and no row, left the gate byte-identical to the untouched
// reference and never printed the id anywhere. The design asks for "ids well formed"; this is
// it, and it was the one item of that list with no implementation.
for (const flow of flows) {
  const headings = unfenced(flow.text)
    .map((line) => AC_CANDIDATE.exec(line)?.[1])
    .filter((id) => id !== undefined);
  const malformed = headings.filter((id) => !AC_ID.test(id));

  v.check(
    malformed.length === 0,
    `${flow.file}: all ${headings.length} criterion heading(s) are well-formed AC ids`,
    `${flow.file}: ${malformed.join(', ')} — not the shape AC-Fxx-yy. A heading one character off is ` +
      'invisible to every other check: no Test plan row is required of it, its parts are never read, ' +
      'and it silently never becomes a test'
  );

  // The tripwire between the two scanners above, and the reason it is a check rather than a comment.
  //
  // The malformed check answers "does this heading mean to be a criterion and fail the shape"; this one
  // answers the question that actually decides whether the criterion exists — "did the shape it passed
  // open a body". Nothing else compares the two, and when their tolerances drifted apart by one space
  // the divergence was silent in the worst direction: 3b certified the heading and `acBodies` dropped
  // it, so no Test plan row was demanded, its five parts were never read, and the numbering saw no hole
  // because the id was never counted. Vacuous today, by construction — `AC_HEADING` and `AC_CANDIDATE`
  // now accept the same whitespace — which is exactly what a tripwire looks like while it is holding.
  const opened = new Set(flow.acHeadings);
  const unopened = headings.filter((id) => AC_ID.test(id) && !opened.has(id));
  v.check(
    unopened.length === 0,
    `${flow.file}: every well-formed criterion heading opened a body`,
    `${flow.file}: ${unopened.join(', ')} — the heading is well formed and yet no criterion body was ` +
      'parsed from it, so every check below reads nothing: the two heading readings in this gate have ' +
      'drifted apart, and the criterion silently never becomes a test'
  );
}

// ── 4. AC ids: unique across the package, contiguous per flow, in the right file ────
//
// The consumer derives the flow from `acId.slice(4, 6)` without validating it, so an
// id in the wrong file routes a turn to the wrong flow document silently. A gap is just as quiet: the
// tracker is built from these ids, and a missing number looks like a criterion nobody wrote.
const seen = new Map();

for (const flow of flows) {
  let duplicates = 0;

  for (const id of flow.acHeadings) {
    // `v.fail` only, so this check contributes no `ok` line and does not appear in the reported count —
    // meaning it alone cannot be confirmed to have run. The pass line below fixes that; found by the
    // trial run, which noticed the arithmetic did not add up.
    if (seen.has(id)) {
      duplicates += 1;
      v.fail(
        `${flow.file}: duplicate AC id ${id} — already defined in ${seen.get(id)}. ` +
          'One criterion is one test, and the id is the only link between them'
      );
    } else {
      seen.set(id, flow.file);
    }
  }

  // Conditional, which the pass line above was not. Measured: a flow with one id twice printed
  // `ok … 2 AC id(s), none duplicated` directly above `FAIL … duplicate AC id` — an `ok` line asserting
  // the opposite of the failure beside it, and counted in the summary total, so the arithmetic that
  // caught the missing pass in the first place was itself inflated by the case it was added for.
  if (duplicates === 0) {
    v.pass(`${flow.file}: ${flow.acHeadings.length} AC id(s), none duplicated`);
  }

  const prefix = `F${flow.group}`;
  const strays = flow.acHeadings.filter((id) => id.slice(3, 6) !== prefix);
  v.check(
    strays.length === 0,
    `${flow.file}: every AC id carries the ${prefix} prefix`,
    `${flow.file}: ${strays.join(', ')} — the flow prefix does not match F-${flow.group}, and ` +
      'the consumer derives the flow from characters 4 to 6 of the id, so the turn would be routed ' +
      'to a flow document this criterion does not live in'
  );

  const numbers = flow.acHeadings
    .filter((id) => id.slice(3, 6) === prefix)
    .map((id) => Number(id.slice(7)))
    .sort((a, b) => a - b);
  const contiguous = numbers.every((n, i) => n === i + 1);
  v.check(
    contiguous,
    `${flow.file}: AC numbering is contiguous from 01 (${numbers.length} criteria)`,
    `${flow.file}: AC numbering is not contiguous — found ${numbers.join(', ')}; a gap reads as a ` +
      'criterion someone forgot to write'
  );
}

// ── 5. Every AC body carries its five parts ─────────────────────────────────────────
//
// `references/spec-layout.md`, "The five parts". `US` gives traceability, `Why this matters` is what lets a human review the
// criterion and a judge tell a real check from a formality, `Given` is the setup the generator turns
// into Given steps, and the When/Then pairs are the transcription itself.
const PARTS = [
  { label: 'US', pattern: /^\*\*US:\*\*/m },
  { label: 'Why this matters', pattern: /^\*\*Why this matters:\*\*/m },
  { label: 'Given', pattern: /^\*\*Given\*\*/m },
  { label: 'When', pattern: /^\*\*When\*\*/m },
  { label: 'Then', pattern: /^\*\*Then\*\*/m },
];

for (const flow of flows) {
  for (const [id, body] of flow.bodies) {
    // Read from the body with fences removed. Measured: a criterion whose `Given`, `When` and `Then`
    // all sat inside a ```markdown block was certified as carrying all five parts while having no
    // visible step at all.
    const visible = unfenced(body).join('\n');
    const missing = PARTS.filter((part) => !part.pattern.test(visible)).map((part) => part.label);
    v.check(
      missing.length === 0,
      `${flow.file}: ${id} carries US, Why this matters, Given, When and Then`,
      `${flow.file}: ${id} is missing ${missing.join(', ')} — references/spec-layout.md, ` +
        '"The five parts", requires all five'
    );
  }
}

// ── 6. User stories: every reference resolves, every story is used ──────────────────
//
// Both directions matter. A dangling reference leaves an AC pointing at a motivation nobody wrote; an
// unreferenced story is either a coverage gap or a leftover, and the package cannot tell you which.
// Read from the conventions file with fences removed: a story shown inside an example is not a
// declaration, and counting it would make "every declared story is referenced" fail on a correct
// package.
const declaredUs = new Set(
  [...unfenced(conventions).join('\n').matchAll(/\*\*(US-\d{2})\s+—/g)].map((m) => m[1])
);
const referencedUs = new Map();

for (const flow of flows) {
  for (const [id, body] of flow.bodies) {
    // From the body with fences removed, exactly as section 5 reads the same body one loop above.
    // Measured while it read the raw body: a criterion illustrating the reference line with
    // ```markdown **US:** US-99 ``` before its real `**US:** US-01` failed BOTH traceability checks at
    // once — `.exec` takes the first match, so the example became the criterion's reference and the
    // real one was never seen. `references/spec-layout.md` promises a fenced line is invisible in every
    // scan this gate performs; this was the scan where it was not.
    const line = /^\*\*US:\*\*(.*)$/m.exec(unfenced(body).join('\n'))?.[1] ?? '';
    for (const us of line.match(/US-\d{2}/g) ?? []) {
      if (!referencedUs.has(us)) referencedUs.set(us, []);
      referencedUs.get(us).push(`${flow.file} ${id}`);
    }
  }
}

// The empty case, guarded as sections 2, 3 and 9 guard theirs. Measured: renumbering the reference's
// stories to `US-1`…`US-6` — one consistent editorial choice, internally coherent — left both sets
// empty and both checks below reporting ok about nothing.
v.check(
  declaredUs.size > 0,
  `user stories: ${declaredUs.size} declared`,
  'user stories: none found in the shape `**US-nn — Title.**`, which needs two digits and an em ' +
    'dash. Both checks below then compare empty sets and report ok about nothing'
);

const dangling = [...referencedUs.keys()].filter((us) => !declaredUs.has(us));
v.check(
  dangling.length === 0,
  `user stories: every reference resolves (${referencedUs.size} referenced)`,
  `user stories: ${dangling
    .map((us) => `${us} (from ${referencedUs.get(us).join(', ')})`)
    .join('; ')} — referenced but not declared in context-and-conventions.md`
);

const orphaned = [...declaredUs].filter((us) => !referencedUs.has(us));
v.check(
  orphaned.length === 0,
  `user stories: every declared story is referenced (${declaredUs.size} declared)`,
  `user stories: ${orphaned.join(', ')} — declared but no acceptance criterion references it; ` +
    'either coverage is missing or the story is a leftover, and the package cannot say which'
);

// ── 7. Anchor links resolve ─────────────────────────────────────────────────────────
//
// GitHub's slug: lower case, drop everything that is not a letter, a digit, whitespace, an underscore
// or a hyphen, then whitespace to hyphens. An em dash is dropped rather than replaced, which is why
// `## Test data — owner` becomes `test-data--owner` with two hyphens. Getting that wrong would make
// the check reject the reference package, whose anchors all resolve today.
//
// `\p{L}\p{N}` under `u`, not `\w`. `\w` is ASCII-only, so every non-ASCII letter in a heading was
// deleted rather than kept — and both directions of that were wrong at once. Measured:
// `## Test data — заявка` and `## Test data — 请求` both slugged to `test-data--`, so two distinct
// tables shared one anchor and a link into either was reported as resolving while one of them is dead
// in a browser; and `## Test data — café` slugged to `test-data--caf` while GitHub builds
// `test-data--café`, so the correct link was reported as resolving to no heading. This Skill is meant
// to prepare a package for any project, and an ASCII-only anchor rule quietly excludes most of them.
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/**
 * Every heading slug in a document and HOW MANY headings produced it, skipping fenced blocks.
 *
 * A count rather than a set, because a set cannot tell "resolves" from "resolves to two different
 * places". GitHub disambiguates a repeated slug by appending `-1` to the second one, so a link to the
 * bare fragment reaches the first heading only — and with the ASCII-only slug above, two headings that
 * differ solely outside ASCII collapsed onto one slug without anything saying so. A duplicate slug is
 * reported at the LINK, not at the heading: repeating `### Teardown` across criteria is ordinary and
 * harmless until something links to `#teardown`.
 *
 * Fences are tracked for the same reason `acBodies` tracks them, and the consequence here is a false
 * green rather than a truncation: measured, renaming the real `## Test data — owner` while a
 * ```` ```markdown ```` example in the same file contained that exact line left the gate printing
 * `ok … anchor #test-data--owner resolves`. GitHub renders a fenced line as text, so the anchor was
 * dead in a browser while the gate approved it.
 *
 * `#{1,6}` rather than `#{2,6}`: a link onto a document's own title is legitimate, and excluding h1
 * made the gate reject it.
 *
 * The text arrives normalised — every caller reads through `read`. It used to strip newlines here and
 * nothing else, so a cross-document target carrying a byte-order mark lost its first heading: measured,
 * a correct link onto a BOM-prefixed document's own title was reported as resolving to no heading.
 */
const headingCounts = (text) => {
  const counts = new Map();
  let fenced = false;

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const heading = /^#{1,6} (.+)$/.exec(line);
    if (heading) {
      const name = slug(heading[1].trim());
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return counts;
};

/**
 * `headingCounts` for a document on disk, computed once per path.
 *
 * Cross-document links are the sanctioned way to share a test-data table — `references/
 * flow-decomposition.md` says so — which means a package that follows the guidance concentrates many
 * links onto one target. Uncached, that target was read and re-slugged once per link.
 */
const targetHeadings = new Map();
const headingsOf = (path) => {
  if (!targetHeadings.has(path)) targetHeadings.set(path, headingCounts(read(path)));
  return targetHeadings.get(path);
};

/**
 * One anchor, judged against the headings of the document it points into.
 *
 * Both failures live under `anchor links resolve` on purpose: an author reading the output is being
 * told the same thing either way — the link does not reach the table they meant — and a second check
 * name that only ever prints on failure could never be confirmed to have run.
 */
const checkAnchor = (where, label, counts, fragment, inWhat) => {
  const found = counts.get(fragment) ?? 0;
  v.check(
    found === 1,
    `${where}: anchor ${label} resolves`,
    found === 0
      ? `${where}: anchor ${label} resolves to no heading in ${inWhat}`
      : `${where}: anchor ${label} matches ${found} headings in ${inWhat} — the fragment is ` +
        'ambiguous, and a reader following it reaches the first of them while the rest are unreachable'
  );
};

for (const flow of flows) {
  const own = headingCounts(flow.text);

  // Links are read from the document with fences removed. A fenced illustration of the two link forms
  // — which the reference document for this gate prints itself — otherwise became three links the gate
  // demanded resolve, and turned a correct package red.
  const visible = unfenced(flow.text).join('\n');

  // Same-document links: `](#fragment)`.
  for (const [, fragment] of visible.matchAll(/\]\(#([^)]+)\)/g)) {
    checkAnchor(flow.file, `#${fragment}`, own, fragment, 'this file');
  }

  // Links to another document with NO fragment.
  //
  // The leading `./` is optional, and that matters more than it looks: `](F-01-owner-lifecycle.md)` is
  // the ordinary way to write a sibling link, and requiring `\.{1,2}/` meant a bare one — pointing at a
  // file that does not exist, carrying an anchor that resolves to nothing — was examined by none of
  // these three loops. An extension is required instead, and a `:` excluded, so `](#fragment)` and
  // `](https://…)` still fall through to the loops that own them.
  for (const [, target] of visible.matchAll(/\]\(((?:\.{1,2}\/)?[^)#\s:]+\.[a-zA-Z0-9]+)\)/g)) {
    v.check(
      existsSync(join(dirname(flow.path), target)),
      `${flow.file}: link target ${target} exists`,
      `${flow.file}: links to ${target}, which does not exist`
    );
  }

  // Cross-document links: `](./other.md#fragment)` or `](../file.md#fragment)`.
  for (const [, target, fragment] of visible.matchAll(
    /\]\(((?:\.{1,2}\/)?[^)#\s:]+\.[a-zA-Z0-9]+)#([^)]+)\)/g
  )) {
    const targetPath = join(dirname(flow.path), target);
    if (!existsSync(targetPath)) {
      v.fail(`${flow.file}: link target ${target} does not exist`);
      continue;
    }
    checkAnchor(
      flow.file,
      `${target}#${fragment}`,
      headingsOf(targetPath),
      fragment,
      basename(targetPath)
    );
  }
}

// ── 8. `depends_on` points at files that exist ──────────────────────────────────────
//
// The dependency is one-way by design — flows rely on the conventions and the contract, never the
// reverse — and the frontmatter is where that is declared. A stale entry there is a promise the
// package cannot keep.
for (const flow of flows) {
  // Read from the `depends_on` entry specifically. Over the whole frontmatter block,
  // `/"([^"]+)"/g` treats every quoted string as a path, so adding a `title:` or a note turns the gate
  // red on a package that is correct.
  const dependsOn = /^depends_on:\s*\[([^\]]*)\]/m.exec(flow.frontMatter)?.[1] ?? '';
  const declared = [...dependsOn.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  // Said out loud even when there is nothing to check, because the alternative is silence. Under a
  // CRLF checkout `frontMatter` used to come back empty and this loop emitted neither a fail nor an
  // ok — indistinguishable, in the output, from a package whose dependencies all resolve.
  //
  // But "declares none" must not be printed over a `depends_on` this gate simply could not read. Only
  // the one-line `["a", "b"]` form is understood, and a YAML block sequence yields no entries — so
  // without the second condition the sentinel added to prevent silence would instead state a
  // falsehood, which is worse.
  if (declared.length === 0) {
    v.check(
      !/^depends_on:/m.test(flow.frontMatter),
      `${flow.file}: declares no depends_on`,
      `${flow.file}: has a depends_on entry this gate could not read — only the one-line ` +
        '`depends_on: ["a", "b"]` form is understood, and reporting "declares none" here would be a lie'
    );
    continue;
  }

  for (const dependency of declared) {
    const path = join(dirname(flow.path), dependency);
    // `isFile()`, not merely `existsSync`. This is the hole `filesIn` closed in section 1: a directory
    // named `openapi.yaml` would otherwise satisfy a declared dependency on the contract.
    v.check(
      existsSync(path) && statSync(path).isFile(),
      `${flow.file}: depends_on ${dependency} exists`,
      `${flow.file}: depends_on names ${dependency}, which is not a file that exists`
    );
  }
}

// ── 9. Endpoint containment: the flow document is self-sufficient ───────────────────
//
// The stage-1 prompt forbids the generator from opening the contract, on the grounds that the flow's
// "API behavior used in this flow" table already holds what it needs. That claim is only true if
// every endpoint the AC steps name appears in the table, which is what this checks. It was false when
// written: `GET /pettypes` is used in an AC step of F-02 and appeared nowhere in its table, so a turn
// reaching that step knew neither the status code nor the response shape.
//
// Only the AC BODIES are scanned, and only the table is accepted as a declaration. The reverse
// direction is deliberately NOT checked: the reference declares three endpoints no `When` uses,
// because they are used in a `Given`, and a table legitimately covers setup requests too.
const REQUEST = /`(GET|POST|PUT|DELETE|PATCH)\s+(\/[^`]*?)`/g;

/** `/owners/{ownerId}/pets` and `/owners/{id}/pets` are the same endpoint. */
const normalise = (path) => path.replace(/\{[^}]*\}/g, '{}').replace(/\s+/g, '').replace(/\/+$/, '');
/**
 * Every `METHOD /path` in a text, ignoring fenced blocks.
 *
 * Fence-aware on BOTH sides, and each direction was measured as a defect of its own kind. On the
 * DECLARATION side a table row naming `GET /clinics` inside a ```` ```markdown ```` example satisfied
 * the containment check below — a false green certifying self-sufficiency the flow does not have,
 * because GitHub renders that row as text and the generator reading the document sees no declaration.
 * On the USE side a fenced illustration inside a criterion counted as one of its request steps, turning
 * the gate red on a package that was correct.
 *
 * `acBodies` and `headingSlugs` track fences for the same reason. This was the third place in the file
 * where an unfenced scan quietly changed a verdict.
 */
const requestsIn = (text) => {
  const found = new Set();
  let fenced = false;

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(REQUEST)) found.add(`${match[1]} ${normalise(match[2])}`);
  }

  return found;
};

for (const flow of flows) {
  const declared = requestsIn(section(flow.text, 'API behavior used in this flow'));
  const used = requestsIn([...flow.bodies.values()].join('\n'));

  // The empty case, guarded explicitly. A flow whose criteria name no request at all satisfies the
  // containment check below by having nothing to compare — measured, exit 0 with `(0 used)`. Sections 2
  // and 3 each carry the same guard for the same reason; this one was missing it, and section 5 does
  // not cover it because it only requires the bold `**When**` marker to be present.
  v.check(
    used.size > 0,
    `${flow.file}: its criteria name ${used.size} distinct request(s)`,
    `${flow.file}: no criterion names a request — a flow document whose steps name no endpoint ` +
      'describes no chain, and leaves the containment check below with nothing to compare'
  );

  const undeclared = [...used].filter((request) => !declared.has(request));
  v.check(
    undeclared.length === 0,
    `${flow.file}: every endpoint in an AC step is declared in the behavior table (${used.size} used)`,
    `${flow.file}: ${undeclared.join(', ')} — used in an AC step but absent from ` +
      '"API behavior used in this flow". The generator is forbidden from reading the contract, so it ' +
      'would know neither the code nor the response shape'
  );
}

// ── 10. Warnings: real smells that are not decidable ───────────────────────────────
//
// None of these may fail. The reference package trips the multi-request one on purpose —
// F-01 AC-F01-04 step 6 confirms two collections under a shared `Then` — and the scenario generated
// from it was accepted. A check that rejected the gold standard would be wrong about the standard.

/**
 * An AC body's lines with fenced blocks removed.
 *
 * `acBodies`, `headingSlugs` and `requestsIn` each skip fences after a measured defect, and the
 * warnings need the same treatment for a reason of their own: a `**When**` line or a
 * `` `DELETE /owners/1` `` inside an illustration is prose on GitHub, so a warning about it sends a
 * reader to a line that is not a step — and the test below pins the reference's warning COUNT, so a
 * single added example would otherwise turn a green suite red without anything being wrong.
 * The reference has no fenced block at all today, so this changes nothing about its two warnings.
 */

for (const flow of flows) {
  for (const [id, body] of flow.bodies) {
    const lines = unfenced(body);
    const whenLines = lines.filter((line) => line.startsWith('**When**'));

    for (const line of whenLines) {
      const count = [...line.matchAll(REQUEST)].length;
      if (count > 1) {
        v.warn(
          `${flow.file}: ${id} has a When carrying more than one request — ` +
            'references/ac-rules.md, "The fixed shape", states one request per When as the norm; ' +
              'confirm this exception is intended'
        );
      }
    }

    if (whenLines.length === 1) {
      v.warn(
        `${flow.file}: ${id} has a single When — the signature of a contract test. ` +
          'references/ac-rules.md, "The selection filter", requires a chain of at least two requests'
      );
    }

    // A numeric path segment: `/owners/1`, `/pets/3`. `{ownerId}` and `/v3/api-docs` are fine.
    //
    // The path is read from the capture group whole. Splitting the `METHOD path` string back apart on
    // a space and taking `[1]` truncates it at the first space, and a placeholder containing one —
    // `POST /owners/{deleted ownerId}/pets`, which this very package uses — would hide a literal id
    // sitting after it.
    const literals = [...lines.join('\n').matchAll(REQUEST)]
      .filter(([, , path]) => /\/\d+(\/|$)/.test(path))
      .map(([, method, path]) => `${method} ${path}`);
    for (const literal of new Set(literals)) {
      v.warn(
        `${flow.file}: ${id} names a literal record id in \`${literal}\` — every id comes from an ` +
          'API response, and a literal one makes the test green about the seed data'
      );
    }

    // Every `Then` mentioning nothing but a status code: the criterion asserts no data value at all.
    const thens = lines.filter((line) => line.startsWith('**Then**'));
    const assertsData = thens.some((line) => {
      const withoutCodes = line.replace(/code\s+`\d{3}`/g, '').replace(/`\d{3}`/g, '');
      return /`[^`]+`/.test(withoutCodes);
    });
    if (thens.length > 0 && !assertsData) {
      v.warn(
        `${flow.file}: ${id} asserts no named field in any Then — references/ac-rules.md, ` +
          '"The selection filter", requires assertions on data values, with the response code as an ' +
          'auxiliary condition only'
      );
    }
  }
}

// ── 11. Baseline: extend appends, it does not rewrite ──────────────────────────────
//
// Design D-5. The one real risk of a single Skill with two modes is `extend` quietly widening or
// weakening a criterion that has already been generated and accepted. Comparing the bodies and the
// Test plan rows byte for byte is the difference between a guard and a promise.
if (baselineDir) {
  const baselineFlowsDir = join(baselineDir, 'flows');
  // Through `filesIn`, not a bare `readdirSync`, and for the reason section 1 states: a DIRECTORY named
  // `F-04-x.md` passes the name test, and `parseFlow` then throws an uncaught EISDIR out of the middle
  // of the gate — a stack trace where the loop needed a sentence.
  const baselineFlows = filesIn(baselineFlowsDir, (name) => name.endsWith('.md'))
    .filter((file) => FLOW_FILE.test(file))
    .sort()
    .map((file) => parseFlow(join(baselineFlowsDir, file)));

  /** Every criterion of a package: body, the file it lives in, and its Test plan name. */
  const index = (documents) => {
    const found = new Map();
    for (const flow of documents) {
      for (const [id, body] of flow.bodies) found.set(id, { body, file: flow.file });
    }
    // A second pass over every document, not one pass per document. A criterion's Test plan row and its
    // body normally share a file, but nothing enforces that, and a row read before its body existed
    // would leave `name` undefined on one side of the comparison and pass by matching undefined.
    for (const flow of documents) {
      for (const row of flow.planRows) {
        const entry = found.get(row.id);
        if (entry) entry.name = row.name;
      }
    }
    return found;
  };

  const before = index(baselineFlows);
  const after = index(flows);

  v.check(
    before.size > 0,
    `baseline: ${before.size} pre-existing criteria read`,
    'baseline: no acceptance criteria found — is --baseline pointing at a spec package?'
  );

  let unchanged = 0;
  for (const [id, was] of before) {
    const is = after.get(id);
    if (!is) {
      v.fail(
        `baseline: ${id} is present in the baseline and gone from the package — extend appends, ` +
          'it never removes a criterion that may already have a generated test'
      );
      continue;
    }
    if (is.body !== was.body) {
      v.fail(
        `baseline: the body of ${id} differs from the baseline (${was.file} -> ${is.file}) — ` +
          'changing an accepted criterion silently changes what its existing test proves'
      );
      continue;
    }
    if (is.name !== was.name) {
      v.fail(
        `baseline: the Test plan name of ${id} differs from the baseline — the gate compares that ` +
          'name against the generated scenario title, so changing it turns an accepted test red'
      );
      continue;
    }
    unchanged += 1;
  }

  if (unchanged === before.size && before.size > 0) {
    v.pass(`baseline: ${unchanged} pre-existing criteria unchanged`);
  }
}

v.report({ quiet });
