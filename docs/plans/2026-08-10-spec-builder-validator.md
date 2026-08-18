# spec-builder validator Implementation Plan

**Goal:** Build `check-spec.mjs` — the deterministic gate that accepts a well-formed spec package and rejects a malformed one — plus the one reference document that says what it enforces.

**Architecture:** A single self-contained Node CLI inside the Skill folder. It parses a spec package's markdown with regular expressions, collects results in a local `Verdict`, prints them, and exits 0, 1 or 2. It imports nothing from this repository, because the Skill must keep its gate when copied elsewhere (design D-3). Tests spawn it as a subprocess against a temporary copy of `docs/specs/petclinic/`, mutate that copy one way per check, and assert the gate turns red — so every check is falsifiable by construction.

**Tech Stack:** Node 22 ESM, `node:test`, `node:assert/strict`. No dependencies.

**Design:** `docs/specs/2026-08-10-spec-builder-skill-design.md` — sections 11, 12 and 13.

---

## Scope

This plan covers **stage 1** of the design's section 19: the validator and `references/spec-layout.md`. It ships working software on its own — a gate that validates any spec package and, wired into `npm test`, protects the existing PetClinic package from drift.

**A second plan covers stages 2 to 4** — `SKILL.md`, the nine remaining reference documents and the two mode files. That work is prose engineering with a different verification method, and it depends on this plan being done, because `SKILL.md` invokes the validator this plan builds.

## Two things measured before writing this plan

Both changed a check, and neither was reasoned — they were run by hand against the reference.

**1. "Exactly one request per `When`" cannot be a failure.** `docs/specs/petclinic/flows/F-01-owner-lifecycle.md:204` reads `` **When** `GET /pets`, then `GET /visits` `` — two symmetric confirmations under one `Then`, and the judge accepted the scenario generated from it. It ships as a warning (Task 10).

**2. `GET /pettypes` is used in AC steps of `F-02` and is missing from its API behavior table.** A real gap: a generator reaching that step knows neither the code nor the response shape, and the stage-1 prompt forbids it from opening the contract. Task 9 adds the check and fixes the table.

An earlier draft of this plan said `F-03` had the same gap. It does not, and the difference is worth recording: `F-03` mentions `GET /pettypes` only in its `## Chain` line and its `## Test plan` prose, neither of which the check scans. The first measurement scanned from the first AC heading to end of file, which swept in the Test plan section; measuring with the shipped `acBodies()` gives `undeclared: none` for `F-03` and `GET /pettypes` for `F-02` alone. A check is only as trustworthy as the slice of text it reads.

Two further measurements, so they are not later mistaken for defects: `F-01` declares three endpoints no `When` uses — they are used in AC-F01-04's `Given`, so "declared but unused" must **not** become a check. And every cross-file anchor and `depends_on` path in the reference already resolves.

## Four things review found in Task 1, folded back in

Task 1 was implemented and reviewed before the rest of the plan was executed, and the review found four
defects **in this plan's own code**. They are fixed in the Task 1 blocks below, and named here because
each one was a pattern rather than a typo.

1. **`argAt` returned null for a flag with no value.** `--baseline` last on the command line would make
   section 11 skip the append-only comparison and exit 0 — a false green. It now refuses.
2. **A file check accepted a directory.** A directory named `openapi.json` satisfied the contract check
   and the gate exited 0 on a package with no contract. Worse in `flows/`, where `readFileSync` would
   then throw an uncaught EISDIR in section 3 — a stack trace where the loop needed a sentence.
3. **`Verdict.report()` closed over a module-level `quiet`.** The class exists to survive being copied
   into another project, and that version would throw `ReferenceError` on the way out, after every
   check had already run. It takes a parameter now, as `scripts/lib.mjs` does.
4. **The test's `discard` could replace a real failure with its own.** It runs in a `finally`, so a
   transient win32 EBUSY would surface instead of the assertion error that sent us there.

Two tests were added to pin the first two.

## Four more the parsing review found in Task 3

Task 3's parsing layer is inherited by eight later checks, so it was reviewed on its own. Four defects,
**all four vacuous greens** — a check that reports `ok` while measuring nothing, which is worse than a
crash because a crash is visible. Each was measured, not argued.

1. **CRLF emptied the frontmatter.** `/^---\n/` has no `m` flag, so it never matched `---\r\n`. This
   repository has `core.autocrlf` on and no `.gitattributes`; a real `git checkout-index` tree came out
   219 CRLF, 0 bare LF. Section 8 then iterated nothing — no fail, no ok, silence — and section 11
   would have reported every criterion as changed. `parseFlow` now normalises before parsing anything.
2. **A flow with no `## Acceptance criteria` heading defeated section 9.** Nothing requires that
   heading, and going straight from the behavior table to `### AC-F01-01` is ordinary. Measured: the
   behavior section grew from 1479 to 7941 characters and swallowed every AC step, so the containment
   check counted the offending request as its own declaration and its test went green. `section()` now
   ends at `### ` as well as `## `.
3. **A `## ` line inside a fenced example truncated an AC body.** A YAML sample containing
   `## the body actually sent` cut AC-F01-01 short by 288 characters; the endpoints below vanished from
   section 9, which reported ok. `acBodies()` now tracks fences.
4. **`planRows` scanned the whole file.** One prose sentence quoting `AC-F01-02: an older wording` left
   the gate green while `check-tests.mjs` — which uses `.exec()` and takes the first match — and
   section 11, which keeps the last, resolved one criterion to two different names. It reads the
   `## Test plan` section only, and a duplicated row is now its own failure.

Four tests were added for these, and the CRLF one's falsifiable half lives in Task 8, because the field
CRLF breaks has no consumer until then. The counts below therefore run to 31 rather than 24.

Two findings were left alone deliberately. `flow.bodies` is a `Map`, so a duplicated AC heading
collapses while `acHeadings` keeps both — section 4 fails the gate on duplicates, so the verdict is
still red. And an `### Teardown` subsection stays inside its criterion rather than ending it, which
attributes its endpoints to that AC and makes section 9 complain loudly; ending the body there would
drop them silently, and loud beats silent.

## File Structure

| File | Responsibility |
|---|---|
| `.claude/skills/spec-builder/check-spec.mjs` | Create. The whole gate: argv, parsing helpers, every check, the `Verdict`. Self-contained. |
| `.claude/skills/spec-builder/references/spec-layout.md` | Create. The formats the gate enforces, in prose, for the model that writes a package. |
| `tests/check-spec.test.mjs` | Create. Spawns the gate against a temp copy of the reference; one mutation per check. |
| `docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md` | Modify, Task 9. One table row — the only change this plan makes to the reference package. |
| `package.json` | Modify, Task 12. One script line. |

Everything lives in one script rather than a module tree. It is about 400 lines, and the repository's own rule for gates applies: *"A gate must be readable in a minute: if understanding a check requires first learning a check framework, the check gets switched off at the first red."*

### Why the script duplicates `Verdict`

`scripts/lib.mjs` already has one, and importing it would be the normal thing to do here. It would also break D-3: a copy of `.claude/skills/spec-builder/` in another repository would reach for `../../../scripts/lib.mjs` and find nothing. Forty lines of console printing is a cheaper price than a portable Skill that stops working when it travels. The local copy adds `warn()`, which the original does not have.

---

## Task 1: Skeleton, argv and package structure

**Files:**
- Create: `.claude/skills/spec-builder/check-spec.mjs`
- Create: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/check-spec.test.mjs
//
// The gate is proved two ways at once: it must ACCEPT the reference package, and it must REJECT a copy
// of that package mutated one way per check. Either half alone is worthless — a gate that only accepts
// is indistinguishable from `exit 0`, and a gate that only rejects is indistinguishable from `exit 1`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../scripts/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, '.claude/skills/spec-builder/check-spec.mjs');
const REFERENCE = join(ROOT, 'docs/specs/petclinic');

/** A throwaway copy of the reference package. Exact paths only — never a wildcard. */
function specCopy() {
  const root = mkdtempSync(join(tmpdir(), 'check-spec-'));
  const spec = join(root, 'spec');
  cpSync(REFERENCE, spec, { recursive: true });
  return spec;
}

/**
 * Cleanup must never replace a real assertion failure with a fault of its own.
 *
 * `discard` runs in a `finally`, so a throw here REPLACES the assertion error that sent us there — a
 * genuine gate regression would surface as an EBUSY in cleanup with the actual diff lost. On win32 a
 * recursive delete of a tree a just-exited child was reading transiently fails that way, and
 * `force: true` only ignores missing paths, it does not retry. A leaked temp directory is the cheaper
 * outcome.
 */
function discard(spec) {
  try {
    rmSync(dirname(spec), { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* keep the real failure */
  }
}

const gate = (spec, extra = []) => run(process.execPath, [SCRIPT, '--spec', spec, ...extra]);

/** Replace once in a file under the copy, asserting the target was actually there. */
function edit(spec, relative, from, to) {
  const path = join(spec, relative);
  const text = readFileSync(path, 'utf8');
  const count = text.split(from).length - 1;
  assert.equal(count, 1, `mutation target appears ${count} times in ${relative}, expected 1`);
  writeFileSync(path, text.replace(from, to));
}

test('the gate accepts the reference package', () => {
  const spec = specCopy();
  try {
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /OK — \d+ check\(s\)/);
  } finally {
    discard(spec);
  }
});

test('the gate refuses to run without --spec, and says so', () => {
  const result = run(process.execPath, [SCRIPT]);
  assert.equal(result.status, 2, result.out);
  assert.match(result.out, /--spec <dir> is required/);
});

test('the gate rejects a package missing a required file', () => {
  const spec = specCopy();
  try {
    rmSync(join(spec, 'README.md'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /README\.md: missing/);
  } finally {
    discard(spec);
  }
});

test('the gate refuses a flag with no value rather than treating it as absent', () => {
  // `--baseline` last on the command line used to yield null, which the append-only comparison reads
  // as "no baseline given" and skips — the gate then exits 0 having compared nothing, and an operator
  // who typed the flag believes it ran. Section 11 depends on this refusal.
  const withoutValue = run(process.execPath, [SCRIPT, '--spec']);
  assert.equal(withoutValue.status, 2, withoutValue.out);
  assert.match(withoutValue.out, /--spec needs a value/);

  const followedByFlag = run(process.execPath, [SCRIPT, '--spec', '--quiet']);
  assert.equal(followedByFlag.status, 2, followedByFlag.out);
  assert.match(followedByFlag.out, /--spec needs a value/);
});

test('the gate does not accept a directory in place of a contract file', () => {
  // Measured before `isFile()` existed: a directory named `openapi.json` satisfied the contract check
  // and the gate exited 0 on a package holding no contract at all.
  const spec = specCopy();
  try {
    rmSync(join(spec, 'contracts/openapi.yaml'));
    mkdirSync(join(spec, 'contracts/openapi.json'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /contracts\/: no \.yaml, \.yml or \.json file/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a flow file whose name is not F-NN-slug.md', () => {
  const spec = specCopy();
  try {
    cpSync(join(spec, 'flows/F-01-owner-lifecycle.md'), join(spec, 'flows/owners.md'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /owners\.md: not a flow file name/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — every test errors, because `.claude/skills/spec-builder/check-spec.mjs` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// .claude/skills/spec-builder/check-spec.mjs — the deterministic gate on a spec package.
//
//   node check-spec.mjs --spec <dir> [--baseline <dir>] [--quiet]
//
// Exit 0 = every check passed. Exit 1 = at least one failed. Exit 2 = the gate was invoked wrongly
// and checked nothing, which must never be confused with a pass.
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

if (!specDir) usage('--spec <dir> is required');
if (!existsSync(specDir) || !statSync(specDir).isDirectory()) {
  usage(`--spec "${specDir}" is not a directory`);
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

// ── 1. Package structure ────────────────────────────────────────────────────────────
for (const required of ['README.md', 'context-and-conventions.md']) {
  v.check(
    existsSync(join(specDir, required)),
    `${required}: present`,
    `${required}: missing — the package needs it, see design section 11`
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

v.report({ quiet });
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate on a spec package's structure

Self-contained on purpose: a copy of the Skill in another repository must keep
its gate, so this imports nothing from scripts/ and carries its own Verdict.

Proved both ways from the first commit — it accepts the reference package and
rejects a copy with a file removed or a flow misnamed."
```

---

## Task 2: The conventions file's section numbering

The judge rubric cites `§10.9` by number. Renumbering the file silently breaks the judge, and nothing today notices.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects a gap in the conventions section numbering', () => {
  const spec = specCopy();
  try {
    // §10 is the section the judge rubric cites most; renumbering it to §12 leaves a hole at 10.
    edit(spec, 'context-and-conventions.md', '## 10. Test data and environment strategy', '## 12. Test data and environment strategy');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /section numbering/);
    // The FOUND sequence, not just the digits `10` anywhere in the line. The message also prints an
    // `expected 1, 2, … 10, 11` list, so a bare /10/ is satisfied by the half of the message that is
    // identical whether the check passed or failed.
    assert.match(result.out, /section numbering is [\d, ]*12, 11/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — exit status is 0, because no check reads the conventions file yet.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 2. Conventions: the section numbering is an addressing scheme ───────────────────
//
// The judge rubric cites `§10.9` by number, and the stage-1 prompt cites `§10` and `§11`. A renumbered
// file leaves the judge unable to resolve its own references, and produces no error anywhere.
const conventionsPath = join(specDir, 'context-and-conventions.md');
const conventions = existsSync(conventionsPath) ? readFileSync(conventionsPath, 'utf8') : '';

if (conventions !== '') {
  const numbers = [...conventions.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  const expected = numbers.map((_, i) => i + 1);
  const contiguous = numbers.length > 0 && numbers.every((n, i) => n === expected[i]);

  v.check(
    contiguous,
    `context-and-conventions.md: ${numbers.length} numbered section(s), contiguous from 1`,
    `context-and-conventions.md: section numbering is ${numbers.join(', ') || '(none found)'} — ` +
      `expected ${expected.join(', ') || '1..N'}; the numbers are an addressing scheme the judge cites`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate on the conventions section numbering

The rubric cites §10.9 by number and the prompt cites §10 and §11. Renumbering
the file leaves the judge unable to resolve its own references and reports
nothing anywhere, which is the failure mode this check exists for."
```

---

## Task 3: AC headings against Test plan rows

The Test plan table is an index, not a summary: `check-tests.mjs` takes the expected test name from it, and `tests/trackers.test.mjs` takes the full AC list from it. A heading with no row is an AC that does not exist to the machine.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects an AC body with no Test plan row', () => {
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '| AC-F01-02 | `AC-F01-02: updated owner contacts are visible in the owner details and the owners list without a duplicate` | integration | green |\n',
      ''
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F01-02.*no Test plan row/s);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a Test plan row with no AC body', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '### AC-F03-04 —', '### AC-F03-99 —');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F03-04/);
  } finally {
    discard(spec);
  }
});
test('a CRLF checkout is parsed exactly like an LF one', () => {
  // `core.autocrlf` is on here with no `.gitattributes`, so a Windows clone yields CRLF files —
  // measured on a real `git checkout-index` tree: 219 CRLF, 0 bare LF. `parseFlow` normalises before
  // parsing anything.
  //
  // This compares the two runs rather than asserting a check count, so later sections do not have to
  // come back and edit it. It guards the normalisation against regression; it cannot yet FAIL without
  // it, because the one field CRLF actually breaks is the frontmatter, and nothing consumes that until
  // the `depends_on` section. The falsifiable half of this belongs there.
  const asLf = specCopy();
  const asCrlf = specCopy();
  try {
    for (const relative of [
      'README.md',
      'context-and-conventions.md',
      'flows/F-01-owner-lifecycle.md',
      'flows/F-02-owner-pet-lifecycle.md',
      'flows/F-03-pet-visit-flow.md',
    ]) {
      const path = join(asCrlf, relative);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
    }

    const lf = gate(asLf);
    const crlf = gate(asCrlf);
    const summary = (out) => out.trim().split('\n').at(-1);

    assert.equal(crlf.status, lf.status, crlf.out);
    assert.equal(summary(crlf.out), summary(lf.out));
  } finally {
    discard(asLf);
    discard(asCrlf);
  }
});

test('a fenced example neither invents a criterion nor truncates a body', () => {
  // Measured before fences were tracked: `### AC-F01-09` inside a YAML sample became a phantom
  // criterion, and a `## the body actually sent` line inside the same fence ended AC-F01-01's body 288
  // characters early — the endpoints below it vanished from the containment check, which reported ok.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**Step 3 — find the owner in the owners list**',
      '```yaml\n' +
        '### AC-F01-09 — an example, not a criterion\n' +
        '## the body actually sent\n' +
        'firstName: Anna\n' +
        '```\n\n' +
        '**Step 3 — find the owner in the owners list**'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('the gate rejects two Test plan rows for one criterion', () => {
  const spec = specCopy();
  try {
    const row = "| AC-F01-04 | `AC-F01-04: deregistering an owner removes their pet and that pet's visits` | integration | green |";
    edit(spec, 'flows/F-01-owner-lifecycle.md', row, `${row}\n| AC-F01-04 | \`AC-F01-04: an older wording of the same test\` | integration | green |`);
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F01-04 — more than one Test plan row/);
  } finally {
    discard(spec);
  }
});

test('a row quoted in prose outside the Test plan section is not a row', () => {
  // Measured while `planRows` scanned the whole file: this sentence alone made the gate read two rows
  // for AC-F01-01, and the two consumers disagreed about which name was real — `check-tests.mjs` takes
  // the first match, the append-only section keeps the last.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## Acceptance criteria',
      '## Acceptance criteria\n\nThis one was once called `AC-F01-01: an older wording of the name`.\n'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — both new tests see exit 0.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── Flow parsing ────────────────────────────────────────────────────────────────────

/**
 * The lines of one `## <title>` section, up to the next `## ` OR `### ` heading.
 *
 * Both ends are compared after `.trim()`, and both heading depths end a section. Neither is
 * cosmetic — each was a measured vacuous green:
 *
 *   - trimming only the START let an indented `## ` open a section nothing could close, so the
 *     section ran to end of file;
 *   - stopping only at `## ` did the same thing to a flow document that goes straight from the
 *     behavior table to `### AC-F01-01` without a `## Acceptance criteria` heading — which no check
 *     requires and is a perfectly ordinary way to write the file. Measured: the behavior section grew
 *     from 1479 to 7941 characters, swallowing every AC step, and section 9 then counted the very
 *     request it was meant to catch as its own declaration. Its test went green.
 *
 * A `## ` section whose body legitimately contains a `### ` subheading would be cut short here. No
 * section this gate reads has one, and the alternative is the failure above.
 */
function section(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

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

    const heading = fenced ? null : /^### (AC-F\d{2}-\d{2})\b/.exec(line);
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
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const { order, bodies } = acBodies(text);

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
    planRows: [...section(text, 'Test plan').matchAll(/`(AC-F\d{2}-\d{2}):\s*([^`]+)`/g)].map((m) => ({
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate the Test plan table against the AC bodies

The table is an index rather than a summary: check-tests.mjs takes the expected
test name from it and trackers.test.mjs takes the AC list from it. A heading
without a row is an AC that does not exist as far as the machine is concerned,
and nothing said so until now."
```

---

## Task 4: AC ids — duplicates, gaps, and the file they live in

`flowGroupOfAc` is `acId.slice(4, 6)`, unvalidated by design. An id in the wrong file routes work to the wrong flow with no error.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects a duplicate AC id', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-02-owner-pet-lifecycle.md', '### AC-F02-04 —', '### AC-F02-03 —');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /duplicate/i);
    assert.match(result.out, /AC-F02-03/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a gap in the AC numbering of a flow', () => {
  const spec = specCopy();
  try {
    // AC-F01-03 becomes AC-F01-07 in both places, leaving 03 missing and 05..06 skipped.
    edit(spec, 'flows/F-01-owner-lifecycle.md', '### AC-F01-03 —', '### AC-F01-07 —');
    edit(spec, 'flows/F-01-owner-lifecycle.md', '| AC-F01-03 | `AC-F01-03:', '| AC-F01-07 | `AC-F01-07:');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /not contiguous|gap/i);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC id whose flow prefix is not the file it lives in', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '### AC-F03-03 —', '### AC-F02-33 —');
    edit(spec, 'flows/F-03-pet-visit-flow.md', '| AC-F03-03 | `AC-F03-03:', '| AC-F02-33 | `AC-F02-33:');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // The FAIL line, not the id alone: `/F-03/` matched the file name on nearly every ok line, and
    // the status is already 1 from the contiguity check firing on the same mutation.
    assert.match(result.out, /AC-F02-33 — the flow prefix does not match F-03/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — but read each failure rather than trusting the count. Measured: only the prefix test sees exit 0. The duplicate test's mutation also trips section 3's bodiless-row check, so its status is already 1 and it fails on `/duplicate/i` instead; the gap test fails on status. Two of these three can therefore never be falsified by exit code, which is why their message assertions have to name the FAIL line.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 4. AC ids: unique across the package, contiguous per flow, in the right file ────
//
// `flowGroupOfAc` in scripts/flows.mjs is `acId.slice(4, 6)` and is deliberately unvalidated, so an
// id in the wrong file routes a turn to the wrong flow document silently. A gap is just as quiet: the
// tracker is built from these ids, and a missing number looks like a criterion nobody wrote.
const seen = new Map();

for (const flow of flows) {
  for (const id of flow.acHeadings) {
    if (seen.has(id)) {
      v.fail(
        `${flow.file}: duplicate AC id ${id} — already defined in ${seen.get(id)}. ` +
          'One criterion is one test, and the id is the only link between them'
      );
    } else {
      seen.set(id, flow.file);
    }
  }

  const prefix = `F${flow.group}`;
  const strays = flow.acHeadings.filter((id) => id.slice(3, 6) !== prefix);
  v.check(
    strays.length === 0,
    `${flow.file}: every AC id carries the ${prefix} prefix`,
    `${flow.file}: ${strays.join(', ')} — the flow prefix does not match F-${flow.group}, and ` +
      'flowGroupOfAc would route the turn to a different flow document'
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate AC ids for duplicates, gaps and the wrong file

flowGroupOfAc is acId.slice(4, 6) and unvalidated by design, so an id in the
wrong flow document routes a turn elsewhere without a word. A gap in the
numbering is equally quiet — the tracker is built from these ids, and a missing
number looks exactly like a criterion nobody wrote."
```

---

## Task 5: Every AC body carries its five parts

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects an AC with no "Why this matters"', () => {
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      "**Why this matters:** the administrator adds a pet from the owner details, while the vet at the",
      'Removed on purpose, so the AC has no stated consequence.'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // Both halves in one FAIL line. Separately they are worthless: section 5's ok line reads
    // "<id> carries US, Why this matters, Given, When and Then", so on a green run the output holds
    // `Why this matters` twenty times and `AC-F02-01` once.
    assert.match(result.out, /AC-F02-01 is missing Why this matters/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a flow document that declares no criteria', () => {
  // Measured before the guard existed: `numbers.every()` is true for an empty array and both set
  // comparisons are true for empty sets, so an AC-less flow file was green across the Test plan, id and
  // completeness checks at the same time — three sections reporting ok about nothing.
  const spec = specCopy();
  try {
    writeFileSync(
      join(spec, 'flows/F-04-empty-flow.md'),
      '---\ndepends_on: ["../context-and-conventions.md"]\n---\n\n' +
        '# Flow F-04 — declares nothing\n\n## Test plan\n\nNo criteria.\n'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /F-04-empty-flow\.md: declares no acceptance criteria/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects an AC with no Given', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '**Given** an owner is registered (`ownerId`) with a pet added (`petId`); visit data is prepared per the', 'Preconditions omitted on purpose, in prose,');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    // The FAIL line. `Given` appears in every ok line section 5 prints.
    assert.match(result.out, /AC-F03-01 is missing Given/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — both see exit 0.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 5. Every AC body carries its five parts ─────────────────────────────────────────
//
// Design section 8B. `US` gives traceability, `Why this matters` is what lets a human review the
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
    const missing = PARTS.filter((part) => !part.pattern.test(body)).map((part) => part.label);
    v.check(
      missing.length === 0,
      `${flow.file}: ${id} carries US, Why this matters, Given, When and Then`,
      `${flow.file}: ${id} is missing ${missing.join(', ')} — design section 8B requires all five`
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate the five parts of an acceptance criterion

Why this matters is the part most likely to be dropped and the most expensive to
lose: it is what lets a human review a criterion and a judge tell a real check
from a formality."
```

---

## Task 6: User stories referenced both ways

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects an AC referencing a user story that does not exist', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '**US:** US-01, US-02, US-04', '**US:** US-01, US-99');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /US-99/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a user story no AC references', () => {
  const spec = specCopy();
  try {
    edit(spec, 'context-and-conventions.md', '**US-06 — No side effects', '**US-07 — No side effects');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /US-07/);
    assert.match(result.out, /no acceptance criterion/i);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — both see exit 0.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 6. User stories: every reference resolves, every story is used ──────────────────
//
// Both directions matter. A dangling reference leaves an AC pointing at a motivation nobody wrote; an
// unreferenced story is either a coverage gap or a leftover, and the package cannot tell you which.
const declaredUs = new Set([...conventions.matchAll(/\*\*(US-\d{2})\s+—/g)].map((m) => m[1]));
const referencedUs = new Map();

for (const flow of flows) {
  for (const [id, body] of flow.bodies) {
    const line = /^\*\*US:\*\*(.*)$/m.exec(body)?.[1] ?? '';
    for (const us of line.match(/US-\d{2}/g) ?? []) {
      if (!referencedUs.has(us)) referencedUs.set(us, []);
      referencedUs.get(us).push(`${flow.file} ${id}`);
    }
  }
}

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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 21 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate user story references in both directions

A dangling reference points an AC at a motivation nobody wrote. An unreferenced
story is either missing coverage or a leftover, and without this check the
package cannot tell you which."
```

---

## Task 7: Anchor links resolve

ACs link to their test-data tables by anchor, including across flow documents. A broken anchor leaves the generator unable to find the values it must submit.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects a broken anchor inside one flow document', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '## Test data — owner', '## Test data for the owner');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /test-data--owner/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a broken anchor pointing into another flow document', () => {
  const spec = specCopy();
  try {
    // F-01 and F-02 both link to this heading in F-03.
    edit(spec, 'flows/F-03-pet-visit-flow.md', '## Test data — visit', '## Test data — the visit');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /test-data--visit/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — both see exit 0.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 7. Anchor links resolve ─────────────────────────────────────────────────────────
//
// GitHub's slug: lower case, drop everything that is not a word character, whitespace or a hyphen,
// then whitespace to hyphens. An em dash is dropped rather than replaced, which is why
// `## Test data — owner` becomes `test-data--owner` with two hyphens. Getting that wrong would make
// the check reject the reference package, whose anchors all resolve today.
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');

/**
 * Every heading slug in a document, skipping fenced blocks.
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
 * Newlines are normalised here because cross-document targets are read raw, without going through
 * `parseFlow`.
 */
const headingSlugs = (text) => {
  const slugs = new Set();
  let fenced = false;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const heading = /^#{1,6} (.+)$/.exec(line);
    if (heading) slugs.add(slug(heading[1].trim()));
  }

  return slugs;
};

for (const flow of flows) {
  const own = headingSlugs(flow.text);

  // Same-document links: `](#fragment)`.
  for (const [, fragment] of flow.text.matchAll(/\]\(#([^)]+)\)/g)) {
    v.check(
      own.has(fragment),
      `${flow.file}: anchor #${fragment} resolves`,
      `${flow.file}: anchor #${fragment} resolves to no heading in this file`
    );
  }

  // Links to another document with NO fragment. Silent until now, because the cross-document loop
  // below requires a `#`: the reference's three `](./F-01-owner-lifecycle.md)` links went unchecked,
  // and so would `](./typo.md)`.
  for (const [, target] of flow.text.matchAll(/\]\((\.{1,2}\/[^)#\s]+)\)/g)) {
    v.check(
      existsSync(join(dirname(flow.path), target)),
      `${flow.file}: link target ${target} exists`,
      `${flow.file}: links to ${target}, which does not exist`
    );
  }

  // Cross-document links: `](./other.md#fragment)` or `](../file.md#fragment)`.
  for (const [, target, fragment] of flow.text.matchAll(/\]\((\.{1,2}\/[^)#]+)#([^)]+)\)/g)) {
    const targetPath = join(dirname(flow.path), target);
    if (!existsSync(targetPath)) {
      v.fail(`${flow.file}: link target ${target} does not exist`);
      continue;
    }
    v.check(
      headingSlugs(readFileSync(targetPath, 'utf8')).has(fragment),
      `${flow.file}: anchor ${target}#${fragment} resolves`,
      `${flow.file}: anchor ${target}#${fragment} resolves to no heading in ${basename(targetPath)}`
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 23 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate anchor links, within and across flow documents

An AC reaches its test data by anchor, and two flows in the reference reach into
a third. A broken one leaves the generator unable to find the values it has to
submit, and markdown reports nothing."
```

---

## Task 8: `depends_on` paths exist

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects a depends_on path that does not exist', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-02-owner-pet-lifecycle.md', '"../contracts/openapi.yaml"', '"../contracts/missing.yaml"');
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /missing\.yaml/);
  } finally {
    discard(spec);
  }
});

test('depends_on is still checked when the checkout uses CRLF', () => {
  // This is the falsifiable half of the CRLF guard added with the parsing layer. The frontmatter regex
  // anchors at string start with no `m` flag, so `---\r\n` never matched, `frontMatter` came back
  // empty, and this section emitted neither a fail nor an ok. Measured on a real `git checkout-index`
  // tree — which is what a Windows clone of this repository produces.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-02-owner-pet-lifecycle.md');
    const asCrlf = readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n');
    writeFileSync(path, asCrlf.replace('"../contracts/openapi.yaml"', '"../contracts/missing.yaml"'));

    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /missing\.yaml/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — exit 0.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
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
```

```javascript
test('a heading inside a fenced example does not satisfy an anchor', () => {
  // Measured before fences were tracked here: renaming the real heading while an example in the same
  // file contained that exact line left the gate printing `ok  anchor #test-data--owner resolves`.
  // GitHub renders a fenced line as text, so the anchor was dead in a browser and the gate approved it.
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '## Test data — owner', '## Owner test data');
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '## API behavior used in this flow',
      '```markdown\n## Test data — owner\n```\n\n## API behavior used in this flow'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /anchor #test-data--owner resolves to no heading in this file/);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a link to a document that does not exist', () => {
  // The cross-document check requires a `#`, so a link with no fragment was never examined at all —
  // including the reference's own three `](./F-0X-….md)` links.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      '[F-01](./F-01-owner-lifecycle.md)',
      '[F-01](./F-01-typo-lifecycle.md)'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /links to \.\/F-01-typo-lifecycle\.md, which does not exist/);
  } finally {
    discard(spec);
  }
});

test('the gate does not accept a directory as a depends_on target', () => {
  // The same hole section 1 closed with isFile(): existsSync is true for a directory.
  const spec = specCopy();
  try {
    rmSync(join(spec, 'contracts/openapi.yaml'));
    mkdirSync(join(spec, 'contracts/openapi.yaml'));
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /depends_on names \.\.\/contracts\/openapi\.yaml, which is not a file/);
  } finally {
    discard(spec);
  }
});

test('a depends_on the gate cannot read is refused, not reported as absent', () => {
  // The sentinel exists to stop this section falling silent. Printing "declares no depends_on" over a
  // YAML block sequence would replace silence with a false statement, which is worse.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-03-pet-visit-flow.md',
      'depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml"]',
      'depends_on:\n  - "../context-and-conventions.md"\n  - "../contracts/openapi.yaml"'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /has a depends_on entry this gate could not read/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 29 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): gate depends_on against the filesystem

The one-way dependency from a flow onto the conventions and the contract is
declared in frontmatter, and a stale entry there is a promise the package cannot
keep."
```

---

## Task 9: Endpoint containment — and the gap it found in the reference

This is the check that enforces flow self-sufficiency, and running it by hand while planning found a real gap in `F-02`. Fix the reference in the same task, or the gate cannot ship this check as a failure.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`
- Modify: `docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md`

- [ ] **Step 1: Fix the gap in the reference package**

In `docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md`, in the "API behavior used in this flow" table, add this row directly above the `GET /pettypes/{petTypeId}` row:

```markdown
| `GET /pettypes` | `200` and an array of pet types; the first element is taken as a whole per the common precondition |
```

- [ ] **Step 2: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the gate rejects an AC step whose endpoint is not in the flow behavior table', () => {
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**When** `GET /owners`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did',
      '**When** `GET /clinics`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /GET \/clinics/);
    assert.match(result.out, /API behavior used in this flow/);
  } finally {
    discard(spec);
  }
});

test('a declaration inside a fenced example does not satisfy containment', () => {
  // Measured before `requestsIn` tracked fences: the gate printed `ok … (10 used)` and exited 0 while
  // the only declaration of `GET /clinics` sat inside a ```markdown example. GitHub renders that row as
  // text, so the generator reading the flow document sees no declaration at all.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**When** `GET /owners`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did',
      '**When** `GET /clinics`\n**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did'
    );
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '| `POST /owners` | `201`, the body contains the created owner with an assigned `id` |',
      '| `POST /owners` | `201`, the body contains the created owner with an assigned `id` |\n\n```markdown\n| `GET /clinics` | `200` and an array of clinics |\n```\n'
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /GET \/clinics — used in an AC step but absent from/);
  } finally {
    discard(spec);
  }
});

test('a fenced illustration inside a criterion is not one of its request steps', () => {
  // The mirror of the case above, and a false RED rather than a false green: an example showing a call
  // the criterion does NOT make was counted as a step, and the gate rejected a correct package.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-01-owner-lifecycle.md',
      '**Step 3 — find the owner in the owners list**',
      '```http\nnot a step, only an illustration: `GET /clinics`\n```\n\n**Step 3 — find the owner in the owners list**'
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
  } finally {
    discard(spec);
  }
});

test('the gate rejects a flow whose criteria name no request at all', () => {
  // Measured: stripping the backticks off every request in F-03's criteria left the gate at exit 0
  // printing `(0 used)`. Containment with nothing to compare is not containment.
  const spec = specCopy();
  try {
    const path = join(spec, 'flows/F-03-pet-visit-flow.md');
    const text = readFileSync(path, 'utf8');
    const bodiesAt = text.search(/^### AC-/m);
    const planAt = text.indexOf('## Test plan');
    writeFileSync(
      path,
      text.slice(0, bodiesAt) +
        text
          .slice(bodiesAt, planAt)
          .replace(/`(GET|POST|PUT|DELETE|PATCH)\s+(\/[^`]*?)`/g, '$1 $2') +
        text.slice(planAt)
    );
    const result = gate(spec);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /F-03-pet-visit-flow\.md: no criterion names a request/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — exit 0, because no check reads the behavior table yet.

- [ ] **Step 4: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 9. Endpoint containment: the flow document is self-sufficient ───────────────────
//
// The stage-1 prompt forbids the generator from opening the contract, on the grounds that the flow's
// "API behavior used in this flow" table already holds what it needs. That claim is only true if
// every endpoint the AC steps name appears in the table, which is what this checks.
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
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 33 tests. The "accepts the reference package" test passes only because step 1 fixed the gap; if it fails, the table row was not added correctly.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md
git commit -m "feat(spec-builder): gate flow self-sufficiency, and close the gap it found

The stage-1 prompt forbids the generating agent from opening the contract, on
the grounds that the flow's behavior table already holds what it needs. Nothing
checked that claim, and it was false: GET /pettypes is used in an AC step of
F-02 and appeared nowhere in its table, so a turn reaching that step knew
neither the code nor the response shape.

The reverse direction is deliberately not checked — F-01 declares three
endpoints no When uses, because a Given uses them, and a table covering setup
requests is correct."
```

---

## Task 10: Warnings

Four smells that are real but not decidable. The reference itself trips one, for a stated reason, so none of them may fail the gate.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('the reference package produces exactly the two known warnings', () => {
  // Both are deliberate, and pinning the COUNT is the point: a third warning means either a new smell
  // in the reference or a warning that has gone too loose to be worth reading.
  //
  //  - AC-F01-04 step 6 puts `GET /pets` and `GET /visits` under one When, and the judge accepted the
  //    scenario generated from it;
  //  - AC-F02-09 is the negative criterion whose second half asserts an absence in prose — "there is
  //    no pet with the unique name from Given in the list" — so it names no backticked field and the
  //    no-data-assertion heuristic fires on it. The criterion is correct; the heuristic is coarse, and
  //    that is why it warns instead of failing.
  const spec = specCopy();
  try {
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /OK — \d+ check\(s\), 2 warning\(s\)/);
    assert.match(result.out, /warn .*AC-F01-04.*more than one request/);
    assert.match(result.out, /warn .*AC-F02-09.*no named field/);
  } finally {
    discard(spec);
  }
});

test('a literal record id in an AC step warns without failing the gate', () => {
  const spec = specCopy();
  try {
    edit(spec, 'flows/F-01-owner-lifecycle.md', '**When** `DELETE /owners/{ownerId}`\n**Then** code `204`; the response body is empty.', '**When** `DELETE /owners/1`\n**Then** code `204`; the response body is empty.');
    const result = gate(spec);
    assert.match(result.out, /warn .*literal record id/);
    // It is a warning: the endpoint check above fails on the same edit, so assert the warning is
    // present rather than asserting the exit code, which that other check owns.
    assert.match(result.out, /DELETE \/owners\/1/);
  } finally {
    discard(spec);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — the reference run reports no warnings at all, so the `1 warning(s)` match fails.

- [ ] **Step 3: Write the minimal implementation**

Insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 10. Warnings: real smells that are not decidable ───────────────────────────────
//
// None of these may fail. The reference package trips the multi-request one on purpose —
// F-01 AC-F01-04 step 6 confirms two collections under a shared `Then` — and the scenario generated
// from it was accepted. A check that rejected the gold standard would be wrong about the standard.
for (const flow of flows) {
  for (const [id, body] of flow.bodies) {
    const whenLines = body.split('\n').filter((line) => line.startsWith('**When**'));

    for (const line of whenLines) {
      const count = [...line.matchAll(REQUEST)].length;
      if (count > 1) {
        v.warn(
          `${flow.file}: ${id} has a When carrying more than one request — ` +
            'section 8B states one request per When as the norm; confirm this exception is intended'
        );
      }
    }

    if (whenLines.length === 1) {
      v.warn(
        `${flow.file}: ${id} has a single When — the signature of a contract test. Section 8A ` +
          'requires a chain of at least two requests'
      );
    }

    // A numeric final path segment: `/owners/1`, `/pets/3`. `{ownerId}` and `/v3/api-docs` are fine.
    const literals = [...body.matchAll(REQUEST)]
      .map((m) => `${m[1]} ${m[2]}`)
      .filter((request) => /\/\d+(\/|$)/.test(request.split(' ')[1]));
    for (const literal of new Set(literals)) {
      v.warn(
        `${flow.file}: ${id} names a literal record id in \`${literal}\` — every id comes from an ` +
          'API response, and a literal one makes the test green about the seed data'
      );
    }

    // Every `Then` mentioning nothing but a status code: the criterion asserts no data value at all.
    const thens = body.split('\n').filter((line) => line.startsWith('**Then**'));
    const assertsData = thens.some((line) => {
      const withoutCodes = line.replace(/code\s+`\d{3}`/g, '').replace(/`\d{3}`/g, '');
      return /`[^`]+`/.test(withoutCodes);
    });
    if (thens.length > 0 && !assertsData) {
      v.warn(
        `${flow.file}: ${id} asserts no named field in any Then — section 8A requires assertions on ` +
          'data values, with the response code as an auxiliary condition only'
      );
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 35 tests. If the reference reports more than two warnings, read each: a warning on the gold standard is either a real defect worth fixing or a check too loose to keep.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): warn on four smells that cannot be decided

None of them fail the gate. The reference trips two of them on purpose. AC-F01-04
step 6 confirms two collections under a shared Then and the judge accepted the
scenario built from it, so a check that rejected it would be wrong about the
standard rather than the other way round. AC-F02-09 asserts its absence in prose
rather than by naming a field, which is correct for that criterion and coarse of
the heuristic.

The test pins the count at two, so a third has to be looked at rather than
absorbed."
```

---

## Task 11: `--baseline` — the extend mode's safety, measured

Design D-5: `extend` appends only, and that is checked byte-for-byte rather than promised.

**Files:**
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('--baseline accepts a package that only appended', () => {
  const spec = specCopy();
  const baseline = specCopy();
  try {
    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /baseline: \d+ pre-existing criteria unchanged/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('--baseline rejects a changed assertion in a pre-existing AC', () => {
  const spec = specCopy();
  const baseline = specCopy();
  try {
    // Weakening an existing criterion is the damage D-5 exists to catch.
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      '**Then** code `200`; the `pets` array contains exactly one element; it has `id` = `petId`, `name` and',
      '**Then** code `200`; the `pets` array is not empty; it has `id` = `petId`, `name` and'
    );
    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F02-01/);
    assert.match(result.out, /differs from the baseline/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('--baseline rejects a pre-existing AC that disappeared', () => {
  const spec = specCopy();
  const baseline = specCopy();
  try {
    edit(spec, 'flows/F-03-pet-visit-flow.md', '### AC-F03-06 —', '### AC-F03-16 —');
    edit(spec, 'flows/F-03-pet-visit-flow.md', '| AC-F03-06 | `AC-F03-06:', '| AC-F03-16 | `AC-F03-16:');
    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /AC-F03-06.*present in the baseline/s);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('a criterion with a single When warns, and the gate still passes', () => {
  // The fourth warning category had no test. Removing AC-F02-08's second step leaves it with one
  // request, which is the signature of a contract test — section 8A wants a chain of at least two.
  // It is a warning and not a failure, so the exit code must stay 0: a coarse heuristic that could
  // reject a package would be worse than no heuristic.
  const spec = specCopy();
  try {
    edit(
      spec,
      'flows/F-02-owner-pet-lifecycle.md',
      "**Step 2 — attempt to open the same pet from the second owner's details**\n" +
        '**When** `GET /owners/{ownerId2}/pets/{petId}`\n' +
        '**Then** code `404`; the response body is empty.\n',
      ''
    );
    const result = gate(spec);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /warn .*AC-F02-08 has a single When/);
  } finally {
    discard(spec);
  }
});

test('--baseline catches a renamed Test plan entry, which nothing else notices', () => {
  // This is section 11's only unique catch. Every other check passes on this mutation: the row is still
  // well formed, its id still matches a body, the numbering is intact. But the gate compares that name
  // against the generated scenario title, so changing it turns an already-accepted test red — and
  // without this comparison the spec would look untouched.
  const spec = specCopy();
  const baseline = specCopy();
  try {
    edit(
      spec,
      'flows/F-03-pet-visit-flow.md',
      'AC-F03-02: a visit from the clinic-wide log lands in the history of the same pet',
      'AC-F03-02: a visit recorded in the log reaches the same pet'
    );

    const withoutBaseline = gate(spec);
    assert.equal(withoutBaseline.status, 0, 'nothing but the baseline comparison sees this');

    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, /the Test plan name of AC-F03-02 differs from the baseline/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});

test('--baseline accepts a genuine append', () => {
  // Test 36 compares two identical copies, so the path this section exists to permit — adding new
  // criteria while leaving the old ones alone — was never exercised. An append-only guard that also
  // refused appends would be a guard against the wrong thing.
  const spec = specCopy();
  const baseline = specCopy();
  try {
    const path = join(spec, 'flows/F-03-pet-visit-flow.md');
    const text = readFileSync(path, 'utf8');

    const criterion = [
      '### AC-F03-07 — a recorded visit is readable both directly and through its pet',
      '',
      '**US:** US-05',
      "**Why this matters:** the vet opens the visit itself while the administrator opens the pet's",
      'history, and the two must agree about the same appointment.',
      '',
      '**Given** an owner is registered (`ownerId`) with a pet (`petId`) and a recorded visit (`visitId`)',
      '',
      '**Step 1 — open the visit record**',
      '**When** `GET /visits/{visitId}`',
      "**Then** code `200`; `petId` equals the pet's `petId`; `description` is the submitted value.",
      '',
      "**Step 2 — open the pet's visit history**",
      '**When** `GET /pets/{petId}`',
      '**Then** code `200`; the `visits` array contains the record with `id` = `visitId` and the same',
      '`description`.',
      '',
      '## Test plan',
    ].join('\n');

    const row =
      '| AC-F03-07 | `AC-F03-07: a recorded visit is readable directly and through its pet` |' +
      ' integration | green |';

    writeFileSync(
      path,
      text
        .replace('## Test plan', criterion)
        .replace(
          '| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet\'s remaining visits` | integration | green |',
          '| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet\'s remaining visits` | integration | green |\n' + row
        )
    );

    const result = gate(spec, ['--baseline', baseline]);
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /baseline: \d+ pre-existing criteria unchanged/);
  } finally {
    discard(spec);
    discard(baseline);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — `--baseline` is not read, so all three see the plain result.

- [ ] **Step 3: Write the minimal implementation**

First, near the top of `check-spec.mjs`, below the `specDir` guard, add:

```javascript
const baselineDir = argAt('--baseline');
if (baselineDir && (!existsSync(baselineDir) || !statSync(baselineDir).isDirectory())) {
  usage(`--baseline "${baselineDir}" is not a directory`);
}
```

Then insert into `check-spec.mjs`, directly above the final `v.report({ quiet });`:

```javascript
// ── 11. Baseline: extend appends, it does not rewrite ──────────────────────────────
//
// Design D-5. The one real risk of a single Skill with two modes is `extend` quietly widening or
// weakening a criterion that has already been generated and accepted. Comparing the bodies and the
// Test plan rows byte for byte is the difference between a guard and a promise.
if (baselineDir) {
  const baselineFlowsDir = join(baselineDir, 'flows');
  const baselineFlows = existsSync(baselineFlowsDir)
    ? readdirSync(baselineFlowsDir)
        .filter((file) => file.endsWith('.md') && FLOW_FILE.test(file))
        .map((file) => parseFlow(join(baselineFlowsDir, file)))
    : [];

  const before = new Map();
  for (const flow of baselineFlows) {
    for (const [id, body] of flow.bodies) before.set(id, { body, file: flow.file });
    for (const row of flow.planRows) {
      const entry = before.get(row.id);
      if (entry) entry.name = row.name;
    }
  }

  const after = new Map();
  for (const flow of flows) {
    for (const [id, body] of flow.bodies) after.set(id, { body, file: flow.file });
    for (const row of flow.planRows) {
      const entry = after.get(row.id);
      if (entry) entry.name = row.name;
    }
  }

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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 41 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec-builder/check-spec.mjs tests/check-spec.test.mjs
git commit -m "feat(spec-builder): --baseline turns append-only from a promise into a guard

Design D-5. The one real risk of one Skill with two modes is extend quietly
weakening a criterion that already has a generated, accepted test. Bodies and
Test plan names are compared byte for byte, and a removed criterion is a failure
in its own right."
```

---

## Task 12: `references/spec-layout.md`, wired to the gate that enforces it

A document describing formats will drift from the code checking them unless something ties the two together. The gate lists its own sections; the document must name the same ones.

**Files:**
- Create: `.claude/skills/spec-builder/references/spec-layout.md`
- Modify: `.claude/skills/spec-builder/check-spec.mjs`
- Modify: `tests/check-spec.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Append to `tests/check-spec.test.mjs`:

```javascript
test('spec-layout.md documents every format the gate enforces', () => {
  // Prose describing formats drifts from the code checking them. `--list-checks` prints the gate's own
  // section titles; the reference document must name each one, so adding a check without documenting
  // it turns this red.
  const listed = run(process.execPath, [SCRIPT, '--list-checks']);
  assert.equal(listed.status, 0, listed.out);

  const titles = listed.stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(titles.length >= 25, `expected at least 25 checks, got ${titles.length}`);

  const document = readFileSync(
    join(ROOT, '.claude/skills/spec-builder/references/spec-layout.md'),
    'utf8'
  );
  const undocumented = titles.filter((title) => !document.includes(title));
  assert.deepEqual(undocumented, [], 'checks the gate runs but spec-layout.md does not mention');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/check-spec.test.mjs
```

Expected: FAIL — `--list-checks` is not implemented and the document does not exist.

- [ ] **Step 3: Add `--list-checks` to the gate**

In `check-spec.mjs`, replace the `if (!specDir) usage('--spec <dir> is required');` line with:

```javascript
// The gate's own inventory, in one place, so `references/spec-layout.md` can be checked against it.
const CHECKS = [
  'package structure',
  'conventions section numbering',
  'AC body has a Test plan row',
  'Test plan row has an AC body',
  'AC ids are unique',
  'AC prefix matches its flow file',
  'AC numbering is contiguous',
  'AC carries its five parts',
  'user story references resolve',
  'every user story is referenced',
  'anchor links resolve',
  'depends_on paths exist',
  'endpoint containment',
  'baseline is unchanged',
];

if (args.includes('--list-checks')) {
  console.log(CHECKS.join('\n'));
  process.exit(0);
}

if (!specDir) usage('--spec <dir> is required');
```

- [ ] **Step 4: Write `references/spec-layout.md`**

```markdown
# The spec package layout, and the formats a machine parses

A spec package is read by a machine before it is read by a human. Most of it is prose you may write as
you see fit; a small part of it is an interface, and prose in those places fails the gate that guards
the generation loop.

Run the gate on anything you produce:

    node .claude/skills/spec-builder/check-spec.mjs --spec <spec-dir>

## The files

    <spec-dir>/
      README.md                     reading order, the package table, the AC format, the traceability rule
      context-and-conventions.md    numbered sections — the shared foundation of every flow
      contracts/openapi.yaml        the contract, reconciled with observed behavior
      flows/F-01-<slug>.md          one flow = one independent generation unit
      flows/F-02-<slug>.md
      UNRESOLVED.md                 questions that block criteria

**package structure** — `README.md` and `context-and-conventions.md` must exist, `contracts/` must hold
at least one `.yaml`, `.yml` or `.json`, and `flows/` at least one `.md`.

**Flow file names** are `F-NN-lower-case-slug.md`. The loop builds this path from its flow map, so a
file named anything else is a flow it cannot find.

## The seven formats that carry load

### 1. The Test plan row

The last table of every flow document gives the exact name of each generated test, in backticks:

```markdown
| AC | Test | Level | Expected run result |
|---|---|---|---|
| AC-F02-01 | `AC-F02-01: an added pet is visible in the owner details and in its own details` | integration | green |
```

A regular expression reads the name out of the backticks and compares it to the generated scenario
title. Written any other way, the gate fails and the generating agent has no route to green.

**AC body has a Test plan row** and **Test plan row has an AC body** check both directions. The table
is an index, not a summary: an `### AC-…` heading with no row is a criterion that does not exist as far
as the machine is concerned.

### 2. The AC id

Exactly `AC-F<two digits>-<two digits>`. The loop derives the flow from characters 4 and 5 of the
string without validating them, so a malformed id routes work to a flow that does not exist, silently.

**AC ids are unique** across the package. **AC prefix matches its flow file** — `AC-F02-…` lives only
in `F-02-*.md`. **AC numbering is contiguous** from `01` within each flow; a gap reads as a criterion
someone forgot to write.

### 3. The numbered sections of the conventions file

`## 1.`, `## 2.`, … contiguous from 1. **conventions section numbering** enforces it. These numbers are
an addressing scheme: the judge rubric cites `§10.9`, the generation prompt cites `§10` and `§11`.
Renumbering the file leaves the judge unable to resolve its own references and reports nothing.

### 4. The five parts of a criterion

**AC carries its five parts**: `**US:**`, `**Why this matters:**`, `**Given**`, and at least one
`**When**` and `**Then**`.

```markdown
### AC-F02-03 — a transfer between own accounts is visible in both statements

**US:** US-02, US-04
**Why this matters:** the client moves money between their own accounts and then opens each
statement separately. If the transfer lands in only one of them, the client sees money that vanished.

**Given** a customer is registered (`customerId`); two accounts are opened (`accountFromId`,
`accountToId`); the opening balances are remembered

**Step 1 — submit the transfer**
**When** `POST /accounts/{accountFromId}/transfers` with `toAccountId` and `amount`
**Then** code `201`; the body carries an assigned `id`, `amount` equal to the submitted value.
Save `id` as `transferId`.
```

### 5. User stories, referenced by id

Declared once in the conventions file as `**US-nn — Title.**`, referenced from criteria by id.
**user story references resolve** and **every user story is referenced** check both directions: a
dangling reference points a criterion at a motivation nobody wrote, and an unreferenced story is either
missing coverage or a leftover.

### 6. Anchors onto test-data tables

A heading `## Test data — pet` yields the anchor `#test-data--pet`: lower case, non-word characters
dropped, whitespace to hyphens — so the em dash disappears and leaves two hyphens. Criteria link to
their data this way, including across flow documents. **anchor links resolve** checks every one.

**depends_on paths exist** covers the frontmatter, where the one-way dependency onto the conventions
file and the contract is declared.

### 7. The flow behavior table

Every flow carries `## API behavior used in this flow`, listing each request the flow makes with its
code and response shape. **endpoint containment** requires every endpoint named in a criterion's steps
to appear there, because the generating agent is forbidden from opening the contract — the table is
what stands in for it.

The reverse is not checked. A table may legitimately declare endpoints no `When` uses, because they are
used in a `Given`.

## Warnings

These report and never fail, because each is a real smell that cannot be decided mechanically:

- a `When` carrying more than one request — one request per `When` is the norm, but a criterion may
  confirm two collections under a shared `Then` for a stated reason;
- a criterion with a single `When` — the signature of a contract test;
- a literal record id such as `/owners/1`;
- a criterion whose every `Then` mentions nothing but a status code.

## Appending to an existing package

Pass the untouched package as a baseline and the gate proves you only added:

    node .claude/skills/spec-builder/check-spec.mjs --spec <spec-dir> --baseline <pristine-copy>

**baseline is unchanged** compares every pre-existing criterion's body and Test plan name byte for
byte. Changing an accepted criterion silently changes what its existing test proves, and removing one
orphans a test that already passed.
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/check-spec.test.mjs
```

Expected: PASS — 42 tests.

- [ ] **Step 6: Wire it into `npm test`**

In `package.json`, add to `"scripts"`, after the `"check:tests"` line:

```json
    "check:spec": "node .claude/skills/spec-builder/check-spec.mjs",
```

- [ ] **Step 7: Run the whole suite and the gate on the reference**

```bash
npm test
```

Expected: 472 tests, 472 pass, 0 fail — the 430 that existed plus the 42 this plan adds.

```bash
npm run check:spec -- --spec docs/specs/petclinic
```

Expected: `check-spec OK — 73 check(s), 2 warning(s).`

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/spec-builder/ tests/check-spec.test.mjs package.json
git commit -m "feat(spec-builder): document the enforced formats, tied to the gate by a test

A document describing formats drifts from the code checking them. --list-checks
prints the gate's own inventory and a test requires spec-layout.md to name every
entry, so adding a check without documenting it turns the suite red.

npm run check:spec runs the gate on any package; npm test covers it."
```

---

## Self-Review

**Spec coverage.** Design section 13 layer 1 lists structure, AC integrity, cross-file and smell checks plus extend safety. Structure → Task 1. Section numbering → Task 2. Headings against rows → Task 3. Ids → Task 4. Five parts → Task 5. User stories → Task 6. Anchors → Task 7. `depends_on` → Task 8. Endpoint containment → Task 9. Smells → Task 10. Baseline → Task 11. Design section 11's format table → Task 12's document. Design section 19 stage 1 asked for `check-spec.mjs` and `spec-layout.md`; both are here.

**Not in this plan, by scope:** design sections 5 to 10, 14 to 17 are instruction content for the model, and section 13 layer 2 is the semantic self-review the model performs. All of that is the second plan. Section 20's harness wiring is out of scope by D-1.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Task 3's step 3 originally carried an escaped placeholder plus a paragraph explaining what to write instead of it; the code block now holds the real line and the paragraph is gone. A plan that needs prose to correct its own code block is a plan with a placeholder in it, whatever the justification.

**Type consistency.** `parseFlow` is defined in Task 3 and returns `{ path, text, file, group, frontMatter, headings, acHeadings, planRows, bodies }`. Later tasks use `flow.file` (Tasks 4–11), `flow.group` (Task 4), `flow.bodies` (Tasks 5, 6, 9, 10), `flow.planRows` (Tasks 3, 11), `flow.text` (Tasks 7, 9), `flow.path` (Tasks 7, 8), `flow.frontMatter` (Task 8) — all defined. `FLOW_FILE` and `flowFiles` come from Task 1 and are reused in Tasks 3 and 11. `section` and `acBodies` come from Task 3, `REQUEST` and `requestsIn` from Task 9 and are reused by Task 10. `conventions` comes from Task 2 and is reused by Task 6. `CHECKS` is added in Task 12 and its entries match the check names used in the `v.check` messages of Tasks 1 to 11.

**One ordering constraint.** Task 10 uses `REQUEST`, defined in Task 9, and Task 6 uses `conventions`, defined in Task 2. Tasks must be executed in order.
