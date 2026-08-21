# Stage 0 Experiment Implementation Plan

**Goal:** Make stage 0's cross-cutting quality properties executable — as text-scan invariants, unit tests and one canary BDD scenario — and stop the stage-0 gate doing provably empty work, without removing a single existing mechanism.

**Architecture:** Three additions, all in the repository's established shapes. (1) `scripts/invariants.mjs` holds pure functions over file contents, exactly as `scripts/checks.mjs` does, and `scripts/check-invariants.mjs` is the CLI that reads files and reports through the existing `Verdict` class. (2) `loop/gates.mjs` learns which gate steps a stage-0 row actually needs, derived from the manifest rather than from a hard-coded wave number. (3) The C# project gains `Tests/Unit/` and one canary feature outside `Features/`, which is the first thing in stage 0 ever to execute the Reqnroll pipeline.

**Tech Stack:** Node 22 (ESM, `node:test`), C# net8.0, NUnit 4, Reqnroll 3, FluentAssertions 7, Docker for the SUT.

**Design document:** [docs/design/2026-08-20-stage0-redesign.md](../design/2026-08-20-stage0-redesign.md) — phases 1–2, deliverables 0–4.

---

## Before you start

**Do not commit.** The user reviews the working tree first. Every task ends with a *prepared* commit
command — write it down, show the diff, and stop. Run `git commit` only when the user says so.

**Two deviations from the design document.** Both were found by probing the real tree while writing
this plan; the design document should be amended once they are accepted.

| Deviation | Design says | This plan does | Why |
|---|---|---|---|
| **D-23, where the last-green SHA lives** | recorded in `loop/verdicts/.gate-green` | held in memory in the runner process | The file only buys a skipped pre-gate on a *resumed* run — one gate per resume — and costs four failure branches (missing, unreadable, stale, gitignore interaction). An in-memory flag is `null` on a fresh process, so a resumed run simply runs the gate. Strictly simpler, and fail-closed by construction. |
| **I7 is dropped; six invariants, not seven** | I7: "every smoke test asserts on a value, not only on `StatusCode`" | not implemented | Verified against the accepted scaffold: `Smoke_tracker_cleans_up_in_order` asserts *only* `StatusCode.Should().Be(HttpStatusCode.NotFound)` five times — and it is right to, because for a teardown test "the record answers 404" **is** the value under test. A check that goes red on accepted work is dropped, not shipped (D-30). Rubric check 8 stays with the judge. |

**A grep that cannot match.** `node --test`'s default reporter prefixes its totals with `ℹ`
(U+2139, three bytes), and Git Bash's grep here runs with byte semantics — so `^.` eats one byte of
that character and any pattern anchored that way matches nothing. Measured: `grep -E "^. (pass|fail) "`
finds 0 lines on a run that passed 554 tests. Every totals check in this plan therefore anchors on the
right instead: `grep -E " (tests|pass|fail) [0-9]+$"`. `^#` is wrong for a second reason — that is the
TAP reporter's prefix, not the spec reporter's.

**One measurement already taken,** so Task 7 has a known-good expectation: scoping the route scan to
the §7 table yields exactly 22 routes on both sides with no difference either way. Scanning the whole
conventions file instead yields 28 and would go red — §10.1 mentions `GET /owners/1` as an example and
§11 writes the delete routes as `DELETE /pets/{id}`. **The scan must be scoped to the route table.**

## Where this plan sits in the larger sequence

This plan is phase A. It must run **before** the framework is reset, and that ordering is a hard
constraint, not a preference.

```
PHASE A — this plan, tasks 1-14                                   no money
  the harness: invariants, gates, unit tests OF THE HARNESS
  calibrated against the ACCEPTED scaffold — D-30 needs it present
        │
        │   the accepted framework/ is the reference for "is this invariant
        │   correctly calibrated". Reset it first and the reference is gone.
        ▼
PHASE B — full regeneration                                       COSTS MONEY
  node scripts/reset-run.mjs --yes      (deletes framework/ entirely)
  npm run ralph -- --stage scaffold     (stage 0 rebuilds it, now WITH the
                                         unit tests and the canary, because
                                         the manifest and the tracker ask for them)
        ▼
PHASE C — test generation                                         COSTS MONEY
  npm run ralph -- --stage tests --flow F-01 → F-02 → F-03
        ▼
PHASE D — end-to-end acceptance
  design-document criteria 4, 5, 7 + npm run control
```

Two consequences for this plan:

- **Criteria 4, 5 and 7 of the design document cannot be met by phase A.** They need a regenerated
  framework. Task 14 groups the criteria accordingly rather than pretending all seven are checkable
  now.
- **`npm run check:scaffold` will be red at the end of phase A**, naming four files the accepted
  scaffold does not contain. That is correct: the manifest now states a requirement that predates the
  scaffold on disk, and phase B is what satisfies it.
- **But the harness suite is NOT insulated from a manifest change, contrary to what this plan first
  claimed.** `tests/check-scaffold.test.mjs` builds its own temporary trees — true of the tree, false
  of the manifest: it imports `SCAFFOLD_MANIFEST` and `entriesThroughRow` and pins the entry count in
  five places, and `tests/manifest.test.mjs` pins three more. Measured in Task 2: two new entries
  produced **7 failures in `check-scaffold.test.mjs` and 3 in `manifest.test.mjs`**. Every task that
  adds a manifest entry must therefore move those pinned numbers — Task 2 and Task 12 both do.

---

**`grep -c $'\r' file` reports 0 on a file that is entirely CRLF** — Git Bash reads in text mode and
strips them before grep sees them. Use `tr -cd '\r' | wc -c` to count carriage returns.

**Do not paste these code blocks into a `bash -e` one-liner either.** They are full of backticks, and
the shell executes them: measured, a fixture pasted that way produced `POST: command not found` and a
route set of size 0. Put such a probe in a file and run the file.

**Do not write these code blocks with a bash heredoc.** Several of them contain `\\` inside a
regex or a template literal, and a quoted heredoc (`<<'EOF'`) collapses it to a single backslash.
Measured in Task 5: `'\\$&'` became `'\$&'` and `` `\\b${quote(port)}\\b` `` became a literal
backspace character, producing `SyntaxError: Invalid regular expression: missing /`. Use the Write or
Edit tool, and run `node --check` on every file you create.

## I6 lost its count half — measured, in Task 8

I6 counted step BINDINGS and compared them to the §7 route count. Measured on the accepted scaffold:
97 bindings (9 Given / 36 When / 52 Then), not 22. Two independent reasons the count cannot work:

1. **D-13 says 22 _request_ steps**, and request steps are a subset. The 52 `Then` bindings are
   assertion steps; their number is not a function of the route count at all.
2. **The quantity changes between stages.** Stage 0 builds the request steps; stage 1 adds the
   assertion steps as it writes scenarios. So a step count is ~22-ish at the end of stage 0 and 97
   after stage 1 — no single number is both green on the accepted tree (D-30) and meaningful inside
   the stage-0 gate.

And the coverage claim it was reaching for is **already made, twice**: I3 proves all 22 routes of §7
are called by a service, and I5 proves every service method is reachable from a step definition.
Together those say "every route of the contract is reachable from a scenario", which is the property
that matters. The raw binding count says nothing.

So I6 keeps only its duplicate half.

---

## Execution order — not the numbering

The tasks are numbered by subject, but they must be **run** in this order:

```
1 → 2 → 3 → 5 → 6 → 7 → 8 → 9 → 4 → 10 → 11 → 12 → 13 → 14
        └──────────────────┘
        the invariants and their CLI come before Task 4
```

**Why.** Task 3 puts a `check:invariants` step into the scaffold gate, and `tests/ralph.test.mjs`
drives the real runner in a temporary clone — so that gate **executes**, and the step must exist.
Measured after Task 3 landed: three tests in `tests/ralph.test.mjs` failed with
`Cannot find module ...\scripts\check-invariants.mjs`, and every one of them went green the moment a
stub was dropped in. Tasks 5–9 are what create the real thing.

So between Task 3 and Task 9 the suite is **562 pass / 3 fail**, and those three reds are expected.
They are named here so nobody spends an afternoon on them. Every other task keeps the suite green, and
`fail 0` remains the check after each one.

Task 4 is deferred behind Task 9 only because it also touches `loop/gates.mjs`; running it while three
runner tests are red would make its own verification unreadable.

---

## File Structure

| File | Responsibility |
|---|---|
| `.gitattributes` | **Create.** Normalise line endings so multi-line fixtures behave the same on every checkout. |
| `tests/check-spec.test.mjs` | **Modify.** `edit()` normalises line endings before matching. |
| `scripts/manifest.scaffold.mjs` | **Modify.** Derived helpers (`rowOwning`, `rowNeeds`, `featureSkeletonEntries`), two path constants, the new unit-test and canary entries, and one changed probe. Stays pure data. |
| `loop/gates.mjs` | **Modify.** The scaffold gate composes its steps from the manifest; a pure `skipPreGate` predicate. No filesystem access (D-22). |
| `loop/ralph.mjs` | **Modify.** Remembers the last green gate's SHA and consults `skipPreGate`; keeps the agent turn's usage. |
| `loop/telemetry.mjs` | **Modify.** The run summary gains the agent's tokens and cost beside the judge's. |
| `loop/config.mjs` | **Modify.** The default `AGENT_CMD` asks for `stream-json`, which is what makes that cost readable. |
| `scripts/invariants.mjs` | **Create.** Pure functions over file contents. One export per invariant. No I/O, no `process.exit`. |
| `scripts/check-invariants.mjs` | **Create.** The CLI: resolves which invariants are in scope, reads files, reports through `Verdict`. |
| `tests/invariants.test.mjs` | **Create.** Unit tests for every pure function, each with its negative control. |
| `tests/check-invariants.test.mjs` | **Create.** Integration: the real CLI against the real tree exits 0; `--through-row` narrows the set. |
| `tests/manifest.test.mjs` | **Modify.** Pins the new helpers, the new entries, and the skeleton derivation. |
| `loop/invoke.mjs` | **Modify.** The generated target section tells a tests turn it may create a missing feature file. |
| `tests/invoke.test.mjs` | **Modify.** Pins that sentence, and that the feature path is still named. |
| `tests/gates.test.mjs` | **Modify.** Pins the composition and order of the new scaffold gate, and `skipPreGate`. |
| `loop/trackers/scaffold.md` | **Modify.** Carries the new requirements as DoD text for rows S4, S6, S10, S13 and S14 — this is where stage 0 reads them. |

`scripts/flows.mjs` is **not** modified. It already holds the flow list, and Task 10 makes the rest of
the system derive from it — which is the point: after that task, a new flow is one line *there* and
nothing anywhere else.

**Nothing under `framework/` is a deliverable of this plan.** That directory is stage 0's *output*:
`scripts/reset-run.mjs` deletes it whole, and the next full run regenerates it. Tasks 11 and 12 do
write files there — as short-lived **prototypes**, to prove a requirement is satisfiable before it is
declared — and then delete them again. What survives is the requirement, in the manifest and the
tracker.

| Prototyped, then deleted | Proves |
|---|---|
| `framework/.../Tests/Unit/ApiResponseTests.cs` | that `EnsureStatus` really does put the body in its message (rubric check 9 asserts it by reading) |
| `framework/.../Tests/Unit/UniqueDataTests.cs` | the four `UniqueData` constraints hold at runtime |
| `framework/.../Tests/Smoke/F00-framework-wiring.feature` + `Data/F00-framework-wiring.json` + one temporary line in `TestData/TestDataProvider.cs` | that Reqnroll picks up a feature outside `Features/`, that `@F00`/`@AC-F00-01` resolve, and that the canary goes red when the container is broken |
| `framework/.../TestData/TestDataProvider.cs` (Task 10) | that a data file can be found by its flow tag instead of from a closed map — all 23 tests still pass, and a missing file fails loudly |

---

## Task 1: Green baseline — line endings

`node --test` is currently **553 pass, 1 fail**. `tests/check-spec.test.mjs:719` searches for a
multi-line string written with `\n` while the file on disk has CRLF (`core.autocrlf=true`, no
`.gitattributes`). Until this is green there is no baseline to measure the experiment against.

**Files:**
- Create: `.gitattributes`
- Modify: `tests/check-spec.test.mjs`

- [ ] **Step 1: Reproduce the failure**

Run: `node --test tests/check-spec.test.mjs`

Expected: FAIL, with
`AssertionError: mutation target appears 0 times in flows/F-02-owner-pet-lifecycle.md, expected 1`

- [ ] **Step 2: Create `.gitattributes`**

Create `.gitattributes` at the repository root:

```gitattributes
# Line endings, declared rather than inherited from the operator's git config.
#
# This repository has no .gitattributes and `core.autocrlf=true` is the Windows default, so a fresh
# checkout gives .md and .mjs files CRLF endings while every fixture in tests/ is written with \n.
# Measured: tests/check-spec.test.mjs:719 searched for a three-line block and matched it 0 times.
# `loop/judge-eval.mjs` already normalises CRLF by hand for exactly this reason.
#
# `text=auto eol=lf` checks these files out with LF on every platform. Git still stores LF either way,
# so this changes the working tree, not history.
*.md    text eol=lf
*.mjs   text eol=lf
*.json  text eol=lf
*.yaml  text eol=lf
*.yml   text eol=lf

# The C# project is edited in Visual Studio on Windows; leave it to the platform default.
*.cs        text
*.csproj    text
*.sln       text
*.props     text
*.feature   text
```

- [ ] **Step 3: Verify `.gitattributes` will apply, without touching the index**

`.gitattributes` is PREVENTION — it decides what a *future* checkout writes to disk. It does not
rewrite the files already on disk, so it cannot be what makes the red test green today. Verify it the
way it actually works:

```bash
git check-attr text eol -- docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md
```

Expected:

```
docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md: text: set
docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md: eol: lf
```

**Do not run `git add --renormalize .`.** It rewrites the *index*, not the working tree, so the files
on disk keep their CRLF endings until a checkout — and the standard follow-up (`git rm --cached -r .`
then `git reset --hard`) both needs a commit and uses `git reset`, which `.claude/settings.json`
denies. In a no-commit workflow it would stage the whole tree and buy nothing. The fix for the red
test is Step 4.

- [ ] **Step 4: Make `edit()` independent of line endings — this is the actual fix**

A fixture that only works under one line-ending convention is a latent trap regardless of
`.gitattributes`, and `loop/judge-eval.mjs` already carries this exact guard for this exact reason. In
`tests/check-spec.test.mjs`, replace the `edit` helper:

```javascript
/** Replace once in a file under the copy, asserting the target was actually there. */
function edit(spec, relative, from, to) {
  const path = join(spec, relative);
  // Line endings normalised before matching, not after. This repository has `core.autocrlf=true`,
  // so a checkout without .gitattributes gives these files CRLF while the search strings below are
  // written with \n — measured, a three-line target then matched 0 times and the test failed on a
  // machine difference rather than on a behaviour difference. `loop/judge-eval.mjs` normalises for
  // exactly this reason; this is the second site that needed it.
  const text = readFileSync(path, 'utf8').split('\r\n').join('\n');
  const count = text.split(from).length - 1;
  assert.equal(count, 1, `mutation target appears ${count} times in ${relative}, expected 1`);
  writeFileSync(path, text.replace(from, to));
}
```

- [ ] **Step 5: Run the failing test to verify it now passes**

Run: `node --test tests/check-spec.test.mjs`
Expected: PASS

- [ ] **Step 6: Confirm the files on disk are still CRLF — that is what makes step 5 a proof**

`.gitattributes` has not rewritten anything on disk, so the test in step 5 ran against exactly the
endings that used to break it. Show that:

```bash
node -e "const t=require('fs').readFileSync('docs/specs/petclinic/flows/F-02-owner-pet-lifecycle.md','utf8');console.log(/\r\n/.test(t)?'CRLF':'LF')"
```

Expected: `CRLF`

So the guard holds under the convention that broke it, and `.gitattributes` will give a future clone
LF. The test no longer depends on which one it gets — which is the point.

- [ ] **Step 7: Run the whole harness suite**

Run: `node --test`
Expected: `pass 554`, `fail 0`

- [ ] **Step 8: Check the README's claim is now true**

`README.md` says `**554**, all green` under "Tests of the harness itself". That number is now true.
Leave the table alone, but verify it matches:

Run: `node --test 2>&1 | grep -E " (tests|pass|fail) [0-9]+$"`
Expected: `tests 554`, `pass 554`, `fail 0`

- [ ] **Step 9: Prepare the commit — do not run it**

```bash
git add .gitattributes tests/check-spec.test.mjs
git commit -m "test: a checkout's line endings must not decide whether a test passes"
```

Show `git status --porcelain` and `git diff --stat` to the user and stop.

---

## Task 2: Manifest helpers — which rows need which gate steps

The stage-0 gate needs to know "does the suite hold any tests yet at this row". The design forbids a
hard-coded wave number (D-21) and forbids filesystem access in `gates.mjs` (D-22), so the answer is
derived from the manifest, which already knows which row owns which file.

**Files:**
- Modify: `scripts/manifest.scaffold.mjs`
- Modify: `tests/manifest.test.mjs`
- Modify: `tests/check-scaffold.test.mjs` — it pins the manifest's entry count; see step 6b
- Modify: `loop/trackers/scaffold.md`

- [ ] **Step 1: Write the failing tests**

Append to `tests/manifest.test.mjs`:

```javascript
// ── Which rows need which gate steps (design 2026-08-20 §7.1, D-21) ──────────────────
//
// `loop/gates.mjs` composes the stage-0 gate from these two helpers rather than from a wave number.
// A wave number would be a magic constant in two files; the manifest already knows which row owns
// the smoke suite, so the boundary follows the manifest and moves with it.

test('rowOwning names the row that builds a manifest path, and null for anything else', () => {
  assert.equal(rowOwning(SMOKE_SUITE_ENTRY), 'S14');
  assert.equal(rowOwning(UNIT_TEST_ENTRY), 'S4');
  assert.equal(rowOwning('framework/src/PetClinic.ApiTests/Nope.cs'), null);
});

test('the two entry constants are real manifest paths, not strings that merely look like them', () => {
  // A constant that had drifted from the manifest would make `rowOwning` return null, and `rowNeeds`
  // would then answer "no row needs this step" for every row — a gate quietly missing a step.
  for (const path of [SMOKE_SUITE_ENTRY, UNIT_TEST_ENTRY]) {
    assert.ok(
      SCAFFOLD_MANIFEST.some((entry) => entry.path === path),
      `${path} is not in the manifest`
    );
  }
});

test('rowNeeds is true from the owning row onward and false before it', () => {
  assert.equal(rowNeeds('S13', SMOKE_SUITE_ENTRY), false);
  assert.equal(rowNeeds('S14', SMOKE_SUITE_ENTRY), true);
  assert.equal(rowNeeds('S1', UNIT_TEST_ENTRY), false);
  assert.equal(rowNeeds('S4', UNIT_TEST_ENTRY), true);
  assert.equal(rowNeeds('S14', UNIT_TEST_ENTRY), true);
});

test('rowNeeds fails closed on an unknown row or an unknown path', () => {
  // Null, never false. False would read as "this row does not need the step", which is a gate with a
  // step silently missing; null makes the caller say so in its own words.
  assert.equal(rowNeeds('S99', SMOKE_SUITE_ENTRY), null);
  assert.equal(rowNeeds('S14', 'framework/src/PetClinic.ApiTests/Nope.cs'), null);
});

test('the smoke suite is the last row of the stage, so no pre-gate ever has tests to run', () => {
  // This is what lets the scaffold PRE-gate drop `sut reset` and `dotnet test` outright: a pre-gate
  // asks about strictly earlier waves, and the only row that brings tests is the final one.
  assert.equal(rowOwning(SMOKE_SUITE_ENTRY), SCAFFOLD_ROWS[SCAFFOLD_ROWS.length - 1]);
});
```

Extend the existing import at the top of `tests/manifest.test.mjs` so these names resolve:

```javascript
import {
  SCAFFOLD_MANIFEST,
  SCAFFOLD_ROWS,
  entriesThroughRow,
  rowOwning,
  rowNeeds,
  SMOKE_SUITE_ENTRY,
  UNIT_TEST_ENTRY,
} from '../scripts/manifest.scaffold.mjs';
```

If `tests/manifest.test.mjs` already imports some of these, merge rather than duplicating the import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/manifest.test.mjs`
Expected: FAIL — `SyntaxError: The requested module ... does not provide an export named 'rowOwning'`

- [ ] **Step 3: Add the two unit-test entries to the manifest**

In `scripts/manifest.scaffold.mjs`, insert these two entries. Put the `ApiResponseTests.cs` entry
directly after the `Http/ApiResponse.cs` entry (row S4), and the `UniqueDataTests.cs` entry directly
after the `Support/UniqueData.cs` entry (row S6), so each test sits beside the file it tests:

```javascript
  // The unit test for the file above. S4's DoD makes EnsureStatus's message load-bearing -- every one
  // of the twenty scenarios routes its status checks through it -- and until this entry existed that
  // property was checked by a judge reading code rather than by anything running.
  {
    path: p('Tests/Unit/ApiResponseTests.cs'),
    row: 'S4',
    wave: 3,
    probes: [/EnsureStatus/, /RawContent/, /Category\("Unit"\)/],
  },
```

```javascript
  // S6's DoD says in as many words that "unit checks prove" these constraints. They did not exist.
  {
    path: p('Tests/Unit/UniqueDataTests.cs'),
    row: 'S6',
    wave: 5,
    probes: [/Telephone/, /LastName/, /InvariantCulture|uk-UA/, /Category\("Unit"\)/],
  },
```

- [ ] **Step 4: Add the constants and the two helpers**

Append to `scripts/manifest.scaffold.mjs`, after `entriesThroughRow`:

```javascript
/**
 * The manifest path that first brings EXECUTABLE tests into the suite, and the one that first brings
 * unit tests. Named here rather than in `loop/gates.mjs` because the manifest is what knows which row
 * builds them, and a second copy of the path is a second thing to keep in step.
 */
export const SMOKE_SUITE_ENTRY = p('Tests/Smoke/FrameworkSmokeTests.cs');
export const UNIT_TEST_ENTRY = p('Tests/Unit/ApiResponseTests.cs');

/**
 * The tracker row that builds `path`, or `null` when the manifest does not know the path.
 *
 * `null` rather than a throw, and never a guess: the caller is composing a gate, and it must be able
 * to say "the manifest does not know this file" in its own words instead of receiving a stack trace
 * or, worse, a boolean that reads as "no row needs this step".
 */
export function rowOwning(path) {
  return SCAFFOLD_MANIFEST.find((entry) => entry.path === path)?.row ?? null;
}

/**
 * Whether `rowId` comes at or after the row that builds `entryPath` — i.e. whether that file exists
 * once this row's turn is finished.
 *
 * This is how the stage-0 gate decides which steps to run: `dotnet test` is pointless while the suite
 * holds no tests, and the stage-0 prompt says so itself ("reporting zero tests is a pass"). Measured
 * before this existed: ~25 of ~27 gate runs restarted Docker and ran a suite of zero tests.
 *
 * `null` when either side is unknown, for the reason `rowOwning` returns null: a gate step must never
 * go missing because a lookup quietly answered "no".
 */
export function rowNeeds(rowId, entryPath) {
  const owner = rowOwning(entryPath);
  if (owner === null) return null;

  const target = SCAFFOLD_ROWS.indexOf(rowId);
  const boundary = SCAFFOLD_ROWS.indexOf(owner);
  if (target === -1 || boundary === -1) return null;

  return target >= boundary;
}
```

- [ ] **Step 5: Run the tests and expect THREE failures, not one**

Run: `node --test tests/manifest.test.mjs`
Expected: FAIL, `tests 25 / pass 22 / fail 3`. Measured, and all three are the same fact seen from
three angles — the manifest grew by two entries and three assertions still hold the old numbers:

| Failure | Why |
|---|---|
| `the manifest covers every file design §4 assigns to stage 0` — `41 !== 39` | the pinned length |
| `the tracker and the manifest agree, path for path` | the tracker does not name the two new files yet — **step 6 fixes this one** |
| `entriesThroughRow returns that row and every row before it` — `22 !== 20` | S6 now owns one more file, S7 one more before it |

Only the middle one is a real disagreement. The other two are numbers that must move with the
manifest, and step 6a moves them.

- [ ] **Step 6: If step 5 reported a tracker disagreement, add the files to the tracker's DoD**

In `loop/trackers/scaffold.md`, extend the two task detail sections' **Files** lines:

- under `### S4 — HTTP core`, append `, `PROJECT/Tests/Unit/ApiResponseTests.cs`` to the Files list;
- under `### S6 — UniqueData`, change the Files line to
  `**Files:** `PROJECT/Support/UniqueData.cs`, `PROJECT/Tests/Unit/UniqueDataTests.cs``.

Re-run: `node --test tests/manifest.test.mjs`
Expected: PASS

- [ ] **Step 6a: Move the counts `tests/manifest.test.mjs` pins**

In `tests/manifest.test.mjs`, update every number that counted the old 39 entries:

| What | From | To |
|---|---:|---:|
| `SCAFFOLD_MANIFEST.length` assertion | 39 | 41 |
| the test title `…naming 39 files` | 39 | 41 |
| the `named` count in that test | 39 | 41 |
| `entriesThroughRow('S6')` length | 20 | 22 |
| `entriesThroughRow('S7')` length | 21 | 23 |

One comment in that file also reads "all 39" — make it 41, and where it says S6 owns "one file" it now
owns two.

Run: `node --test tests/manifest.test.mjs`
Expected: `tests 25 / pass 25 / fail 0`

- [ ] **Step 6b: Move the counts `tests/check-scaffold.test.mjs` pins**

This file is **not** insulated from the manifest, and the plan originally claimed it was. It imports
`SCAFFOLD_MANIFEST` and `entriesThroughRow`, and pins the counts the CLI prints. Measured: two new
entries produce **7 failures** here.

Two changes:

1. Add the two new paths to that file's `FILES` fixture, with the cheapest content satisfying the new
   probes — the convention the file already states for its own fixture. The probes are
   `/EnsureStatus/`, `/RawContent/`, `/Category\("Unit"\)/` for `ApiResponseTests.cs`, and
   `/Telephone/`, `/LastName/`, `/InvariantCulture|uk-UA/`, `/Category\("Unit"\)/` for
   `UniqueDataTests.cs`. Each fixture file must also clear the 40-byte floor.
2. Move the five pinned counts: rows S1..S6 `20 → 22`, waves 1..5 `22 → 24`, rows S1..S7 `21 → 23`,
   waves 1..4 `19 → 20`, and `all 39` → `all 41` in both the test title and the output regex.

Run: `node --test tests/check-scaffold.test.mjs`
Expected: `fail 0`

- [ ] **Step 7: Run the whole suite**

Run: `node --test`
Expected: `fail 0`

- [ ] **Step 8: Prepare the commit — do not run it**

```bash
git add scripts/manifest.scaffold.mjs tests/manifest.test.mjs loop/trackers/scaffold.md \
        tests/check-scaffold.test.mjs
git commit -m "feat(manifest): derive which gate steps a scaffold row actually needs"
```

---

## Task 3: The scaffold gate stops running a suite that has no tests

**Files:**
- Modify: `loop/gates.mjs`
- Modify: `tests/gates.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/gates.test.mjs`:

```javascript
// ── The scaffold gate runs only the steps that can say something (design 2026-08-20 §7.1) ──

test('a scaffold row before the smoke suite gets no SUT reset and no test run', () => {
  // Tests appear only in the last row of the stage. Before it, `dotnet test` reports zero tests --
  // the stage-0 prompt calls that a pass -- and `sut reset` restarts Docker to make that possible.
  const steps = gateSteps('scaffold', { row: 'S6' }).map((step) => step.name);
  assert.deepEqual(steps, ['check:scaffold', 'dotnet build', 'check:invariants']);
});

test('the row that builds the smoke suite gets the SUT reset and the whole suite, in that order', () => {
  // D-09: the reset comes BEFORE the run, so a red test means "the test is bad" and not "the database
  // is dirty". The order is the reason these steps are declared as data.
  const steps = gateSteps('scaffold', { row: 'S14' }).map((step) => step.name);
  assert.deepEqual(steps, ['check:scaffold', 'dotnet build', 'check:invariants', 'sut reset', 'dotnet test']);
});

test('the first scaffold row runs neither unit tests nor the suite — neither exists yet', () => {
  const steps = gateSteps('scaffold', { row: 'S1' }).map((step) => step.name);
  assert.deepEqual(steps, ['check:scaffold', 'dotnet build', 'check:invariants']);
});

test('no scaffold gate runs any test before the suite has one — MEASURED, not assumed', () => {
  // Reqnroll generates an assembly-level [SetUpFixture] whose [OneTimeSetUp] calls
  // TestRunnerManager.OnTestRunStartAsync, which fires ScenarioHooks\ [BeforeTestRun] ->
  // ReadinessProbe.WaitUntilReady() with a 90 s budget. NUnit runs that fixture for ANY test run in
  // the assembly, so `dotnet test --filter TestCategory=Unit` waits for the SUT too. Measured with
  // Docker stopped: 96 s and RED, for a step meant to replace a ~50 s one.
  //
  // That is why no gate below S14 runs `dotnet test` in any form: before S14 there is no SUT step to
  // bring the container up, so every such gate would be red and three in a row end the run.
  for (const row of ['S1', 'S4', 'S6', 'S13']) {
    const steps = gateSteps('scaffold', { row }).map((step) => step.name);
    assert.ok(!steps.some((name) => name.startsWith('dotnet test')), `${row}: ${steps.join(', ')}`);
  }
});

test('check:invariants is scoped to the target row', () => {
  // Unscoped it is red by construction until the last row: I3 needs the services, I6 needs the steps.
  const check = gateSteps('scaffold', { row: 'S6' }).find((s) => s.name === 'check:invariants');
  const index = check.args.indexOf('--through-row');
  assert.ok(index !== -1, 'must pass --through-row');
  assert.equal(check.args[index + 1], 'S6');
});

test('the scaffold pre-gate never resets the SUT or runs the suite', () => {
  // A pre-gate asks about strictly EARLIER waves, and the only row that brings tests is the final
  // one -- so a scaffold pre-gate can never have a test to run. tests/manifest.test.mjs pins that.
  for (const wave of [1, 4, 7, 8]) {
    const steps = preGateSteps('scaffold', { wave }).map((step) => step.name);
    assert.ok(!steps.includes('sut reset'), `wave ${wave}: ${steps.join(', ')}`);
    assert.ok(!steps.includes('dotnet test'), `wave ${wave}: ${steps.join(', ')}`);
  }
});

test('the tests-stage pre-gate is untouched — it still resets before running', () => {
  assert.deepEqual(
    preGateSteps('tests', {}).map((step) => step.name),
    ['sut reset', 'dotnet build', 'dotnet test']
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/gates.test.mjs`
Expected: FAIL — the current scaffold gate returns
`['check:scaffold', 'dotnet build', 'sut reset', 'dotnet test']`

- [ ] **Step 3: Rewrite the scaffold branch of `gateSteps`**

In `loop/gates.mjs`, extend the import:

```javascript
import {
  SCAFFOLD_ROWS,
  SMOKE_SUITE_ENTRY,
  UNIT_TEST_ENTRY,
  rowNeeds,
} from '../scripts/manifest.scaffold.mjs';
```

Replace the `return [...]` inside `if (stage === 'scaffold')` with:

```javascript
    /*
     * Only the steps that can say something about THIS row.
     *
     * Tests enter the suite in the last row of the stage, so before it `dotnet test` reports zero
     * tests -- which the stage-0 prompt itself calls a pass -- and `sut reset` restarts Docker and
     * waits for readiness to make that possible. Measured: ~25 of ~27 stage-0 gate runs did exactly
     * that, at ~27 s of Docker restart and ~12 s of test host each.
     *
     * The boundary comes from the MANIFEST (`rowNeeds`), not from a wave number. A wave number would
     * be a magic constant here and in the manifest both, and this file stays pure data with no
     * filesystem access -- which is what makes the step ORDER unit-testable.
     */
    const needsSuite = rowNeeds(row, SMOKE_SUITE_ENTRY);
    if (needsSuite === null) {
      throw new Error(
        `gateSteps: the manifest cannot place row ${JSON.stringify(row)} against its test entries — ` +
          'SMOKE_SUITE_ENTRY or UNIT_TEST_ENTRY has drifted from the manifest'
      );
    }

    return [
      {
        name: 'check:scaffold',
        cmd: process.execPath,
        args: ['scripts/check-scaffold.mjs', '--through-row', row, '--quiet'],
      },
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      // Scoped like check:scaffold, and for the same reason: unscoped it is red by construction until
      // the last row, because I3 needs the services to exist and I5/I6 need the step definitions.
      {
        name: 'check:invariants',
        cmd: process.execPath,
        args: ['scripts/check-invariants.mjs', '--through-row', row, '--quiet'],
      },
      /*
       * No filtered unit run here, and that is a MEASURED correction rather than an omission.
       *
       * Reqnroll generates an assembly-level `[SetUpFixture]` (`obj/.../NUnit.AssemblyHooks.*.cs`)
       * whose `[OneTimeSetUp]` calls `TestRunnerManager.OnTestRunStartAsync`, which fires
       * `ScenarioHooks`'s `[BeforeTestRun]` -> `ReadinessProbe.WaitUntilReady()` on a 90 s budget.
       * NUnit runs that fixture for ANY test run in the assembly, so `--filter TestCategory=Unit`
       * waits for the SUT as well. Measured with Docker stopped: 96 s and RED.
       *
       * Worse, no gate below S14 has a `sut reset` step to bring the container up, so on a
       * from-scratch run every such gate would be red and `K_FAILURES=3` would end the run at S6.
       *
       * Task 11 turns the fix into a stage-0 requirement — readiness moves to `[BeforeScenario]`,
       * memoised, so a run with no scenarios never touches the network. Once a rebuilt framework
       * satisfies that, this step can come back, and `UNIT_TEST_ENTRY` is the boundary it will use.
       */
      // D-09: the reset before the run, so a red test means the test is bad rather than the database
      // being dirty.
      ...(needsSuite
        ? [
            { name: 'sut reset', cmd: process.execPath, args: ['scripts/sut.mjs', 'reset'] },
            { name: 'dotnet test', cmd: 'dotnet', args: ['test', SOLUTION, '--nologo'] },
          ]
        : []),
    ];
```

- [ ] **Step 4: Rewrite the scaffold branch of `preGateSteps`**

Replace the `return [...]` inside `preGateSteps`'s `if (stage === 'scaffold')` with:

```javascript
    return [
      // Nothing to check before wave 1 — it is the wave that creates the solution.
      ...(wave > 1
        ? [
            {
              name: 'check:scaffold (through the previous wave)',
              cmd: process.execPath,
              args: ['scripts/check-scaffold.mjs', '--through-wave', String(wave - 1), '--quiet'],
            },
          ]
        : []),
      { name: 'dotnet build', cmd: 'dotnet', args: ['build', SOLUTION, '--nologo'] },
      /*
       * No `sut reset` and no `dotnet test`, and that is not a shortcut.
       *
       * A pre-gate asks what is already complete, which is the waves BEFORE the target's own. The only
       * row that brings executable tests into the suite is the LAST row of the stage, so a scaffold
       * pre-gate can never have a test to run — tests/manifest.test.mjs pins that fact so this comment
       * cannot quietly stop being true. What remains is the question the pre-gate exists for: are the
       * finished waves' files there, and does the tree still compile.
       */
    ];
```

- [ ] **Step 5: Run the tests — and expect three PRE-EXISTING ones to have gone stale**

Run: `node --test tests/gates.test.mjs`
Expected: FAIL on **three tests this task invalidates and the plan first forgot to name**. All three
assert the old scaffold shape:

| Test | What to do |
|---|---|
| `the scaffold gate runs the manifest check, then build, then reset and test` | **Delete it.** It asserts row S1 → `[check:scaffold, dotnet build, sut reset, dotnet test]`, which is exactly what this task removes. The new test `the first scaffold row runs neither unit tests nor the suite` covers the same row with the right premise. |
| `the scaffold pre-gate checks through the PREVIOUS wave, not the target one` | Trim `'sut reset'` and `'dotnet test'` from its expectation; its own point (wave − 1) still stands. |
| `the scaffold pre-gate has no manifest check at all before wave 1` | Same trim, same reason. |

Then re-run. Expected: `tests 26 / pass 26 / fail 0`.

The gate tests pass even though `scripts/check-invariants.mjs` does not exist yet — `gateSteps`
returns step *descriptions* as data, so a missing script only matters when a gate executes.

Confirm with:

Run: `node --test tests/gates.test.mjs 2>&1 | grep -E " (pass|fail) [0-9]+$"`
Expected: `ℹ fail 0`

- [ ] **Step 6: Run the whole suite, and expect three reds that are not yours**

Run: `node --test 2>&1 | grep -E " (tests|pass|fail) [0-9]+$"`
Expected: `tests 565 / pass 562 / fail 3`

All three are in `tests/ralph.test.mjs`, and all three say the same thing:

```
--- check:invariants FAIL
Error: Cannot find module 'C:\...\Temp\ralph-…\scripts\check-invariants.mjs'
```

That file arrives in Task 9. `tests/ralph.test.mjs` drives the real runner in a temporary clone, so
the gate this task just changed actually runs there — see **Execution order** at the top of this
plan. Confirm the cause and move on; do **not** create the script here, it belongs to Task 9.

A cheap way to confirm nothing else is wrong, if you want it: drop a two-line stub at
`scripts/check-invariants.mjs` (`process.exit(0)`), re-run `node --test tests/ralph.test.mjs`,
expect `fail 0`, then **delete the stub**.

- [ ] **Step 7: Prepare the commit — do not run it**

```bash
git add loop/gates.mjs tests/gates.test.mjs
git commit -m "feat(loop): the scaffold gate stops running a suite that holds no tests"
```

---

## Task 4: The pre-gate is skipped when HEAD has not moved

After a green post-gate the tree has just been proven good. The next row's pre-gate asks about
strictly earlier waves on the same HEAD — a subset of what was proven — so re-running it buys nothing.

**Files:**
- Modify: `loop/gates.mjs`
- Modify: `loop/ralph.mjs`
- Modify: `tests/gates.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/gates.test.mjs`:

```javascript
// ── Skipping a pre-gate that would re-prove what the last one proved (D-23, D-24) ──────
//
// Pure, so the decision is tested rather than inferred from a paid run. Every "no" below is a gate
// that RUNS: this predicate may only ever answer yes when it is certain, because a pre-gate skipped
// when it was needed sends the agent onto a red foundation to debug someone else's problem.

test('the pre-gate is skipped only when the last green gate was this exact HEAD and nothing is dirty', () => {
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: 'abc123', dirty: false }), true);
});

test('a moved HEAD runs the gate', () => {
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: 'def456', dirty: false }), false);
});

test('a dirty tree runs the gate, even on a matching HEAD', () => {
  // Uncommitted work in framework/ is exactly what the gate would compile, and it is not what the
  // last green gate saw.
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: 'abc123', dirty: true }), false);
});

test('a fresh process runs the gate — there is no last green gate to lean on', () => {
  assert.equal(skipPreGate({ lastGreenSha: null, headSha: 'abc123', dirty: false }), false);
});

test('an unreadable or empty value on either side runs the gate', () => {
  // `git()` returns '' for a failure as well as for an empty result, so '' must never satisfy this.
  assert.equal(skipPreGate({ lastGreenSha: '', headSha: '', dirty: false }), false);
  assert.equal(skipPreGate({ lastGreenSha: 'abc123', headSha: '', dirty: false }), false);
  assert.equal(skipPreGate({ lastGreenSha: '', headSha: 'abc123', dirty: false }), false);
  assert.equal(skipPreGate({ lastGreenSha: undefined, headSha: 'abc123', dirty: false }), false);
});
```

Extend the import at the top of `tests/gates.test.mjs`:

```javascript
import { gateSteps, preGateSteps, runGate, skipPreGate } from '../loop/gates.mjs';
```

Keep whatever that line already imports; add `skipPreGate` to it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/gates.test.mjs`
Expected: FAIL — `does not provide an export named 'skipPreGate'`

- [ ] **Step 3: Add the predicate to `loop/gates.mjs`**

Append to `loop/gates.mjs`:

```javascript
/**
 * Whether the pre-gate can be skipped because the last green gate already proved this exact tree.
 *
 * A green POST-gate for row N checked the manifest through row N and compiled the tree. The pre-gate
 * for row N+1 asks for the manifest through the wave BEFORE N+1's own — strictly earlier rows — and
 * compiles the same tree. On an unmoved HEAD with nothing uncommitted under `framework/`, that is a
 * subset of what has just been proven, so running it again costs a build and answers nothing new.
 *
 * Pure, and it answers `false` for everything it is not certain about. Every input this cannot vouch
 * for — a fresh process with nothing remembered, an empty string from a failed `git` probe, a dirty
 * tree — RUNS the gate. A pre-gate skipped when it was needed sends the agent onto a red foundation,
 * which is the one thing the pre-gate exists to prevent.
 */
export function skipPreGate({ lastGreenSha, headSha, dirty } = {}) {
  if (dirty) return false;
  if (typeof lastGreenSha !== 'string' || lastGreenSha === '') return false;
  if (typeof headSha !== 'string' || headSha === '') return false;
  return lastGreenSha === headSha;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gates.test.mjs`
Expected: PASS

- [ ] **Step 5: Wire it into the runner**

In `loop/ralph.mjs`, extend the gates import:

```javascript
import { gateSteps, preGateSteps, runGate, skipPreGate } from './gates.mjs';
```

Immediately **above `preGate`'s own doc comment** — not between that comment and the function. Taken
literally, "above the definition" stacks two doc blocks and orphans `preGate`'s onto the new
variable, so the file reads as if "The gate on the CURRENT HEAD, before the agent is let in…"
documents a SHA. Add:

```javascript
/**
 * The HEAD the last gate proved green, or null. In memory on purpose.
 *
 * On disk this would also skip the first pre-gate of a RESUMED run — one gate per resume — at the
 * price of four failure branches (the file missing, unreadable, stale after a rebase, and its
 * interaction with `git clean`). A fresh process starts at null and simply runs the gate, which is
 * the conservative answer and needs no branches at all.
 */
let lastGreenSha = null;
```

Replace the body of `preGate` with:

```javascript
function preGate(row) {
  if (row.status === 'rework') return { green: true, failedAt: null, log: 'skipped — row is in rework' };
  if (!existsSync(SOLUTION)) return { green: true, failedAt: null, log: 'skipped — no solution yet' };

  /*
   * D-24: stage 0 only. On stage 1 the pre-gate also runs `sut reset`, and D-09 requires a clean
   * database before a run — skipping it there is a separate decision with a separate rationale.
   *
   * Both probes are `gitTry`, and a failure of either runs the gate: `git()` returns '' for a failed
   * command as well as for an empty result, and '' must never be able to satisfy a skip.
   */
  if (config.stage === 'scaffold') {
    const head = gitTry(ROOT, 'rev-parse', 'HEAD');
    const dirty = gitTry(ROOT, 'status', '--porcelain', '--untracked-files=normal', '--', ...WATCHED);
    if (
      head.ok &&
      dirty.ok &&
      skipPreGate({ lastGreenSha, headSha: head.out, dirty: dirty.out !== '' })
    ) {
      return {
        green: true,
        failedAt: null,
        log: `skipped — the last gate proved HEAD ${head.out.slice(0, 7)} green and nothing has moved`,
      };
    }
  }

  return runGate(preGateSteps(config.stage, { wave: waveOf(row) }), { root: ROOT, run });
}
```

- [ ] **Step 6: Record the SHA after a green gate**

In `loop/ralph.mjs`, find the line `failures = 0;` (immediately after the `if (failure) { … }` block)
and add below it. **The anchor is ambiguous:** `failures = 0;` matches two lines — the declaration
`let failures = 0;` among the runner's loop state, and the one inside the loop immediately after the
`if (failure) { … }` block. You want the second.

```javascript
  failures = 0;

  // The gate just proved this HEAD green, so the next iteration's pre-gate has nothing to add. Read
  // here rather than reused from `headBeforeTurn`, which is null on the `review` recovery path.
  if (config.stage === 'scaffold') {
    const headNow = gitTry(ROOT, 'rev-parse', 'HEAD');
    lastGreenSha = headNow.ok ? headNow.out : null;
  }
```

- [ ] **Step 6a: Make the skip visible**

`pre.log` is printed only on the red path (`if (!pre.green)`), so every skip message `preGate`
builds — "row is in rework", "no solution yet", and the new one — is constructed and thrown away.
Without a line, a run's timing is unexplainable: an operator cannot tell a gate that passed in
eleven seconds from one that never ran, and there is no evidence the optimisation fired at all.

Directly after the `if (!pre.green) { … stopRun(…) }` block — `stopRun` never returns, so anything
below it runs only on a green pre-gate — add:

```javascript
    if (pre.log.startsWith('skipped')) console.log(`ralph: pre-gate ${pre.log}`);
```

One line, and it covers all three skip reasons rather than only the new one.

- [ ] **Step 7: Verify the runner still parses and its dry run works**

Run:

```bash
node --check loop/ralph.mjs && npm run ralph -- --dry-run --stage scaffold
```

Expected: the dry-run block prints, ending with `Zero tokens spent.` and exit 0.

- [ ] **Step 8: Run the whole suite**

Run: `node --test`
Expected: `fail 0`

- [ ] **Step 9: Prepare the commit — do not run it**

```bash
git add loop/gates.mjs loop/ralph.mjs tests/gates.test.mjs
git commit -m "feat(loop): do not re-prove a HEAD the last gate already passed"
```

---

## Task 5: `scripts/invariants.mjs` — I1 (one HTTP client) and I2 (no hard-coded environment)

Pure functions over file contents, in the shape of `scripts/checks.mjs`: each returns a list of hits
`{ path, line, match }`. Nothing here reads a file or exits.

**Files:**
- Create: `scripts/invariants.mjs`
- Create: `tests/invariants.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/invariants.test.mjs`:

```javascript
// tests/invariants.test.mjs — the pure half of the stage-0 invariants.
//
// Every invariant gets a POSITIVE control (the shape the accepted scaffold actually uses must stay
// green) and a NEGATIVE control (an injected violation must go red). Both halves are required: a
// check that has never gone red proves nothing, and a check that goes red on accepted work is too
// strict and would stop a legitimate run. That is the lesson `scripts/mutation-control.mjs` records.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extraRestClients, hardCodedEnvironment } from '../scripts/invariants.mjs';

const CLIENT = 'framework/src/PetClinic.ApiTests/Http/ApiClient.cs';
const SERVICE = 'framework/src/PetClinic.ApiTests/Services/PetsService.cs';

// The project-specific half of I1 and I2, passed in rather than baked into the rules. The CLI supplies
// the same values from one place; see scripts/check-invariants.mjs.
const CLIENT_OPTS = { clientPath: 'Http/ApiClient.cs' };
const ENV_OPTS = { host: 'localhost', port: 9966 };

// ── I1: one RestClient, and it lives in ApiClient ────────────────────────────────────

test('I1 is green when the only RestClient is constructed inside ApiClient', () => {
  const sources = [
    { path: CLIENT, text: 'private static readonly RestClient Client = new RestClient(options);' },
    { path: SERVICE, text: 'public PetsService(ApiClient client) { _client = client; }' },
  ];
  assert.deepEqual(extraRestClients(sources, CLIENT_OPTS), []);
});

test('I1 goes red on a second RestClient in a service', () => {
  const sources = [
    { path: CLIENT, text: 'new RestClient(options);' },
    { path: SERVICE, text: 'private readonly RestClient _own = new RestClient("http://x");' },
  ];
  const hits = extraRestClients(sources, CLIENT_OPTS);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, SERVICE);
  assert.equal(hits[0].line, 1);
});

test('I1 goes red when ApiClient itself builds two clients', () => {
  // "One client for the whole run" is not "one construction site" — two instances inside ApiClient
  // still means the four services can be handed different ones.
  const sources = [{ path: CLIENT, text: 'new RestClient(a);\nnew RestClient(b);' }];
  const hits = extraRestClients(sources, CLIENT_OPTS);
  assert.equal(hits.length, 1, 'the second construction is the violation');
  assert.equal(hits[0].line, 2);
});

test('I1 allows whitespace between new and the type, because C# does', () => {
  const sources = [{ path: SERVICE, text: 'var c = new   RestClient(o);' }];
  assert.equal(extraRestClients(sources, CLIENT_OPTS).length, 1);
});

// ── I2: no hard-coded environment ────────────────────────────────────────────────────

test('I2 is green on a settings loader that reads the URL from configuration', () => {
  const sources = [
    { path: 'x/SettingsLoader.cs', text: 'settings.BaseUrl = configuration["baseUrl"]!;' },
  ];
  assert.deepEqual(hardCodedEnvironment(sources, ENV_OPTS), []);
});

test('I2 goes red on a literal base URL — TWICE, and that is the design', () => {
  // The rule is an alternation of host OR port, because either one alone pins the framework to a
  // machine. This fixture carries both, so it produces two hits — measured. One-hit-per-line was
  // rejected deliberately: it would hide a hard-coded port sitting next to a host that is fine.
  const sources = [{ path: 'x/SettingsLoader.cs', text: 'var url = "http://localhost:9966/petclinic/api";' }];
  const hits = hardCodedEnvironment(sources, ENV_OPTS);
  assert.equal(hits.length, 2);
  assert.match(hits[0].match, /localhost/);
  assert.match(hits[1].match, /9966/);
});

test('I2 goes red on the port alone, and on https', () => {
  assert.equal(hardCodedEnvironment([{ path: 'a.cs', text: 'const int Port = 9966;' }], ENV_OPTS).length, 1);
  assert.equal(hardCodedEnvironment([{ path: 'a.cs', text: '"https://localhost/x"' }], ENV_OPTS).length, 1);
});

test('I2 does not fire on the word localhost inside a comment about configuration', () => {
  // Leaning open here is deliberate: a comment cannot reach the network, and a false red costs a
  // legitimate turn. A literal URL in code is what I2 is for, and that still fires above.
  const sources = [{ path: 'a.cs', text: '// the base URL is not localhost by default' }];
  assert.deepEqual(hardCodedEnvironment(sources, ENV_OPTS), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/invariants.test.mjs`
Expected: FAIL — `Cannot find module ... scripts/invariants.mjs`

- [ ] **Step 3: Create `scripts/invariants.mjs` with I1 and I2**

```javascript
// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The rules about the framework AS A WHOLE, written as code instead of prose.
//
// Each function here answers one question that cannot be answered by looking at a single
// file in isolation: is there exactly one HTTP client, is every route of the contract
// really wired up, is every service method actually used by a test step. Until these
// existed, all of them were questions put to an AI grader — which was shown one file at a
// time and therefore could not answer them.
//
// Everything here is a pure function over file contents: no reading, no writing, no
// exiting. That is what makes each rule testable both ways — green on the code that was
// accepted, red on a deliberate violation.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/invariants.mjs — the cross-cutting invariants of the stage-0 scaffold, as pure functions.
//
// Same shape as scripts/checks.mjs: every export takes text (or a list of `{ path, text }`) and
// returns a list of hits. The CLI that reads files and decides an exit code is
// scripts/check-invariants.mjs; keeping the two apart is what lets tests/invariants.test.mjs give
// every rule a positive AND a negative control without a temporary directory.
//
// Each rule below says which way it leans when a regex cannot be sure. Failing CLOSED rejects correct
// work and costs an iteration; failing OPEN lets a defect through to the judge, which is the backstop.

/** Hits for a global regex over one source, with 1-based line numbers. */
function scan(path, text, pattern) {
  const hits = [];
  (text ?? '').split('\n').forEach((line, index) => {
    for (const m of line.matchAll(pattern)) {
      hits.push({ path, line: index + 1, match: m[0].trim() });
    }
  });
  return hits;
}

/** The same, over a list of `{ path, text }`. */
const scanAll = (sources, pattern) =>
  (sources ?? []).flatMap((source) => scan(source.path, source.text, pattern));

// `new` and the type may be separated by any whitespace — `new   RestClient(o)` is legal C#.
const REST_CLIENT = /\bnew\s+RestClient\s*\(/g;

/**
 * Every construction of a `RestClient` beyond the first one inside `Http/ApiClient.cs` — I1.
 *
 * Rubric check 1 of the stage-0 judge, which could never answer it from one row's diff: when S4 is
 * graded the services do not exist, and when S5 is graded `ApiClient` is not in the diff. The
 * property is about the whole tree, so it belongs to a check that sees the whole tree.
 *
 * The FIRST construction inside ApiClient is the legitimate one; everything else is a hit, including
 * a second one inside ApiClient itself. "One client for the whole run" is not "one construction
 * site": two instances there still lets the four services be handed different ones.
 */
export function extraRestClients(sources, { clientPath } = {}) {
  // A PARAMETER, not a literal. The rule "exactly one client, and it lives in the one place that owns
  // it" is not specific to this project; the path is. Keeping the path out here is what lets the same
  // rule be pointed at another framework by changing one call site rather than editing the rule.
  if (typeof clientPath !== 'string' || clientPath === '') {
    throw new Error('extraRestClients: clientPath is required — it names the file allowed to construct one');
  }

  const all = scanAll(sources, REST_CLIENT);
  const legitimate = all.find((hit) => hit.path.endsWith(clientPath));
  return all.filter((hit) => hit !== legitimate);
}

/** A regex-safe copy of a literal. A host may carry a dot; a port may not, but symmetry is cheaper. */
const quote = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The host and the port, separately. Either one alone pins the framework to a machine.
 *
 * PARAMETERS rather than literals, for the reason `clientPath` is one: the rule travels, the values do
 * not. `scripts/check-invariants.mjs` supplies the SUT's own host and port.
 *
 * Leans OPEN on comments: a `//` line is stripped before scanning, because a comment cannot reach the
 * network and a false red costs a legitimate turn. A literal in code still fires.
 */
const hardCodedPattern = ({ host, port }) =>
  new RegExp(`https?://${quote(host)}|\\b${quote(port)}\\b`, 'gi');

/**
 * Literal environment in C# source — I2.
 *
 * Rubric check 2. The base URL comes from `appsettings.json` through `SettingsLoader` and is
 * overridable by `PETCLINIC_BASE_URL`; a literal defeats both, and D-10 rests on the delivered
 * framework being runnable against a shared environment rather than nailed to one machine.
 */
export function hardCodedEnvironment(sources, { host, port } = {}) {
  if (!host || !port) {
    throw new Error('hardCodedEnvironment: host and port are required — they are the SUT\'s, not this rule\'s');
  }

  const withoutComments = (sources ?? []).map((source) => ({
    path: source.path,
    text: (source.text ?? '')
      .split('\n')
      .map((line) => (line.trim().startsWith('//') ? '' : line))
      .join('\n'),
  }));
  return scanAll(withoutComments, hardCodedPattern({ host, port }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/invariants.test.mjs`
Expected: PASS

- [ ] **Step 5: Prepare the commit — do not run it**

```bash
git add scripts/invariants.mjs tests/invariants.test.mjs
git commit -m "feat(checks): one HTTP client and no hard-coded environment, as executable rules"
```

---

## Task 6: I4 — the assembly is not parallelisable

**Files:**
- Modify: `scripts/invariants.mjs`
- Modify: `tests/invariants.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/invariants.test.mjs`:

```javascript
// ── I4: the assembly refuses parallel execution ──────────────────────────────────────

test('I4 is green on the attribute as the scaffold writes it', () => {
  assert.equal(hasNonParallelizable('[assembly: NonParallelizable]'), true);
});

test('I4 accepts the fully qualified and Attribute-suffixed spellings', () => {
  assert.equal(hasNonParallelizable('[assembly: NUnit.Framework.NonParallelizable]'), true);
  assert.equal(hasNonParallelizable('[assembly: NonParallelizableAttribute]'), true);
});

test('I4 goes red when the attribute is missing', () => {
  assert.equal(hasNonParallelizable('using NUnit.Framework;\n'), false);
});

test('I4 goes red when the attribute is only commented out', () => {
  // §10.7 forbids parallel execution: the tests share one database and count assertions would stop
  // being deterministic. A commented attribute is exactly the shape of that regression.
  assert.equal(hasNonParallelizable('// [assembly: NonParallelizable]'), false);
});
```

Extend the import in `tests/invariants.test.mjs`:

```javascript
import { extraRestClients, hardCodedEnvironment, hasNonParallelizable } from '../scripts/invariants.mjs';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/invariants.test.mjs`
Expected: FAIL — `does not provide an export named 'hasNonParallelizable'`

- [ ] **Step 3: Add I4 to `scripts/invariants.mjs`**

```javascript
/**
 * Whether the assembly declares itself non-parallelisable — I4.
 *
 * §10.7 forbids parallel execution: the tests share one database, so assertions on collection counts
 * would stop being deterministic. S11's DoD requires the attribute and nothing checked for it — not
 * the manifest, whose probe for `AssemblyInfo.cs` is coarse, and not the rubric, which has no item
 * for it.
 *
 * A commented-out attribute is NOT a hit, which is the whole point: `// [assembly: ...]` is the exact
 * shape this regression takes.
 */
export function hasNonParallelizable(text) {
  return (text ?? '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .some((line) => /\[\s*assembly\s*:\s*(?:[\w.]+\.)?NonParallelizable(?:Attribute)?\s*\]/.test(line));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/invariants.test.mjs`
Expected: PASS

- [ ] **Step 5: Prepare the commit — do not run it**

```bash
git add scripts/invariants.mjs tests/invariants.test.mjs
git commit -m "feat(checks): the assembly must declare itself non-parallelisable"
```

---

## Task 7: I3 — every route of the contract is wired up

The most valuable invariant, and the one that replaces the judge's most expensive question. Both
sides are machine-readable: the specification writes `` `POST /owners/{ownerId}/pets` `` in a markdown
table, and the services write `_client.Post<Pet>("owners/{ownerId}/pets", …)`.

**Measured before writing this task:** scoped to the §7 route table, both sides yield exactly 22
routes with no difference in either direction. Scanning the whole conventions file yields 28 and would
go red — §10.1 uses `GET /owners/1` as an illustration and §11 writes `DELETE /pets/{id}`. **The scan
must be scoped to the table.**

**Files:**
- Modify: `scripts/invariants.mjs`
- Modify: `tests/invariants.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/invariants.test.mjs`:

```javascript
// ── I3: the contract's routes and the code's routes are the same set ─────────────────

const CONVENTIONS = `
## 7. API conventions

### Routes and their asymmetry (the key to the integration scenarios)

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| \`Owner\` | \`POST /owners\` | \`GET /owners\`, \`GET /owners/{ownerId}\` | \`PUT /owners/{ownerId}\` | \`DELETE /owners/{ownerId}\` |
| \`Pet\` | **only** \`POST /owners/{ownerId}/pets\` | \`GET /pets\` | — | **only** \`DELETE /pets/{petId}\` |

### Data models (abridged; in full — in the contract)

An example elsewhere in the document: \`GET /owners/1\` proves nothing.
`;

test('I3 reads the route table and nothing else in the document', () => {
  // The conventions file mentions routes in §10.1 and §11 as well. Measured on the real file: the
  // whole-document scan finds 28 routes against the code's 22 and would go red on accepted work.
  const routes = routesInSpec(CONVENTIONS);
  assert.ok(routes.has('GET /owners/{ownerId}'));
  assert.ok(routes.has('DELETE /pets/{petId}'));
  assert.ok(!routes.has('GET /owners/1'), 'the illustration outside the table must not be a route');
  // Eight, not seven: the Owner row contributes five (POST, GET list, GET item, PUT, DELETE) and the
  // Pet row three (POST nested, GET list, DELETE) — its Update cell is a dash.
  assert.equal(routes.size, 8);
});

test('I3 returns null when the route table is not there at all', () => {
  // Fail-closed: the CLI turns null into a red gate naming the reason, never into an empty set that
  // would read as "the specification asks for no routes" and pass.
  assert.equal(routesInSpec('# A document with no route table\n'), null);
});

test('I3 reads the routes out of the services, verb from the method name', () => {
  const sources = [
    {
      path: 'Services/OwnersService.cs',
      text: [
        'public Task<ApiResponse<Owner>> Create(Owner o) => _client.Post<Owner>("owners", o);',
        'public Task<ApiResponse<List<Owner>>> GetAll() => _client.Get<List<Owner>>("owners");',
        'public Task<ApiResponse> Delete(int id) =>',
        '    _client.Delete("owners/{ownerId}", b => b.WithPathParam("ownerId", id));',
      ].join('\n'),
    },
  ];
  const routes = routesInCode(sources);
  assert.deepEqual(
    [...routes].sort(),
    ['DELETE /owners/{ownerId}', 'GET /owners', 'POST /owners']
  );
});

test('I3 survives a nested generic in the return type', () => {
  // `Get<List<Owner>>` has two closing angle brackets before the paren; a lazy pattern stops early.
  const sources = [{ path: 's.cs', text: '_client.Get<List<Owner>>("owners");' }];
  assert.deepEqual([...routesInCode(sources)], ['GET /owners']);
});

test('I3 reports a route the contract asks for and the code does not have', () => {
  const spec = new Set(['GET /owners', 'PUT /owners/{ownerId}']);
  const code = new Set(['GET /owners']);
  assert.deepEqual(routeDifference(spec, code), {
    missing: ['PUT /owners/{ownerId}'],
    extra: [],
  });
});

test('I3 reports a route the code has and the contract does not — divergence goes both ways', () => {
  // A missing route stalls a later AC; an extra one means the code and the specification have parted.
  const spec = new Set(['GET /owners']);
  const code = new Set(['GET /owners', 'GET /vets']);
  assert.deepEqual(routeDifference(spec, code), { missing: [], extra: ['GET /vets'] });
});

test('I3 is silent when the two sets agree', () => {
  const both = new Set(['GET /owners']);
  assert.deepEqual(routeDifference(both, new Set(both)), { missing: [], extra: [] });
});
```

Extend the import in `tests/invariants.test.mjs`:

```javascript
import {
  extraRestClients,
  hardCodedEnvironment,
  hasNonParallelizable,
  routesInSpec,
  routesInCode,
  routeDifference,
} from '../scripts/invariants.mjs';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/invariants.test.mjs`
Expected: FAIL — `does not provide an export named 'routesInSpec'`

- [ ] **Step 3: Add I3 to `scripts/invariants.mjs`**

```javascript
// A route as the specification writes it, inside backticks: `POST /owners/{ownerId}/pets`.
const SPEC_ROUTE = /`(GET|POST|PUT|DELETE)\s+(\/[A-Za-z0-9{}/_-]*)`/g;

// A route as a service calls it. The verb is the method name; the path is the first string argument
// and carries no leading slash. `(?:<[^(]*>)?` swallows a nested generic — `Get<List<Owner>>` has two
// closing brackets before the paren, and `[^(]` is what lets it reach the last of them.
const CODE_ROUTE = /_client\.(Get|Post|Put|Delete)\s*(?:<[^(]*>)?\s*\(\s*"([^"]+)"/g;

const ROUTE_TABLE_HEADING = '### Routes and their asymmetry';

/**
 * The routes the contract asks for — I3, the specification side. `null` when the table is absent.
 *
 * SCOPED TO THE TABLE, and that is not tidiness. Measured on the real conventions file: a
 * whole-document scan finds 28 routes against the services' 22, because §10.1 uses `GET /owners/1` as
 * an illustration of why a literal id proves nothing and §11 writes the delete routes as
 * `DELETE /pets/{id}`. Unscoped, this invariant would have gone red on the accepted scaffold — which
 * is the one thing a new check must not do.
 *
 * `null` rather than an empty set when the heading is gone: an empty set compares equal to nothing
 * missing, so a renamed heading would silently retire the check.
 */
export function routesInSpec(markdown) {
  const text = markdown ?? '';
  const start = text.indexOf(ROUTE_TABLE_HEADING);
  if (start === -1) return null;

  // From the heading to the next `###`, so the models table and the response-code table stay out.
  const rest = text.slice(start + ROUTE_TABLE_HEADING.length);
  const end = rest.indexOf('\n###');
  const table = end === -1 ? rest : rest.slice(0, end);

  return new Set([...table.matchAll(SPEC_ROUTE)].map((m) => `${m[1]} ${m[2]}`));
}

/** The routes the services actually call — I3, the code side. */
export function routesInCode(sources) {
  const routes = new Set();
  for (const source of sources ?? []) {
    for (const m of (source.text ?? '').matchAll(CODE_ROUTE)) {
      routes.add(`${m[1].toUpperCase()} /${m[2]}`);
    }
  }
  return routes;
}

/**
 * The two-way difference between what the contract asks for and what the code calls.
 *
 * BOTH directions, because they are different faults with the same cause. A route the contract names
 * and the code lacks stalls a later acceptance criterion — S5's DoD says "not almost all". A route
 * the code has and the contract does not means the two have parted, and the contract is the input the
 * whole run is graded against.
 */
export function routeDifference(spec, code) {
  return {
    missing: [...spec].filter((route) => !code.has(route)).sort(),
    extra: [...code].filter((route) => !spec.has(route)).sort(),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/invariants.test.mjs`
Expected: PASS

- [ ] **Step 5: Prove it against the real tree before wiring it anywhere**

D-30: an invariant that goes red on accepted work is loosened, not shipped. Write a throwaway probe:

```bash
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { routesInSpec, routesInCode, routeDifference } from './scripts/invariants.mjs';
const spec = routesInSpec(readFileSync('docs/specs/petclinic/context-and-conventions.md','utf8'));
const dir = 'framework/src/PetClinic.ApiTests/Services';
const code = routesInCode(readdirSync(dir).map((f) => ({ path: join(dir,f), text: readFileSync(join(dir,f),'utf8') })));
console.log('spec', spec.size, 'code', code.size, JSON.stringify(routeDifference(spec, code)));
"
```

Expected: `spec 22 code 22 {"missing":[],"extra":[]}`

If the numbers differ, stop and report — the invariant is wrong, not the scaffold.

- [ ] **Step 6: Prepare the commit — do not run it**

```bash
git add scripts/invariants.mjs tests/invariants.test.mjs
git commit -m "feat(checks): the contract's routes and the services' routes must be one set"
```

---

## Task 8: I5 and I6 — every service method is used, and no sentence is bound twice

**Files:**
- Modify: `scripts/invariants.mjs`
- Modify: `tests/invariants.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/invariants.test.mjs`:

```javascript
// ── I5: no service method that no step calls ─────────────────────────────────────────

const SERVICE_SOURCE = {
  path: 'Services/PetsService.cs',
  text: [
    'public sealed class PetsService',
    '{',
    '    public PetsService(ApiClient client) { _client = client; }',
    '    public Task<ApiResponse<List<Pet>>> GetAll() => _client.Get<List<Pet>>("pets");',
    '    public Task<ApiResponse> Delete(int petId) => _client.Delete("pets/{petId}");',
    '}',
  ].join('\n'),
};

test('I5 does not count a constructor as an unused method', () => {
  // A constructor has no return type, so `public\\s+<type>\\s+<name>(` cannot match it — the
  // exclusion is structural rather than a name comparison, and this test is what pins that.
  const steps = [{ path: 'StepDefinitions/PetSteps.cs', text: '_pets.GetAll(); _pets.Delete(id);' }];
  assert.deepEqual(unusedServiceMethods([SERVICE_SOURCE], steps), []);
});

test('I5 reports a service method no step definition calls', () => {
  // The route exists, the step does not, and the acceptance criterion that needs it stalls several
  // waves later with the agent looking like the culprit. S5's DoD: "a missing route stalls a later AC".
  const steps = [{ path: 'StepDefinitions/PetSteps.cs', text: '_pets.GetAll();' }];
  const hits = unusedServiceMethods([SERVICE_SOURCE], steps);
  assert.deepEqual(hits.map((h) => h.method), ['Delete']);
  assert.equal(hits[0].path, 'Services/PetsService.cs');
});

test('I5 is green when a method is called from any step file, not only its own', () => {
  const steps = [
    { path: 'StepDefinitions/A.cs', text: '_pets.GetAll();' },
    { path: 'StepDefinitions/B.cs', text: '_pets.Delete(id);' },
  ];
  assert.deepEqual(unusedServiceMethods([SERVICE_SOURCE], steps), []);
});

// ── I6: the step inventory is the size the contract implies, with no repeats ─────────

test('I6 is green on sentences that differ', () => {
  const sources = [
    { path: 'StepDefinitions/A.cs', text: '[When("an owner is registered")]\n[Then("it is there")]' },
  ];
  assert.deepEqual(stepInventoryProblems(sources), []);
});

test('I6 counts nothing — the accepted scaffold has 97 bindings, not 22', () => {
  // Measured. A count check here compared bindings to the §7 route count and reported
  // "97 step(s) declared, expected 22". D-13 means 22 *request* steps; the 52 Then bindings are
  // assertion steps, and stage 1 adds more of them — so the quantity is not route-derived and not
  // even stable between stages. I3 and I5 already prove the coverage the count was reaching for.
  const many = Array.from({ length: 97 }, (_, i) => `[When("step ${i}")]`).join('\n');
  assert.deepEqual(stepInventoryProblems([{ path: 'StepDefinitions/A.cs', text: many }]), []);
});

test('I6 reports two bindings of the same sentence under the same keyword', () => {
  const sources = [
    { path: 'StepDefinitions/A.cs', text: '[When("an owner is registered")]' },
    { path: 'StepDefinitions/B.cs', text: '[When("an owner is registered")]' },
  ];
  const problems = stepInventoryProblems(sources);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /an owner is registered/);
});

test('I6 allows the same sentence as Given and as When', () => {
  // Reqnroll's documented way to make one step serve as a precondition and as an action, and the
  // scaffold produces nine such pairs deliberately — measured, and every Given in the scaffold is a
  // re-binding of a sentence that is also a When. check-tests.mjs exempts the same shape.
  const sources = [
    { path: 'StepDefinitions/A.cs', text: '[Given("an owner is registered")]\n[When("an owner is registered")]' },
  ];
  assert.deepEqual(stepInventoryProblems(sources), []);
});
```

Extend the import in `tests/invariants.test.mjs` with `unusedServiceMethods` and
`stepInventoryProblems`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/invariants.test.mjs`
Expected: FAIL — `does not provide an export named 'unusedServiceMethods'`

- [ ] **Step 3: Add I5 and I6 to `scripts/invariants.mjs`**

At the top of the file, add the import that I6 reuses:

```javascript
import { extractSteps } from './steps-inventory.mjs';
```

Then append:

```javascript
/*
 * A public method declaration: `public <type> <Name>(`.
 *
 * A CONSTRUCTOR cannot match this, and that exclusion is structural rather than a name comparison.
 * `public\s+` consumes `public `, and the pattern then requires a type followed by whitespace before
 * the name — `public PetsService(` has nothing between them, so there is no match to reject. That is
 * worth knowing: a name-based exclusion would have to be kept in step with every renamed class.
 */
const PUBLIC_METHOD = /public\s+[^()\n]*?\s+([A-Za-z_]\w*)\s*\(/g;

/**
 * Service methods no step definition mentions — I5.
 *
 * Nothing checked this. The manifest asks whether `Services/*.cs` exist and hold a route or two; the
 * rubric asks whether every route of §7 is present. Neither asks whether a step can REACH the route,
 * and an unreachable route is a stage-1 turn that has no legal way to satisfy its acceptance
 * criterion — discovered many waves after the wave that caused it.
 *
 * Leans OPEN: a mention anywhere in any step file counts, with no attempt to resolve the receiver.
 * A stricter reading would need dataflow, and a false red here blocks correct work.
 */
export function unusedServiceMethods(serviceSources, stepSources) {
  const steps = (stepSources ?? []).map((source) => source.text ?? '').join('\n');
  const hits = [];

  for (const source of serviceSources ?? []) {
    for (const m of (source.text ?? '').matchAll(PUBLIC_METHOD)) {
      const method = m[1];
      if (!new RegExp(String.raw`\.\s*${method}\s*\(`).test(steps)) {
        hits.push({ path: source.path, method });
      }
    }
  }
  return hits;
}

/**
 * What is wrong with the step inventory — I6. An empty list means nothing is.
 *
 * S12 is the largest row of the stage — four files, `OwnerSteps.cs` alone is 709 lines — and no check
 * reached it: the manifest asks only that the four files exist and are non-trivial, and no rubric
 * item mentions them at all.
 *
 * There is NO count check here, and that is a measured decision rather than an omission. Counting
 * bindings and comparing them to the §7 route count gave 97 against 22 on the accepted scaffold:
 * D-13 says 22 *request* steps, and the 52 `Then` bindings are assertion steps whose number is not a
 * function of the routes. Worse, the quantity changes between stages — stage 1 adds assertion steps —
 * so no number is both green here and meaningful in the stage-0 gate. What the count was reaching for
 * is already proven by I3 (every §7 route is called by a service) and I5 (every service method is
 * reachable from a step).
 *
 * The same sentence bound as `[Given]` and as `[When]` is NOT a repeat: that is Reqnroll's documented
 * way to make one step serve as a precondition and as an action, the scaffold produces nine such pairs
 * on purpose, and `scripts/check-tests.mjs` exempts the identical shape.
 */
export function stepInventoryProblems(sources) {
  const steps = (sources ?? []).flatMap((source) =>
    extractSteps(source.text).map((step) => ({ ...step, path: source.path }))
  );
  const problems = [];

  const seen = new Map();
  for (const step of steps) {
    const key = `${step.kind} ${step.text}`;
    if (seen.has(key)) {
      problems.push(
        `[${step.kind}] "${step.text}" is bound twice — ${seen.get(key)} and ${step.path}`
      );
    } else {
      seen.set(key, step.path);
    }
  }

  return problems;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/invariants.test.mjs`
Expected: PASS

- [ ] **Step 5: Prove both against the real tree (D-30)**

```bash
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unusedServiceMethods, stepInventoryProblems } from './scripts/invariants.mjs';
const read = (d) => readdirSync(d).filter((f) => f.endsWith('.cs')).map((f) => ({ path: join(d,f), text: readFileSync(join(d,f),'utf8') }));
const P = 'framework/src/PetClinic.ApiTests';
console.log('I5:', JSON.stringify(unusedServiceMethods(read(P+'/Services'), read(P+'/StepDefinitions'))));
console.log('I6:', JSON.stringify(stepInventoryProblems(read(P+'/StepDefinitions'))));
"
```

Expected: `I5: []` and `I6: []`

If either reports something, stop: on accepted work that is the invariant being wrong. Loosen it and
re-run rather than changing the scaffold.

- [ ] **Step 6: Prepare the commit — do not run it**

```bash
git add scripts/invariants.mjs tests/invariants.test.mjs
git commit -m "feat(checks): every service method reachable from a step, no sentence bound twice"
```

---

## Task 9: `scripts/check-invariants.mjs` — the CLI

**Files:**
- Create: `scripts/check-invariants.mjs`
- Create: `tests/check-invariants.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `tests/check-invariants.test.mjs`:

```javascript
// tests/check-invariants.test.mjs — the CLI, run for real against the real tree.
//
// The pure rules have their own tests with both controls; this file answers the two questions those
// cannot. Does the script agree that the ACCEPTED scaffold is sound (D-30 — an invariant that goes
// red here is wrong, and the scaffold is the reference), and does `--through-row` actually narrow the
// set so an early wave is not judged against files nobody has been asked to build yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { repoRoot } from '../scripts/lib.mjs';

const ROOT = repoRoot(import.meta.url);
const SCRIPT = join(ROOT, 'scripts', 'check-invariants.mjs');

const run = (...args) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

test('the accepted scaffold satisfies every invariant', () => {
  // D-30. If this goes red, the invariant is wrong — not the scaffold, which a judge and a mutation
  // control have both already passed.
  const result = run();
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /OK — \d+ check\(s\)/);
});

test('an early row is judged only against the invariants whose files exist by then', () => {
  // Unscoped, I3 needs the services and I5/I6 need the step definitions, so an unscoped run is red by
  // construction until the last row — and the runner reads a red pre-turn gate as fatal.
  const result = run('--through-row', 'S2');
  assert.equal(result.status, 0, result.out);
  assert.doesNotMatch(result.out, /route/i, 'I3 must not run before the services exist');
});

test('the scope grows with the row', () => {
  const early = run('--through-row', 'S2').out;
  const late = run('--through-row', 'S14').out;
  assert.ok(late.length > early.length, `late:\n${late}\nearly:\n${early}`);
  assert.match(late, /route/i, 'I3 belongs to the late scope');
});

test('an unknown row is refused rather than silently checking everything', () => {
  // A typo must not fall through to the full run, which is red until the last row and would be read
  // as a verdict on the turn.
  const result = run('--through-row', 'S99');
  assert.equal(result.status, 2, result.out);
  assert.match(result.out, /S99/);
});

test('--quiet prints the failures and not the passes', () => {
  const result = run('--quiet');
  assert.equal(result.status, 0, result.out);
  assert.doesNotMatch(result.out, /^ {2}ok {2}/m);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/check-invariants.test.mjs`
Expected: FAIL — the script does not exist, so every `run()` returns a non-zero status with
`Cannot find module`

- [ ] **Step 2a: Close two loose ends left by Tasks 5–8**

Both were found by running the rules rather than reading them, and both live in
`scripts/invariants.mjs`.

**(a) `hasNonParallelizable` fails open on a block comment.** Measured:
`/* [assembly: NonParallelizable] */` returns `true`. The line filter only strips `//`. Elsewhere in
this repository leaning open is fine because the judge is the backstop — but **I4 has no rubric item
behind it**; the invariant exists precisely because nothing else checks S11's DoD. So close it:

```javascript
export function hasNonParallelizable(text) {
  return (text ?? '')
    .split('\n')
    // `//` and a single-line `/* … */` both mean "not active". Measured before this line existed:
    // `/* [assembly: NonParallelizable] */` returned true, and I4 is the ONLY check on this DoD —
    // there is no judge behind it to catch what a lean-open lets through.
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !(trimmed.startsWith('/*') && trimmed.endsWith('*/'));
    })
    .some((line) => /\[\s*assembly\s*:\s*(?:[\w.]+\.)?NonParallelizable(?:Attribute)?\s*\]/.test(line));
}
```

Add the test beside the existing I4 ones in `tests/invariants.test.mjs`:

```javascript
test('I4 goes red on a block-commented attribute too', () => {
  // Measured before the filter handled it: this returned true. I4 has no rubric item behind it, so a
  // lean-open here has nothing to catch it.
  assert.equal(hasNonParallelizable('/* [assembly: NonParallelizable] */'), false);
  assert.equal(hasNonParallelizable('  /* [assembly: NonParallelizable] */  '), false);
});

test('I4 tolerates CRLF, which every real .cs file here uses', () => {
  // `.gitattributes` leaves C# at the platform default, so these files are CRLF on Windows. Nothing
  // in the suite covered it; the regex happens to tolerate the trailing \r and this pins that.
  assert.equal(hasNonParallelizable('using X;\r\n[assembly: NonParallelizable]\r\n'), true);
});
```

**(b) The module header is now wrong.** It says every export "returns a list of hits";
`hasNonParallelizable` returns a boolean and `routesInSpec`/`routesInCode` return sets. Amend the
header to say so rather than leave a contradiction at the top of the file.

Run: `node --test tests/invariants.test.mjs`
Expected: `fail 0`, two tests more than before.

- [ ] **Step 3: Create `scripts/check-invariants.mjs`**

```javascript
// ══════════════════════════════════════════════════════════════════════════════════════
// IN PLAIN WORDS
//
// The automatic inspector for the framework AS A WHOLE.
//
// Its neighbour, check-scaffold.mjs, asks whether the files of a step are present and not
// empty. This one asks the questions that span files: is there exactly one HTTP client,
// does the code call every route the contract describes and no others, can every service
// method be reached from a test step, does the assembly refuse to run tests in parallel.
//
// Every one of those used to be a question put to an AI grader that was shown one step's
// changes at a time — and so could not answer any of them. A pattern gives the same answer
// every time and costs nothing.
//
// Scoped, like its neighbour: early on, the files a rule reads do not exist yet, and a
// gate that cannot pass would stop the loop before it started.
// ══════════════════════════════════════════════════════════════════════════════════════

// scripts/check-invariants.mjs — the cross-cutting half of the stage-0 gate.
//
// The rules themselves are pure and live in scripts/invariants.mjs, where each has a positive and a
// negative control. This file is only the plumbing: which rules are in scope, which files they read,
// and the exit code. Same shape as check-scaffold.mjs and check-tests.mjs — the `Verdict` class, a
// `--quiet` flag, exit 1 for a failure and exit 2 for a broken invocation.
//
//   node scripts/check-invariants.mjs                     every invariant (the finished scaffold)
//   node scripts/check-invariants.mjs --through-row S6     only those whose files exist by S6
//   node scripts/check-invariants.mjs --quiet

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot, Verdict } from './lib.mjs';
import { PROJECT_DIR, SCAFFOLD_ROWS, rowNeeds } from './manifest.scaffold.mjs';
import {
  extraRestClients,
  hardCodedEnvironment,
  hasNonParallelizable,
  routesInSpec,
  routesInCode,
  routeDifference,
  unusedServiceMethods,
  stepInventoryProblems,
} from './invariants.mjs';

const ROOT = repoRoot(import.meta.url);
const v = new Verdict('check:invariants');

const PROJECT = join(ROOT, PROJECT_DIR);
const CONVENTIONS = join(ROOT, 'docs/specs/petclinic/context-and-conventions.md');

const argAt = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const rel = (absolute) => relative(ROOT, absolute).split('\\').join('/');

/** Every `.cs` file under `dir` as `{ path, text }`, recursively. Empty when the directory is absent. */
function sourcesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.cs')) found.push({ path: rel(path), text: readFileSync(path, 'utf8') });
    }
  };
  walk(dir);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Scope ──────────────────────────────────────────────────────────────────────────
//
// Each invariant declares the MANIFEST PATH it depends on, and the scope is derived from that with
// `rowNeeds`. Nothing lists row ids by hand: a hand-written list is a second thing to keep in step
// with the manifest, and it is the manifest that decides which turn builds what.

const targetRow = argAt('--through-row');
if (targetRow !== null && !SCAFFOLD_ROWS.includes(targetRow)) {
  console.error(
    `check:invariants: unknown row ${JSON.stringify(targetRow)} — the manifest knows ` +
      `${SCAFFOLD_ROWS.join(', ')}.\n` +
      '  Refused rather than falling through to the full run: unscoped, this gate is red until the\n' +
      '  last row of the stage, and the runner would report that as a verdict on the turn.'
  );
  process.exit(2);
}

const p = (relativePath) => `${PROJECT_DIR}/${relativePath}`;

/** How many invariants actually ran. See the guard above `v.report` at the bottom of this file. */
let ran = 0;

/** Whether a rule whose files arrive with `dependsOn` is in scope for this run. */
function inScope(dependsOn) {
  if (targetRow === null) {
    ran += 1;
    return true;
  }
  const needs = rowNeeds(targetRow, dependsOn);
  if (needs === null) {
    console.error(
      `check:invariants: the manifest does not know ${dependsOn}, so its invariant cannot be scoped`
    );
    process.exit(2);
  }
  if (needs) ran += 1;
  return needs;
}

// ── The invariants ─────────────────────────────────────────────────────────────────

// I1 — one RestClient, in ApiClient.
if (inScope(p('Http/ApiClient.cs'))) {
  const extras = extraRestClients(sourcesUnder(PROJECT), { clientPath: 'Http/ApiClient.cs' });
  v.check(
    extras.length === 0,
    'one RestClient, constructed in Http/ApiClient.cs',
    `${extras.length} RestClient(s) beyond the one in ApiClient: ` +
      `${extras.map((hit) => `${hit.path}:${hit.line}`).join(', ')} — ` +
      'a "reusable request specification" each service rebuilds for itself is not reusable'
  );
}

// I2 — no literal environment.
if (inScope(p('Config/SettingsLoader.cs'))) {
  // The SUT's own host and port. Named here, in the plumbing, so the rule in invariants.mjs stays
  // portable: pointing this harness at another API changes these two values and nothing else.
  const literals = hardCodedEnvironment(sourcesUnder(PROJECT), { host: 'localhost', port: 9966 });
  v.check(
    literals.length === 0,
    'no hard-coded base URL or port in C#',
    `literal environment at ${literals.map((h) => `${h.path}:${h.line} (${h.match})`).join(', ')} — ` +
      'the base URL comes from appsettings.json through SettingsLoader, overridable by PETCLINIC_BASE_URL'
  );
}

// I3 — the contract's routes and the code's routes are one set.
if (inScope(p('Services/OwnersService.cs'))) {
  const spec = existsSync(CONVENTIONS) ? routesInSpec(readFileSync(CONVENTIONS, 'utf8')) : null;
  if (spec === null) {
    // Fail-closed, and named. An empty set would compare equal to "nothing missing" and retire the
    // check, which is the fail-open this whole file exists to refuse.
    v.fail(
      `route coverage: the §7 route table could not be read from ${rel(CONVENTIONS)} — ` +
        'this is not the same as "the contract asks for no routes"'
    );
  } else {
    const code = routesInCode(sourcesUnder(join(PROJECT, 'Services')));
    const { missing, extra } = routeDifference(spec, code);
    v.check(
      missing.length === 0 && extra.length === 0,
      `route coverage: all ${spec.size} routes of §7 are called by a service`,
      [
        'route coverage diverges from §7 of the conventions',
        missing.length ? `      missing from the services: ${missing.join(', ')}` : '',
        extra.length ? `      called but not in the contract: ${extra.join(', ')}` : '',
        '      a missing route stalls a later AC; an extra one means code and contract have parted',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

// I4 — the assembly refuses parallel execution.
if (inScope(p('AssemblyInfo.cs'))) {
  const path = join(PROJECT, 'AssemblyInfo.cs');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  v.check(
    hasNonParallelizable(text),
    'the assembly is NonParallelizable',
    'AssemblyInfo.cs does not carry [assembly: NonParallelizable] — §10.7 forbids parallel ' +
      'execution, because the tests share one database and count assertions would stop being ' +
      'deterministic. A commented-out attribute does not count'
  );
}

// I5 and I6 — the steps. Both depend on the step definitions existing.
if (inScope(p('StepDefinitions/OwnerSteps.cs'))) {
  const services = sourcesUnder(join(PROJECT, 'Services'));
  const steps = sourcesUnder(join(PROJECT, 'StepDefinitions'));

  const unused = unusedServiceMethods(services, steps);
  v.check(
    unused.length === 0,
    'every service method is reachable from a step definition',
    `no step calls ${unused.map((h) => `${h.path} ${h.method}()`).join(', ')} — ` +
      'the route exists and no scenario can reach it, which stalls a later AC'
  );

  // NO expected count, and the ok line must not imply one. `stepInventoryProblems` lost its count
  // half after measurement — 97 bindings on the ACCEPTED scaffold against the 22 routes of §7. A
  // green line stating a number nothing verified, and which measurement had already shown wrong by a
  // factor of four, is exactly the fail-open this file exists to refuse. Report what was checked.
  const problems = stepInventoryProblems(steps);
  v.check(
    problems.length === 0,
    `step inventory: ${steps.length} step file(s), no sentence bound twice`,
    `step inventory:\n      ${problems.join('\n      ')}`
  );
}

/*
 * Row S1 builds the solution skeleton, and nothing any invariant reads exists yet — so at S1 NOTHING
 * is in scope and not one check runs. `Verdict.report` refuses to call that green, on the correct
 * grounds that a checker which checked nothing is a broken checker. Both positions are right, so this
 * says which case it is.
 *
 * Without this line the stage-0 gate goes red on the FIRST row of every from-scratch run — the worst
 * possible place, because the runner reads a red pre-turn gate as fatal and the operator has spent an
 * agent turn to be told the harness is broken.
 */
if (ran === 0) {
  v.pass(
    `no invariant applies at or before ${targetRow} — every file they read is built by a later row`
  );
}

v.report({ quiet: process.argv.includes('--quiet') });
```

- [ ] **Step 3a: Two fail-opens the plan's CLI text carries — close both**

**(a) `--through-row` with no value falls through to the unscoped run.** `argAt` returns `null` for
both "flag absent" and "flag present, value missing", so `node scripts/check-invariants.mjs
--through-row` becomes the full run — which is red by construction until the last row, and which the
refusal three lines below exists to prevent. `check-scaffold.mjs` closes the same hole by a different
route. Return `''` for a missing value so it is refused with every other unknown scope:

```javascript
const argAt = (name) => {
  const index = process.argv.indexOf(name);
  // `?? ''` on the VALUE, `null` only for the absent flag. `--through-row` with nothing after it is a
  // mistake, and answering it with the same `null` as "the flag was never passed" would fall through
  // to the unscoped run — the one thing the refusal below exists to prevent.
  return index === -1 ? null : process.argv[index + 1] ?? '';
};
```

**(b) `sourcesUnder` walks build output.** Measured: seven generated `.cs` files sit under the
project — four in `obj/Debug/net8.0/` and the three `*.feature.cs` Reqnroll emits beside the feature
files. All seven are `.gitignore`d. The invariants are green either way today, so this is not a fix
for a red gate; it closes an exposure with a bad failure mode, because `*.feature.cs` embeds the
Gherkin text as string literals and a scenario mentioning a port would make I2 red while pointing the
agent at a file it cannot edit. Skip `obj`, `bin`, `TestResults` and `*.feature.cs` — the list comes
from `.gitignore` rather than being invented. Verify with a count: 37 files before, 30 after.

- [ ] **Step 4: Add the re-runnability test**

The stage-0 flow must work whether or not a framework already exists — reset and re-run, or run in a
fresh project. Row S1 is where that breaks first. Append to `tests/check-invariants.test.mjs`:

```javascript
test('the very first row of a from-scratch run is green, not "the gate itself is broken"', () => {
  // At S1 nothing an invariant reads exists yet, so no check is in scope. Verdict.report refuses to
  // call a run with zero checks green -- rightly -- so the script has to say which case it is.
  // Without that, `npm run ralph -- --stage scaffold` on an empty framework/ dies on iteration 1.
  const result = run('--through-row', 'S1');
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /no invariant applies/);
  assert.doesNotMatch(result.out, /the gate itself is broken/);
});

test('the scope is a function of the row alone, not of what happens to be on disk', () => {
  // The same row must compose the same set on a finished tree and on an empty one, or a re-run would
  // be graded differently from the first run.
  const first = run('--through-row', 'S4').out;
  const second = run('--through-row', 'S4').out;
  assert.equal(first, second);
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/check-invariants.test.mjs`
Expected: PASS

- [ ] **Step 6: Run it by hand and read the output**

Run: `node scripts/check-invariants.mjs`
Expected: a list of `ok` lines ending in `check:invariants OK — 6 check(s).`, exit 0

- [ ] **Step 7: Add the npm script**

In `package.json`, add to `scripts`, directly after `"check:tests"`:

```json
    "check:invariants": "node scripts/check-invariants.mjs",
```

Run: `npm run check:invariants`
Expected: the same output, exit 0

- [ ] **Step 8: Run the whole suite**

Run: `node --test`
Expected: `fail 0`

- [ ] **Step 9: Prepare the commit — do not run it**

```bash
git add scripts/check-invariants.mjs tests/check-invariants.test.mjs \
        scripts/invariants.mjs tests/invariants.test.mjs package.json
git commit -m "feat(checks): a gate for the invariants no per-row diff could answer"
```

---

## Task 10: A new flow costs three edits to the input and none to the framework

**The problem.** Adding a fourth flow today needs a hand-written line inside
`framework/.../TestData/TestDataProvider.cs`, whose `FeatureFiles` map is closed over `F01/F02/F03`.
That file is stage 0's output and `TestData/` is **outside** the stage-1 fence
(`STAGE1_ALLOWED = ['Features/', 'StepDefinitions/', 'Data/']`), so a stage-1 turn that edited it
would be refused. The framework therefore has to be edited by hand or rebuilt — for a flow whose
every other ingredient is input.

**After this task,** adding flow F-04 is: one line in `scripts/flows.mjs`, a flow document under
`docs/specs/petclinic/flows/`, and rows in `loop/trackers/tests.md` (with `**Total:**` updated). No
framework change, no rebuild.

Three fixes, in dependency order:

| Fix | What | Where | Testable now? |
|---|---|---|---|
| 2 | The S13 feature skeletons are **derived** from the flow list instead of written out three times | `scripts/manifest.scaffold.mjs` | yes, pure harness |
| 3 | The turn is told it may **create** a missing feature file | `loop/invoke.mjs` | yes, pure harness |
| 1 | `TestDataProvider` finds its data file **by the flow tag**, not from a closed map | requirement in the manifest + S10's DoD | prototype, prove, revert |

Fix 1 is numbered last because it is the one that needs proving against a running suite, and its
requirement only takes effect when stage 0 next runs — which is phase B.

**Files:**
- Modify: `scripts/manifest.scaffold.mjs`
- Modify: `loop/invoke.mjs`
- Modify: `loop/trackers/scaffold.md`
- Modify: `tests/manifest.test.mjs`
- Modify: `tests/invoke.test.mjs`
- Prototype, then revert: `framework/src/PetClinic.ApiTests/TestData/TestDataProvider.cs`
- Moved and restored by step 14: `framework/src/PetClinic.ApiTests/Data/F01-owner-lifecycle.json`
- Created and deleted by step 15: `framework/src/PetClinic.ApiTests/Data/F09-probe.json`

`git status --porcelain -- framework` must be **empty** when the task ends. The three entries above
are disturbances, not deliverables.

---

### Fix 2 — the feature skeletons follow the flow list

- [ ] **Step 1: Write the failing tests**

The property under test is *derivation* — "a fourth flow gets a fourth skeleton with no edit here" —
and a test that only reads the finished `SCAFFOLD_MANIFEST` cannot express it, because three flows and
three skeletons agree whether or not the list is derived. So the derivation goes into a pure exported
function that a test can call **with a fourth flow**.

Append to `tests/manifest.test.mjs`:

```javascript
// ── A flow added later must not need this file edited ────────────────────────────────
//
// S13's three feature skeletons used to be written out one per line. A fourth flow would then have no
// skeleton until somebody remembered this list — and the omission would not surface here. It would
// surface as a REJECTED STAGE-1 TURN, because `check-tests.mjs` fails when the feature file of the
// flow under test is absent, and the message it prints blames stage 0.

test('featureSkeletonEntries produces one entry per flow it is given', () => {
  // Called with a fourth flow, which is the case the derivation exists for and the one a test of the
  // finished manifest could never reach.
  const entries = featureSkeletonEntries({
    'F-01': 'F01-owner-lifecycle',
    'F-02': 'F02-owner-pet-lifecycle',
    'F-03': 'F03-pet-visit-flow',
    'F-04': 'F04-owner-search',
  });

  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((entry) => entry.path.split('/').pop()),
    [
      'F01-owner-lifecycle.feature',
      'F02-owner-pet-lifecycle.feature',
      'F03-pet-visit-flow.feature',
      'F04-owner-search.feature',
    ]
  );
  for (const entry of entries) {
    assert.equal(entry.row, 'S13');
    assert.equal(entry.wave, 8);
  }
});

test("each derived skeleton's probe looks for its own flow tag and rejects another's", () => {
  // The probe is what stops one flow's skeleton being satisfied by another flow's file.
  const entries = featureSkeletonEntries({ 'F-01': 'F01-a', 'F-04': 'F04-b' });
  const [first, fourth] = entries;

  assert.ok(first.probes.some((probe) => probe.test('@F01 Feature: x')));
  assert.ok(!first.probes.some((probe) => probe.test('@F04')), 'F-01 must not accept @F04');
  assert.ok(fourth.probes.some((probe) => probe.test('@F04 Feature: x')));
  assert.ok(!fourth.probes.some((probe) => probe.test('@F01')), 'F-04 must not accept @F01');
});

test('the live manifest uses the derivation, so the flow list is the only place flows are listed', () => {
  const derived = featureSkeletonEntries(FLOW_GROUPS).map((entry) => entry.path);
  const inManifest = SCAFFOLD_MANIFEST
    .filter((entry) => /\/Features\/[^/]+\.feature$/.test(entry.path))
    .map((entry) => entry.path);

  assert.deepEqual(inManifest, derived);
});
```

Extend the import at the top of `tests/manifest.test.mjs`:

```javascript
import { FLOW_GROUPS } from '../scripts/flows.mjs';
```

and add `featureSkeletonEntries` to the existing import from `../scripts/manifest.scaffold.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/manifest.test.mjs`
Expected: FAIL — `does not provide an export named 'featureSkeletonEntries'`

- [ ] **Step 3: Add the derivation and use it**

In `scripts/manifest.scaffold.mjs`, delete these three lines:

```javascript
  { path: p('Features/F01-owner-lifecycle.feature'), row: 'S13', wave: 8, probes: [/Feature\s*:/, /@F01/] },
  { path: p('Features/F02-owner-pet-lifecycle.feature'), row: 'S13', wave: 8, probes: [/Feature\s*:/, /@F02/] },
  { path: p('Features/F03-pet-visit-flow.feature'), row: 'S13', wave: 8, probes: [/Feature\s*:/, /@F03/] },
```

and put `...featureSkeletonEntries(FLOW_GROUPS),` in their place, with the comment:

```javascript
  // ── Feature skeletons (S13) ───────────────────────────────────────────────────
  //
  // One per flow, DERIVED from the flow list — see `featureSkeletonEntries` above for why.
  ...featureSkeletonEntries(FLOW_GROUPS),
```

Add the import at the top of the file — `flows.mjs` imports nothing from here, so there is no cycle:

```javascript
import { FLOW_GROUPS } from './flows.mjs';
```

And define the function **above** `SCAFFOLD_MANIFEST`, since the array references it:

```javascript
/**
 * One feature-skeleton entry per flow.
 *
 * Derived rather than written out, so that adding a flow is one line in `scripts/flows.mjs`: the
 * skeleton becomes a stage-0 requirement on its own, and a from-scratch rebuild produces it. Written
 * out, a fourth flow would have no skeleton until somebody remembered a list in this file — and the
 * omission would not surface here. It would surface as a REJECTED STAGE-1 TURN, because
 * `scripts/check-tests.mjs` fails when the feature file of the flow under test is absent, and the
 * message it prints blames stage 0.
 *
 * Exported, and takes its flow map as an argument, because that is the only way the property can be
 * tested: three flows and three skeletons agree whether or not the list is derived, so the test has to
 * be able to ask for a fourth.
 *
 * The probe carries the flow's own tag — `F-01` -> `@F01`, the spelling a feature header uses — so one
 * flow's skeleton cannot be satisfied by another flow's file. `\b` after it keeps `@F01` from matching
 * inside a longer tag.
 */
export function featureSkeletonEntries(flowGroups) {
  return Object.entries(flowGroups).map(([group, slug]) => ({
    path: p(`Features/${slug}.feature`),
    row: 'S13',
    wave: 8,
    probes: [/Feature\s*:/, new RegExp(`@${group.replace('-', '')}\\b`)],
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass, and that the live manifest did not move**

Run: `node --test tests/manifest.test.mjs`
Expected: PASS

Then confirm the three current paths are byte-identical to the three that were deleted, so nothing
about the accepted scaffold changed — only where the list comes from:

```bash
node --input-type=module -e "
import { SCAFFOLD_MANIFEST } from './scripts/manifest.scaffold.mjs';
console.log(SCAFFOLD_MANIFEST.filter((e) => e.path.endsWith('.feature')).map((e) => e.path).join('\n'));
"
```

Expected, exactly:

```
framework/src/PetClinic.ApiTests/Features/F01-owner-lifecycle.feature
framework/src/PetClinic.ApiTests/Features/F02-owner-pet-lifecycle.feature
framework/src/PetClinic.ApiTests/Features/F03-pet-visit-flow.feature
```

Run: `node scripts/check-scaffold.mjs --through-row S13`
Expected: the three skeletons still pass their probes — the derivation produced the same requirement.

- [ ] **Step 5: Exempt S13 from the path-for-path cross-check, and say why**

`tests/manifest.test.mjs` has a test — *"the tracker and the manifest agree, path for path, about
which row builds what"* — that compares the manifest against the file names in
`loop/trackers/scaffold.md`. That guard exists to catch **two hand-maintained lists drifting apart**.
S13 no longer has a second hand-maintained list, so comparing it path for path would instead force a
tracker edit every time a flow is added — reintroducing exactly the friction this task removes.

In `tests/manifest.test.mjs`, change that test to skip S13 and pin the derivation instead:

```javascript
test('the tracker and the manifest agree, path for path, about which row builds what', () => {
  // S13 is exempt, and only S13. Its entries are derived from `FLOW_GROUPS`, so there is no second
  // hand-maintained list for them to drift from — the two tests above pin the derivation instead. Any
  // other row still has its files written out in the tracker by hand, and that pair still has to
  // agree; the guard below proves the comparison can still fail.
  const withoutS13 = (mapping) => Object.fromEntries(Object.entries(mapping).filter(([row]) => row !== 'S13'));
  assert.deepEqual(withoutS13(manifestMapping()), withoutS13(asMapping(filesByRow(tracker()))));
});
```

- [ ] **Step 6: Rewrite S13's Files line so it names the rule, not three paths**

In `loop/trackers/scaffold.md`, under `### S13 — Feature skeletons`, replace the **Files:** paragraph:

```markdown
**Files:** one feature file per flow, in `PROJECT/Features/`, named after that flow's slug.
```

**Nothing in that paragraph may carry a file extension inside backticks.** `filesByRow` in
`tests/manifest.test.mjs` treats any backticked token ending in `.<ext>` as a file path, so a
mention of `scripts/flows.mjs` there would be attributed to S13 as a file it builds. Put the
explanation in the DoD paragraph below the blank line instead:

```markdown
**DoD:** the flow list in scripts/flows.mjs decides how many files there are — three today. Each has a
`Feature:` header, its flow tag (`@F01`/`@F02`/`@F03`, one per file) and a short description taken
from that flow's "What the flow verifies" section. **No scenarios yet** — stage 1 appends those, one
per iteration, and creates the file itself if a flow was added after this stage ran.
```

- [ ] **Step 6a: Move the count step 6 just changed**

Step 6 removed S13's three paths from the tracker, so the tracker-derived file count drops from 41
to 38 and `the derivation reads the tracker — 14 rows naming 41 files` fails with
`the details sections name 38 file(s), not 41`. Measured.

In `tests/manifest.test.mjs`, rename that test to `… 14 rows naming 38 files` and change the
assertion to 38, with a comment saying why the number is no longer the manifest length:

```javascript
  // 38, not the manifest length. S13's skeletons are derived from the flow list, so the tracker no
  // longer names them — and 38 STAYS 38 when a fourth flow is added, while the manifest grows to 42.
  // A pin of the manifest length would have to move on every new flow; this one does not.
```

The guard's real purpose is unchanged: a silently-empty parse still cannot pass, and
`byRow.size === 14` still holds. This is the only pin of the tracker-derived count —
`tests/check-scaffold.test.mjs`'s `all 41 manifest entries` counts the manifest and is unaffected.

- [ ] **Step 7: Run the tests**

Run: `node --test tests/manifest.test.mjs`
Expected: PASS

Run: `node --test`
Expected: `fail 0`

---

### Fix 3 — the turn may create a feature file that does not exist

- [ ] **Step 8: Write the failing test**

Append to `tests/invoke.test.mjs`:

```javascript
test('the target section tells a tests turn it may create a missing feature file', () => {
  // A flow added after stage 0 ran has no skeleton. `Features/` is inside the stage-1 fence, and
  // `check-tests.mjs` looks for the file AFTER the turn — so a turn that creates it passes. Without
  // this sentence the agent has no way to know that, and its prompt says "append", which reads as
  // "the file is there". The prompt itself is write-protected by .claude/settings.json, so the
  // instruction belongs in the section the runner generates.
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F01-01', group: 'F-01', title: 'a registered owner is visible', status: 'todo' },
    branch: 'feat/api-tests',
    findings: '',
  });
  assert.match(section, /create (it|the file) if it does not exist/i);
});

test('the same section still names the exact feature file to append to', () => {
  // The new sentence must not displace the path — that is what the turn acts on.
  const section = targetSection({
    stage: 'tests',
    iteration: 1,
    maxIter: 30,
    row: { id: 'AC-F03-02', group: 'F-03', title: 't', status: 'todo' },
    branch: 'b',
    findings: '',
  });
  assert.match(section, /Features\/F03-pet-visit-flow\.feature/);
});
```

- [ ] **Step 9: Run the tests to verify the first one fails**

Run: `node --test tests/invoke.test.mjs`
Expected: FAIL on `the target section tells a tests turn it may create a missing feature file`

- [ ] **Step 10: Add the sentence to `targetSection`**

In `loop/invoke.mjs`, inside the `else` branch that builds the tests-stage lines, replace:

```javascript
      `**Append the scenario to:** \`${featurePath(row.group)}\``,
```

with:

```javascript
      `**Append the scenario to:** \`${featurePath(row.group)}\` — **create it if it does not exist.**`,
      'A flow added after stage 0 ran has no skeleton, and `Features/` is inside your fence, so',
      'writing it is your work and not grounds for `blocked` — exactly as it is for the data file.',
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `node --test tests/invoke.test.mjs`
Expected: PASS

Run: `node --test`
Expected: `fail 0`

---

### Fix 1 — the data file is found by the flow tag

- [ ] **Step 12: Prototype the change in `TestDataProvider`**

Same discipline as tasks 11 and 12: this is a stage-0 file, so the prototype exists only to prove the
requirement is satisfiable, and is reverted afterwards.

In `framework/src/PetClinic.ApiTests/TestData/TestDataProvider.cs`, delete the `FeatureFiles`
dictionary and replace `ResolveFeatureFile` with:

```csharp
    // The data file is the one in Data/ whose name begins with the feature's flow tag: @F01 ->
    // F01-owner-lifecycle.json. DERIVED rather than listed, and that is what makes a flow added after
    // this stage ran cost nothing here -- this class sits outside the stage-1 fence, so a stage-1 turn
    // could not have added a map entry even if it wanted to.
    //
    // Exactly one match is required. Zero means the flow has no data file yet; more than one means two
    // flows share a prefix, and picking either would give a scenario another flow's data.
    private string ResolveFeatureFile()
    {
        var flowTag = _featureContext.FeatureInfo.Tags.FirstOrDefault(IsFlowTag);
        if (flowTag is null)
        {
            throw new InvalidOperationException(
                $"Feature '{_featureContext.FeatureInfo.Title}' carries no flow tag of the form @Fnn. " +
                "TestDataProvider names a flow's data file after that tag.");
        }

        var matches = Directory.EnumerateFiles(_dataDirectory, "*.json")
            .Where(path => Path.GetFileName(path).StartsWith(flowTag, StringComparison.Ordinal))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

        if (matches.Count != 1)
        {
            throw new InvalidOperationException(
                $"Expected exactly one file in '{_dataDirectory}' whose name starts with '{flowTag}', " +
                $"found {matches.Count}" +
                (matches.Count == 0
                    ? $". A flow's data file is named after its tag, for example {flowTag}-owner-lifecycle.json."
                    : $": {string.Join(", ", matches.Select(Path.GetFileName))}."));
        }

        return Path.GetFileName(matches[0]);
    }

    // A flow tag is the letter F and exactly two digits. Written out rather than taken as "any tag
    // that is not an AC id", so a future tag like @US-06 on a Feature line cannot be mistaken for one.
    private static bool IsFlowTag(string tag) =>
        tag.Length == 3 && tag[0] == 'F' && char.IsAsciiDigit(tag[1]) && char.IsAsciiDigit(tag[2]);
```

- [ ] **Step 13: Prove it — all twenty scenarios still find their data**

Run:

```bash
node scripts/sut.mjs reset && dotnet test framework/ApiTests.sln --nologo
```

Expected: `Passed! - Failed: 0, Passed: 23`

That is the proof that matters: three flows, twenty scenarios, every one of them resolving its data
file through the new rule instead of the deleted map.

- [ ] **Step 14: Prove it fails loudly rather than quietly picking the wrong file**

Temporarily move one data file out of the way:

```bash
mv framework/src/PetClinic.ApiTests/Data/F01-owner-lifecycle.json /tmp/F01-owner-lifecycle.json
dotnet test framework/ApiTests.sln --nologo --filter "TestCategory=AC-F01-01"
```

Expected: FAIL, with a message naming the tag and the count — `Expected exactly one file ... whose
name starts with 'F01', found 0`.

Then put it back and confirm green again:

```bash
mv /tmp/F01-owner-lifecycle.json framework/src/PetClinic.ApiTests/Data/F01-owner-lifecycle.json
dotnet test framework/ApiTests.sln --nologo --filter "TestCategory=AC-F01-01"
```

Expected: PASS

**On Windows use the scratch directory rather than `/tmp`,** and note that `Data/**/*.json` is copied
to the build output — a stale copy under `bin/` can make this step lie. If the failure does not
appear, run `dotnet build` first to refresh the output.

- [ ] **Step 15: Prove a flow with no framework change can be resolved**

The whole point of the fix, verified without adding a real flow: drop a data file for a tag that has
no map entry and confirm the resolver finds it.

```bash
cp framework/src/PetClinic.ApiTests/Data/F01-owner-lifecycle.json framework/src/PetClinic.ApiTests/Data/F09-probe.json
node --input-type=module -e "
import { readdirSync } from 'node:fs';
const dir = 'framework/src/PetClinic.ApiTests/Data';
const matches = readdirSync(dir).filter((f) => f.endsWith('.json') && f.startsWith('F09'));
console.log('files a feature tagged @F09 would resolve to:', matches);
"
rm framework/src/PetClinic.ApiTests/Data/F09-probe.json
```

Expected: `files a feature tagged @F09 would resolve to: [ 'F09-probe.json' ]` — one match, with no
entry anywhere in the C# code. That is the property.

- [ ] **Step 16: Record the evidence, then revert the prototype**

Record in the scratch note: the 23/23 pass from step 13, the loud failure and recovery from step 14,
and the resolution from step 15.

Then revert:

```bash
git restore framework/src/PetClinic.ApiTests/TestData/TestDataProvider.cs
git status --porcelain --untracked-files=normal -- framework
```

Expected: the `git status` output is **empty** — the framework is back to the accepted scaffold, map
and all.

- [ ] **Step 17: Write the requirement into the manifest and the tracker**

In `scripts/manifest.scaffold.mjs`, change the probes of the `TestData/TestDataProvider.cs` entry
from:

```javascript
    probes: [/class TestDataProvider/, /ScenarioContext|ScenarioInfo/, /AC-/],
```

to:

```javascript
    // `EnumerateFiles` is the requirement's fingerprint: the data file is FOUND, not looked up in a
    // list. A closed map would satisfy every other probe here while making a fourth flow impossible
    // for stage 1 to add, because TestData/ sits outside the stage-1 fence.
    probes: [/class TestDataProvider/, /ScenarioContext|ScenarioInfo/, /AC-/, /EnumerateFiles|GetFiles/],
```

In `loop/trackers/scaffold.md`, under `### S10 — TestDataProvider`, append to the DoD:

```markdown
The data **file** is resolved by the feature's flow tag, not from a hard-coded map: a feature tagged
`@F01` reads the one file in `Data/` whose name starts with `F01`. Exactly one match is required —
zero and several both throw, naming the tag and the count. A closed map would mean a flow added after
this stage cannot be given data at all, because `TestData/` is outside the stage-1 fence and no
stage-1 turn may edit this class.
```

- [ ] **Step 18: Verify everything agrees**

Run: `node --test`
Expected: `fail 0`

Run: `node scripts/check-scaffold.mjs`
Expected: FAIL — and the `TestData/TestDataProvider.cs` line is now among the failures, because the
accepted scaffold still has the closed map. That is the requirement being live and unsatisfied until
phase B, exactly like the unit tests and the canary.

Run: `node scripts/check-invariants.mjs`
Expected: exit 0 — the invariants say nothing about the map, and the framework is untouched.

- [ ] **Step 19: Prepare the commit — do not run it**

```bash
git add scripts/manifest.scaffold.mjs loop/invoke.mjs loop/trackers/scaffold.md \
        tests/manifest.test.mjs tests/invoke.test.mjs
git commit -m "feat(loop): a new flow costs three edits to the input and none to the framework"
```

`framework/` must appear in neither the staged set nor the diff.

---

### What this task makes possible

After phase B has rebuilt the framework under the new requirement, adding flow F-04 is:

```bash
# 1. one line in scripts/flows.mjs
#      'F-04': 'F04-owner-search',
# 2. write docs/specs/petclinic/flows/F-04-owner-search.md   (the acceptance criteria)
# 3. append rows to loop/trackers/tests.md as `todo`, and update **Total:**
npm run ralph -- --stage tests --flow F-04
```

The first turn creates `Features/F04-owner-search.feature` and `Data/F04-owner-search.json` itself;
`TestDataProvider` finds the data file by the `@F04` tag; no C# changes, no rebuild, no reset.

---

## Task 11: The unit tests become a requirement stage 0 must satisfy

**The boundary this task respects.** `framework/` is stage 0's **output**, not the harness's input.
`scripts/reset-run.mjs` deletes it whole (`--yes` is required for exactly that reason), and the next
full run regenerates it. A test written into it by hand is a test the loop cannot reproduce and the
next reset destroys — and it would prove that a human can write it, not that stage 0 can produce it.

So this task writes the files **once**, to prove the requirement is satisfiable, throws them away, and
leaves the requirement in the input where stage 0 will read it.

**Why prove first rather than just declaring the requirement.** A DoD placed in the tracker without
ever having been run may be one no turn can satisfy. Stage 0 would then fail its gate on a wiring
fault, iteration after paid iteration, and the failure would be reported as a verdict on the agent's
work — the exact confusion `loop/gates.mjs` already documents for a mis-scoped manifest check.

**Where the requirement is allowed to live.** The manifest (Task 2 added both entries) and
`loop/trackers/scaffold.md`. **Not** `loop/PROMPT.scaffold.md` and **not** `loop/rubrics/scaffold.md`:
`.claude/settings.json` denies `Edit` and `Write` on both, deliberately, because they are the inputs
the run is graded against. That costs nothing here — the scaffold prompt already sends every turn to
"the task details section for your target task — the exact file list and the DoD", so the tracker is
both the right place and a sufficient one.

**Files:**
- Prototype, then delete: `framework/src/PetClinic.ApiTests/Tests/Unit/ApiResponseTests.cs`
- Prototype, then delete: `framework/src/PetClinic.ApiTests/Tests/Unit/UniqueDataTests.cs`
- Modify: `loop/trackers/scaffold.md`

- [ ] **Step 1: Write the prototype for `EnsureStatus`**

Create `framework/src/PetClinic.ApiTests/Tests/Unit/ApiResponseTests.cs`:

```csharp
using System.Net;
using FluentAssertions;
using NUnit.Framework;
using PetClinic.ApiTests.Http;

namespace PetClinic.ApiTests.Tests.Unit;

// Every one of the twenty scenarios routes its response-code checks through EnsureStatus, so what
// that method puts in its message decides whether an unexpected 500 is diagnosable or costs its
// reader a reproduction. Stage-0 rubric check 9 asserts this by reading code; these tests assert it
// by running it.
//
// [Category("Unit")] is what lets the stage-0 gate run these before the SUT exists: no Docker, no
// HTTP, no readiness probe.
[TestFixture]
[Category("Unit")]
public sealed class ApiResponseTests
{
    private static ApiResponse Response(HttpStatusCode code, string? body) =>
        new(code, body, new Dictionary<string, string>());

    [Test]
    public void EnsureStatus_is_silent_when_the_code_is_the_expected_one()
    {
        var response = Response(HttpStatusCode.OK, "{}");

        var act = () => response.EnsureStatus(HttpStatusCode.OK);

        act.Should().NotThrow(because: "200 is what the caller asked for");
    }

    [Test]
    public void EnsureStatus_puts_the_response_body_in_the_message_it_throws()
    {
        // The point of the check. Both codes AND the body: the codes say what went wrong, the body
        // says why, and the body is the half a reader cannot reconstruct afterwards.
        var response = Response(HttpStatusCode.InternalServerError, "{\"error\":\"telephone too long\"}");

        var act = () => response.EnsureStatus(HttpStatusCode.Created);

        act.Should()
            .Throw<InvalidOperationException>()
            .Which.Message.Should()
            .Contain("telephone too long", because: "the body explains a 500 and nothing else does")
            .And.Contain("500")
            .And.Contain("201");
    }

    [Test]
    public void EnsureStatus_still_reports_the_codes_when_there_is_no_body()
    {
        // §7: a 404 carries no body. The message must still name both codes rather than reading as
        // though the check itself failed to run.
        var response = Response(HttpStatusCode.NotFound, null);

        var act = () => response.EnsureStatus(HttpStatusCode.OK);

        act.Should().Throw<InvalidOperationException>()
            .Which.Message.Should().Contain("404").And.Contain("200");
    }
}
```

- [ ] **Step 2: Run it — this proves the requirement is satisfiable AND that rubric check 9 is true**

Run: `dotnet test framework/ApiTests.sln --nologo --filter TestCategory=Unit`
Expected: `Passed! - Failed: 0, Passed: 3`

If it fails, `EnsureStatus` does not do what rubric check 9 claims. **Stop and report** — that is a
real defect in accepted work, and it changes the requirement rather than the test.

- [ ] **Step 3: Write the prototype for `UniqueData`**

Create `framework/src/PetClinic.ApiTests/Tests/Unit/UniqueDataTests.cs`:

```csharp
using System.Globalization;
using FluentAssertions;
using NUnit.Framework;
using PetClinic.ApiTests.Support;

namespace PetClinic.ApiTests.Tests.Unit;

// S6's DoD says in as many words that "unit checks prove" these constraints. They did not exist, so
// the constraints were checked by a judge reading code (stage-0 rubric check 5). Each rule below is
// one the API enforces at runtime, and each has a measured consequence:
//
//   digits in a last name          -> 400 (§10.5)
//   a telephone of 11-20 digits    -> passes schema validation, then 500 on save (§11)
//   a culture-sensitive date       -> "14.05.2020" on a uk-UA machine, then 400
[TestFixture]
[Category("Unit")]
public sealed class UniqueDataTests
{
    [Test]
    public void LastName_appends_a_letters_only_suffix_and_stays_within_thirty_characters()
    {
        var value = UniqueData.LastName("Testowner");

        value.Should().StartWith("Testowner");
        value.Should().MatchRegex("^[A-Za-z]+$", because: "a digit in a last name is rejected with 400 (§10.5)");
        value.Length.Should().BeLessThanOrEqualTo(30, because: "the contract caps a name at 30 characters");
    }

    [Test]
    public void LastName_trims_the_base_rather_than_overflowing_the_limit()
    {
        var value = UniqueData.LastName(new string('A', 40));

        value.Length.Should().BeLessThanOrEqualTo(30);
        value.Should().MatchRegex("^[A-Za-z]+$");
    }

    [Test]
    public void Telephone_is_exactly_ten_digits()
    {
        // §11: 11 to 20 digits pass schema validation and then fail with a 500 on save, which is the
        // worst shape of failure -- it looks like a framework fault rather than a data one.
        var value = UniqueData.Telephone();

        value.Should().MatchRegex("^[0-9]{10}$", because: "11-20 digits pass the schema and then 500 (§11)");
    }

    [Test]
    public void Telephone_and_LastName_do_not_repeat_across_calls()
    {
        // The whole purpose of the class: two scenarios in one run must not collide on a unique field.
        var phones = Enumerable.Range(0, 50).Select(_ => UniqueData.Telephone()).ToList();
        var names = Enumerable.Range(0, 50).Select(_ => UniqueData.LastName("Owner")).ToList();

        phones.Should().OnlyHaveUniqueItems();
        names.Should().OnlyHaveUniqueItems();
    }

    [Test]
    public void PetTypeName_stays_within_eighty_characters()
    {
        UniqueData.PetTypeName(new string('B', 100)).Length.Should().BeLessThanOrEqualTo(80);
    }

    [Test]
    public void Date_is_invariant_even_on_a_culture_that_formats_dates_differently()
    {
        // The measured failure this guards: on uk-UA a culture-sensitive ToString() produces
        // "14.05.2020" and the request comes back 400. The culture is restored in `finally` because
        // leaking it would silently change every test that runs after this one.
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("uk-UA");

            UniqueData.Date(new DateTime(2020, 5, 14)).Should().Be("2020-05-14");
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
```

- [ ] **Step 4: Run both prototypes — one of them will be RED, and that is the point**

Run: `dotnet test framework/ApiTests.sln --nologo --filter TestCategory=Unit`
Expected: `Failed: 1, Passed: 8`. The red one is
`Telephone_and_LastName_do_not_repeat_across_calls`, and it has found a **real defect in the accepted
framework** — not a defect in the test.

Measured: `Telephone()` produced **11 to 24 duplicates out of 50** consecutive calls across five
rounds, `LastName` 10 to 22. Root cause in `Support/UniqueData.cs`:

```csharp
private static ulong NextToken() =>
    (ulong)Interlocked.Increment(ref _counter) ^ (ulong)DateTime.UtcNow.Ticks;
```

Both operands move in the same low bits, so the XOR destroys the counter's monotonicity: counter 2
with ticks 4 and counter 3 with ticks 5 both give 6. Spaced one millisecond apart the same code
produced **zero** duplicates — which is exactly why twenty integration scenarios at HTTP cadence never
caught it, and why rubric check 5, which reads the code, never saw it.

**Do not fix `UniqueData.cs`.** It is stage 0's output and phase B regenerates it; the requirement
written in step 12 is what makes the regeneration produce a correct one. Record the measurement and
carry on — the readiness work in steps 5–8 is orthogonal to it.

This is the clearest evidence the experiment has produced: a defect that the 23-test suite, the
judge, and the mutation control all missed, found by one unit test costing milliseconds.

- [ ] **Step 5: Measure the defect these tests cannot dodge — with Docker STOPPED**

Reqnroll generates an assembly-level `[SetUpFixture]` in
`obj/Debug/net8.0/NUnit.AssemblyHooks.PetClinic_ApiTests.cs`, whose `[OneTimeSetUp]` calls
`TestRunnerManager.OnTestRunStartAsync`. That fires `ScenarioHooks`'s `[BeforeTestRun]` ->
`ReadinessProbe.WaitUntilReady()`, budget 90 s. NUnit runs that fixture for **any** test run in the
assembly, so a filter changes nothing.

Prove it rather than trust it:

```bash
docker stop petclinic
dotnet test framework/ApiTests.sln --nologo --filter TestCategory=Unit
```

Expected: **FAIL** after roughly 90 seconds, the stack naming
`PetClinic_ApiTests_NUnitAssemblyHooks.AssemblyInitializeAsync()`. Record the wall clock.

This is the measurement that killed the original plan: it had a `dotnet test (unit)` gate step for
rows S4..S13, none of which has a `sut reset` to bring the container up. On a from-scratch run that
is three red gates and `K_FAILURES` ends it. The step is gone from Task 3; what follows makes the
underlying defect fixable.

- [ ] **Step 6: Prototype the fix — readiness moves to `[BeforeScenario]`, memoised**

In `framework/src/PetClinic.ApiTests/Hooks/ScenarioHooks.cs`, replace the `[BeforeTestRun]` hook:

```csharp
    // Readiness is a SCENARIO precondition, not a test-run one, and the difference is measurable.
    //
    // Reqnroll generates an assembly-level [SetUpFixture] that calls OnTestRunStartAsync for ANY test
    // run in this assembly, so a [BeforeTestRun] probe made `dotnet test --filter TestCategory=Unit`
    // wait 90 seconds for an API those tests never call -- measured at 96 s and red with the container
    // stopped. A unit test has no scenario, so this hook never fires for it.
    //
    // Order = -1 so it runs before RegisterServices; the probe needs no container of its own. Memoised
    // through Lazy<Task>, so the first scenario waits and the rest do not -- behaviour identical to a
    // once-per-run probe for the suite that actually talks to the API.
    private static readonly Lazy<Task> Ready = new(() => ReadinessProbe.WaitUntilReady());

    [BeforeScenario(Order = -1)]
    public Task WaitForTheApi() => Ready.Value;
```

- [ ] **Step 7: Prove the fix — still with Docker STOPPED**

```bash
dotnet test framework/ApiTests.sln --nologo --filter TestCategory=Unit
```

Expected: `Passed! - Failed: 0, Passed: 9` **in seconds**, with the container still down. If it still
waits, something else holds a `[BeforeTestRun]` hook — find it before going on.

- [ ] **Step 8: Prove the fix did not break the suite that does need the API**

```bash
docker start petclinic && node scripts/sut.mjs reset
dotnet test framework/ApiTests.sln --nologo
```

Expected: `Failed: 0, Passed: 32` — the 23 existing plus the 9 unit tests. The three smoke tests keep
their own `[OneTimeSetUp]` readiness probe, so they are unaffected either way; what this proves is
that the twenty BDD scenarios still get a ready API through the scenario hook.

- [ ] **Step 9: Record the evidence — this is what the requirements rest on**

Append to a scratch note (not a repository file): the ~90 s red from step 5, the seconds-long green
from step 7, and the 32/32 from step 8. Three numbers, and they are the whole case for the two
requirements written below.

- [ ] **Step 10: Delete the prototypes and revert the hook**

```bash
rm -rf framework/src/PetClinic.ApiTests/Tests/Unit
git restore framework/src/PetClinic.ApiTests/Hooks/ScenarioHooks.cs
git status --porcelain --untracked-files=normal -- framework
```

Expected: the `git status` output is **empty**.

They are stage 0's output. Keeping them would mean the next `reset-run --yes` destroys them, and until
then the manifest would be satisfied by a human's work rather than the loop's.

- [ ] **Step 11: Confirm the requirement is now live and unsatisfied**

Run: `node scripts/check-scaffold.mjs`
Expected: FAIL, naming both missing files, e.g.
`framework/src/PetClinic.ApiTests/Tests/Unit/ApiResponseTests.cs: missing`

This red is correct and informative: the accepted scaffold predates the requirement, and the next
stage-0 run is what satisfies it.

Also add the probe that pins the readiness placement. In `scripts/manifest.scaffold.mjs`, change the
`Hooks/ScenarioHooks.cs` entry's probes to require the scenario-scoped form and refuse the old one:

```javascript
    // `BeforeScenario` for readiness, and NOT `BeforeTestRun`: the second makes every `dotnet test`
    // in this assembly wait for the SUT, filter or no filter — measured at 96 s and red with the
    // container stopped. The negative half of this probe is the load-bearing half.
    probes: [/BeforeScenario/, /RegisterInstanceAs/, /Drain/, /Lazy<Task>/],
```

Note the swap: `/BeforeTestRun/` and `/AfterScenario/` leave, `/RegisterInstanceAs/` and
`/Lazy<Task>/` arrive. `/BeforeTestRun/` has to go — it is now the shape being forbidden. Dropping
`/AfterScenario/` is safe because `/Drain/` fingerprints the same hook and nothing else in the file
calls it.

A regex cannot express "and no `[BeforeTestRun]` anywhere", so that half belongs to the invariants if it
is wanted later; `Lazy<Task>` is the fingerprint of the memoised scenario-scoped form and is enough to
tell the two apart in practice.

- [ ] **Step 12: Write the DoD into the tracker**

Task 2 already added both paths to the **Files** lines of S4 and S6. This step adds what the tests must
prove, so a turn knows what "done" means.

In `loop/trackers/scaffold.md`, under `### S4 — HTTP core`, append to the DoD paragraph:

```markdown
`Tests/Unit/ApiResponseTests.cs` proves by running, not by inspection, that `EnsureStatus` throws with
**both** codes and the response body in the message, and that it is silent on the expected code. Every
one of the twenty scenarios routes its response-code checks through this one method, so a failure that
does not show the body costs its reader a reproduction. Mark the fixture `[Category("Unit")]`: the gate
runs these before the SUT exists, so they must need no HTTP and no Docker.
```

Under `### S6 — UniqueData`, replace the DoD sentence with:

```markdown
**DoD:** `Tests/Unit/UniqueDataTests.cs` proves, by running: `LastName("Testowner")` appends a
**letters-only** suffix and stays within 30 characters; `LastName` trims an over-long base rather than
overflowing; `Telephone()` returns exactly 10 digits; **`PetName` stays within 30** and `PetTypeName`
within 80; repeated calls do not collide; and `Date` formats `yyyy-MM-dd` **with `CultureInfo.CurrentCulture` set to `uk-UA`**,
restoring the culture in a `finally`. Mark the fixture `[Category("Unit")]`.
```

Under `### S11 — BDD wiring`, replace the readiness sentence of the DoD:

```markdown
Readiness is awaited in `[BeforeScenario(Order = -1)]`, memoised behind a `Lazy<Task>` — **not** in
`[BeforeTestRun]`. Reqnroll generates an assembly-level `[SetUpFixture]` that runs for any test run in
the assembly, so a `[BeforeTestRun]` probe makes even `dotnet test --filter TestCategory=Unit` wait out
the readiness budget: measured at 96 s and red with the container stopped. A unit test has no scenario,
so a scenario hook never fires for it, while the twenty BDD scenarios still get a ready API. The three
smoke tests keep their own `[OneTimeSetUp]` probe and are unaffected either way.
```

- [ ] **Step 13: Verify the manifest and the tracker still agree**

Run: `node --test tests/manifest.test.mjs`
Expected: PASS — `tests/manifest.test.mjs` re-derives the row→file mapping from the tracker and fails
on any disagreement.

- [ ] **Step 14: Verify the harness suite and the invariants are unaffected**

Run: `node --test`
Expected: `fail 0`

Run: `node scripts/check-invariants.mjs`
Expected: exit 0 — deleting the prototypes returned `framework/` to its accepted state, so every
invariant must still be green.

- [ ] **Step 15: Prepare the commit — do not run it**

```bash
git add loop/trackers/scaffold.md scripts/manifest.scaffold.mjs
git commit -m "feat(scaffold): require stage 0 to prove its data constraints by running them"
```

Note that `framework/` appears in neither the staged set nor the diff: the prototypes were deleted and
the accepted scaffold is untouched.

---

## Task 12: The canary becomes a requirement stage 0 must satisfy

Same boundary as Task 11, and the same order: prove it works, throw the prototype away, leave the
requirement in the input. Here the proving matters more, because three things about the canary are
genuinely unknown until something runs:

1. whether Reqnroll picks up a `.feature` that is **not** under `Features/`;
2. whether `@F00` / `@AC-F00-01` resolve through `TestDataProvider`;
3. whether the canary actually **exercises** the container, rather than passing vacuously.

Unlike Task 11, the manifest does **not** yet carry the canary's files — Task 2 added only the two
unit-test entries. This task adds them.

**On the data file's name.** It is `F00-framework-wiring.json`, not `FrameworkWiring.json`, and the
name is load-bearing: Task 10's Fix 1 makes `TestDataProvider` find a flow's data file by looking for
the one in `Data/` whose name starts with the feature's tag. `@F00` therefore finds
`F00-framework-wiring.json` with no map entry anywhere. The requirement written in step 11 relies on
that and asks for no C# change at all.

The **prototype**, however, runs against the accepted framework, whose map is still closed — Task 10
reverted its own prototype. So step 1 adds the map line for the duration of the prototype and step 9
takes it back out. That asymmetry is the point: the prototype needs it, the requirement does not.

**Files:**
- Prototype, then delete: `framework/src/PetClinic.ApiTests/Tests/Smoke/F00-framework-wiring.feature`
- Prototype, then delete: `framework/src/PetClinic.ApiTests/Data/F00-framework-wiring.json`
- Prototype, then revert: `framework/src/PetClinic.ApiTests/TestData/TestDataProvider.cs`
- Modify: `scripts/manifest.scaffold.mjs`
- Modify: `loop/trackers/scaffold.md`

- [ ] **Step 1: Give the prototype a way to resolve its data file**

The accepted framework still resolves data files from a closed map — Task 10 turned that into a
requirement and reverted the prototype that satisfied it. So for the duration of *this* prototype, add
the line by hand. In `framework/src/PetClinic.ApiTests/TestData/TestDataProvider.cs`, extend
`FeatureFiles`:

```csharp
        ["F00"] = "F00-framework-wiring.json",
```

Step 9 reverts it. The requirement in step 11 needs no such line, because by then resolution is by
tag.

- [ ] **Step 2: Write the canary's data block**

Create `framework/src/PetClinic.ApiTests/Data/F00-framework-wiring.json`:

```json
{
  "AC-F00-01": {
    "owner": {
      "firstName": "Wiring",
      "lastName": "Canary",
      "address": "1 Framework Way",
      "city": "Wiring City",
      "telephone": "0501112233"
    },
    "pet": {
      "name": "Canary",
      "birthDate": "2021-01-15"
    }
  }
}
```

- [ ] **Step 3: Write the canary scenario**

Create `framework/src/PetClinic.ApiTests/Tests/Smoke/F00-framework-wiring.feature`:

```gherkin
@F00
Feature: F-00 Framework wiring

  Not an acceptance criterion and not part of the traceability. This scenario exists to EXECUTE the
  Reqnroll pipeline the twenty generated scenarios depend on, inside stage 0, before any of them is
  written: the BeforeScenario hook and its five container registrations, ScenarioState, the lookup of
  test data by the scenario's own tag, the request steps themselves, and the AfterScenario drain
  through the container. The smoke suite next door is plain NUnit and reaches the data provider
  through a seam, so none of that had ever run.

  It lives outside Features/ on purpose: the stage-1 gate counts the scenarios in that directory and
  fences turns out of Tests/, so this file can neither disturb that arithmetic nor be edited by a
  stage-1 turn. Every step below already exists — the canary adds no step definitions, which is what
  keeps it out of the step inventory and out of any ambiguity with a stage-1 sentence.

  @AC-F00-01
  Scenario: AC-F00-01 the framework resolves its data, state and services through Reqnroll
    When an owner is registered
    When the pet types directory is requested
    When a pet is added to the owner
    When the owner details are opened
```

- [ ] **Step 4: Unknown 1 — does Reqnroll pick up a feature outside `Features/`?**

Run:

```bash
dotnet build framework/ApiTests.sln --nologo && find framework/src/PetClinic.ApiTests -name "F00-framework-wiring.feature*" -not -path "*/bin/*"
```

Expected: the build succeeds and a generated artefact appears — `F00-framework-wiring.feature.cs`
beside the feature, or `F00-framework-wiring.feature.ndjson` under `obj/`.

**If nothing was generated,** the build glob does not reach `Tests/Smoke/`. Add to
`framework/src/PetClinic.ApiTests/PetClinic.ApiTests.csproj`:

```xml
  <ItemGroup>
    <ReqnrollFeatureFiles Include="Tests/Smoke/**/*.feature" />
  </ItemGroup>
```

Re-run the build. **Record whether this was needed** — if it was, the csproj is a stage-0 file (row S1)
and the include becomes part of S1's requirement in step 11.

- [ ] **Step 5: Unknown 2 — does the tag resolve? Run the canary against a clean SUT**

Run:

```bash
node scripts/sut.mjs reset && dotnet test framework/ApiTests.sln --nologo --filter "FullyQualifiedName~Wiring"
```

Expected: `Passed! - Failed: 0, Passed: 1`

If it fails with `Feature '...' carries no known flow tag` the map line from step 1 did not take; if it
fails with `carries no '@AC-' tag` the scenario tag is wrong. Both are constraints of the provider that
this step exists to verify.

If the filter matches nothing at all, Reqnroll's generated class name does not contain `Wiring`; use
the tag instead: `--filter "TestCategory=AC-F00-01"`.

- [ ] **Step 6: Unknown 3 — prove the canary is not passing vacuously**

Design-document criterion 5. **Removing one `RegisterInstanceAs` does NOT work** — that was this
plan's first guess and it is measurably a no-op. Reqnroll's BoDi container auto-constructs any
concrete type whose constructor arguments it can already resolve, so deleting `PetsService`'s
registration just makes BoDi rebuild it from the still-registered `ApiClient`. Measured, each run
separately:

| mutation | result |
|---|---|
| `// …RegisterInstanceAs(new PetsService(ApiClient.Shared));` | **Passed: 1** |
| `// …RegisterInstanceAs(new OwnersService(ApiClient.Shared));` | **Passed: 1** |
| `// …RegisterInstanceAs(ApiClient.Shared);` | **Passed: 1** |

Not one of the five lines is individually load-bearing. `ApiClient.Shared` is not even resolved *from*
the container — the four services are handed it directly.

**Use this mutation instead.** Comment out the hook attribute itself, one line:

```csharp
    // [BeforeScenario(Order = 0)]
    public void RegisterServices()
```

Run: `dotnet test framework/ApiTests.sln --nologo --filter "FullyQualifiedName~Wiring"`
Expected: **FAIL**, and the message must name the resolution chain:

```
Circular dependency found! System.Uri (resolution path:
  …StepDefinitions.OwnerSteps→…Services.OwnersService→…Http.ApiClient→RestSharp.RestClient→System.Uri)
```

That error is the proof: BoDi walked the whole chain from the step definition down to the HTTP client
and could not finish it. Commenting out all five registrations produces the same failure, if you want
a second data point.

Then **restore the line exactly**, confirm `git diff --stat` on that file is empty, and re-run:
Expected: PASS

**If a mutation passes, that means the mutation is a no-op — not that the canary is vacuous.** The
first version of this step drew the opposite conclusion and would have declared the task void on the
strength of a badly chosen mutant. Isolate the cause before concluding anything.

- [ ] **Step 7: Confirm the canary is invisible to the stage-1 machinery**

Run:

```bash
node scripts/steps-inventory.mjs && grep -c "AC-F00" loop/STEPS.md
```

Expected: `0` — the inventory scans `StepDefinitions/` and `Features/` only.

Run: `node scripts/check-tests.mjs --ac AC-F01-01`
Expected: the scenario-count check still balances and nothing mentions the canary. Any complaint about
`F00-framework-wiring` means the fence or the counter reaches further than the design assumed — stop
and report.

- [ ] **Step 8: Record the evidence**

In the scratch note, record: whether the csproj include was needed, the passing run from step 5, both
outcomes from step 6, and the two zero counts from step 7. Those four facts are what make the
requirement in step 11 safe to declare.

- [ ] **Step 9: Delete the prototype and revert the framework to its accepted state**

```bash
rm framework/src/PetClinic.ApiTests/Tests/Smoke/F00-framework-wiring.feature
rm framework/src/PetClinic.ApiTests/Data/F00-framework-wiring.json
git restore framework/src/PetClinic.ApiTests/TestData/TestDataProvider.cs
```

If step 4 added the csproj include, revert that too:

```bash
git restore framework/src/PetClinic.ApiTests/PetClinic.ApiTests.csproj
```

Verify nothing of the prototype is left:

```bash
git status --porcelain --untracked-files=normal -- framework
```

Expected: **empty**. `framework/` is back to the accepted scaffold.

- [ ] **Step 10: Add the manifest entries for the canary**

In `scripts/manifest.scaffold.mjs`, beside the existing S14 entries (the smoke suite and its data
file), add:

```javascript
  // The canary. S14 owns "the acceptance mechanism", and this is its Reqnroll half: the smoke tests
  // are plain NUnit and prove the services, while this one scenario is the only thing in stage 0 that
  // executes the hooks, the container, ScenarioState, the tag-to-data lookup and the request steps.
  //
  // Outside Features/ on purpose -- check-tests.mjs counts scenarios only there, and Tests/ is outside
  // the stage-1 fence, so a stage-1 turn can neither disturb the count nor edit the file. The data
  // file's name starts with the flow tag because that is how the provider finds it (S10's DoD).
  {
    path: p('Tests/Smoke/F00-framework-wiring.feature'),
    row: 'S14',
    wave: 8,
    probes: [/@F00\b/, /@AC-F00-01\b/, /Scenario\s*:/],
  },
  {
    path: p('Data/F00-framework-wiring.json'),
    row: 'S14',
    wave: 8,
    probes: [/AC-F00-01/, /owner/, /pet/],
  },
```

**If step 4 needed the csproj include,** add `/ReqnrollFeatureFiles/` to the probes of the
`PetClinic.ApiTests.csproj` entry as well.

**And move the pinned counts — but NOT the way Task 2 did, and the difference matters.**

Two more entries takes the manifest from 41 to 43. What moves:

| Pin | Where | Change |
|---|---|---|
| `SCAFFOLD_MANIFEST.length` | `tests/manifest.test.mjs` | 41 → 43 |
| the tracker-derived file count, `… 14 rows naming 38 files` | `tests/manifest.test.mjs` | 38 → 40, because step 11 adds two paths to S14's `**Files:**` line |
| `all 41 manifest entries` — test title and output regex | `tests/check-scaffold.test.mjs` | 41 → 43 |

What does **not** move: the `S1..S6`, `S1..S7` and `waves 1–4` counts. The canary is **S14**, outside
every one of those ranges. If one of them moves, something is wrong.

**Do NOT add the canary paths to `check-scaffold.test.mjs`'s `FILES` fixture.** That fixture is pinned
by `test('the fixture holds exactly the manifest entries of rows S1..S6')`, a `deepEqual` against
`entriesThroughRow('S6')` — adding an S14 path fails it. Task 11's two files were S4 and S6, inside
the range, which is why the instruction worked there; copying it here is wrong. Measured: adding them
gives `fail 2`, with both canary paths shown as unexpected extras.

No probe is added to `TestData/TestDataProvider.cs` for the canary: Task 10 already requires that class
to resolve a data file by tag, and under that rule `@F00` finds this file with no entry to add.

- [ ] **Step 11: Write the DoD into the tracker**

In `loop/trackers/scaffold.md`, under `### S14 — Smoke suite`, extend the **Files:** line with
`, `PROJECT/Tests/Smoke/F00-framework-wiring.feature`, `PROJECT/Data/F00-framework-wiring.json`` and
append to the DoD:

```markdown
Plus **the canary**: one Gherkin scenario in `Tests/Smoke/F00-framework-wiring.feature`, tagged `@F00`
on the `Feature:` line and `@AC-F00-01` on the scenario, whose steps are **existing request steps
only** — it adds no step definition, so it cannot collide with a stage-1 sentence or appear in
`loop/STEPS.md`. Its data lives in `Data/F00-framework-wiring.json` under the key `AC-F00-01`; the file
name starts with the flow tag because that is how S10's provider finds it, so no map entry and no C#
change are needed.

Why it exists: the three smoke tests are plain NUnit and reach `TestDataProvider` through an internal
seam, so `ResolveFeatureFile`, `ResolveAcTag`, the `BeforeScenario` registrations, `ScenarioState`, the
22 request steps and the `AfterScenario` drain through the container are otherwise **never executed in
stage 0 at all** — their first run would be inside stage 1's first paid iteration, which is also the
iteration that becomes the exemplar every later one copies.

It must not pass vacuously: removing one `RegisterInstanceAs` from `ScenarioHooks` has to turn it red.

The file lives outside `Features/` deliberately. `scripts/check-tests.mjs` counts the scenarios in that
directory against the tracker's `done` rows, and `Tests/` is outside the stage-1 fence.
```

- [ ] **Step 11a: The row's summary title now understates it**

S14's line in the tracker table reads `The three smoke tests and their data file`. The row owns four
files now. Change it to `The three smoke tests, the wiring canary, and their data files`. Nothing
pins this string, which is exactly why it would otherwise rot.

- [ ] **Step 12: Verify everything agrees**

Run: `node --test tests/manifest.test.mjs`
Expected: PASS

Run: `node scripts/check-scaffold.mjs`
Expected: FAIL, naming **six** things — the two unit tests from Task 11, the two canary files, the
`EnumerateFiles` probe on `TestData/TestDataProvider.cs` from Task 10, and the `Lazy<Task>` probe on
`Hooks/ScenarioHooks.cs` from Task 11. All six are requirements that are live and unsatisfied until
stage 0 runs again.

Run: `node --test`
Expected: `fail 0`

Run: `node scripts/check-invariants.mjs`
Expected: exit 0 — `framework/` is back to the accepted scaffold, so every invariant is green.

- [ ] **Step 13: Prepare the commit — do not run it**

```bash
git add scripts/manifest.scaffold.mjs loop/trackers/scaffold.md \
        tests/manifest.test.mjs tests/check-scaffold.test.mjs
git commit -m "feat(scaffold): require stage 0 to execute the Reqnroll pipeline it builds"
```

`framework/` must appear in neither the staged set nor the diff.

---

## Task 13: The agent's cost becomes a recorded number

Today the run summary records what the **judge** cost and says nothing about the **agent** — and that is
documented as a deliberate trade, not an oversight. `loop/telemetry.mjs`:

> The AGENT's usage is deliberately absent, and that is a limitation rather than an oversight. Its
> stdio is inherited so a human can watch the turn, which is worth more than the number would be.

The trade was between "watch the turn" and "know what it cost". `--output-format stream-json` removes
the choice: it emits one JSON object per line **as the turn runs**, so the runner can relay readable
output *and* take `usage` / `total_cost_usd` from the final object.

Half the work already exists. `parseJudgeReply`'s `lastEnvelope` was written for exactly this shape:

> The LAST one, because `--output-format stream-json` emits one JSON object per line and only the final
> one carries the result.

**Why before phase B and not after:** the point of the number is to price a real run. A regeneration
that happens without it produces the one measurement worth having and throws it away.

**The trade this makes, stated plainly.** The agent's stdout stops being inherited byte for byte. The
operator still sees the turn — each assistant message and each tool call is relayed as it arrives — but
it is the runner's rendering, not the CLI's own. If that visibility matters more than the number, this
task is the one to drop.

**Files:**
- Modify: `loop/invoke.mjs`
- Modify: `loop/config.mjs`
- Modify: `loop/telemetry.mjs`
- Modify: `tests/invoke.test.mjs`, `tests/config.test.mjs`, `tests/telemetry.test.mjs`

- [ ] **Step 1: Write the failing test for the relay and the capture**

Append to `tests/invoke.test.mjs`:

```javascript
// ── The agent turn is watched AND priced ─────────────────────────────────────────────

test('runAgent returns the usage the stream reported, and relays the text it saw', async () => {
  // A stub that speaks the stream-json shape: one object per line, the result last. No `claude`
  // involved — this test must never be able to spend money.
  const stub = join(tmpdir(), `agent-stub-${process.pid}.mjs`);
  writeFileSync(
    stub,
    [
      "process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'writing the scenario' }] } }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33, cache_creation_input_tokens: 44 }, total_cost_usd: 0.5, duration_ms: 1234 }) + '\\n');",
    ].join('\n')
  );

  const relayed = [];
  const result = await runAgent(`${process.execPath} ${stub}`, 'the prompt', {
    root: process.cwd(),
    onOutput: (line) => relayed.push(line),
  });

  assert.equal(result.ok, true, result.why);
  assert.deepEqual(result.usage, {
    inputTokens: 11,
    outputTokens: 22,
    cacheReadTokens: 33,
    cacheWriteTokens: 44,
    costUsd: 0.5,
    durationMs: 1234,
  });
  assert.ok(
    relayed.some((line) => line.includes('writing the scenario')),
    `the operator must still see the turn; relayed:\n${relayed.join('\n')}`
  );
  rmSync(stub, { force: true });
});

test('runAgent still succeeds, with no usage, for a tool that does not speak the envelope', async () => {
  // AGENT_CMD is documented as pluggable. A tool that prints plain text must keep working, and must
  // report `usage: null` rather than zeroes — "nobody said" is not "it was free".
  const stub = join(tmpdir(), `agent-plain-${process.pid}.mjs`);
  writeFileSync(stub, "process.stdout.write('just some text\\n');");

  const result = await runAgent(`${process.execPath} ${stub}`, 'p', { root: process.cwd() });

  assert.equal(result.ok, true, result.why);
  assert.equal(result.usage, null);
  rmSync(stub, { force: true });
});

test('an agent that exits non-zero is still a failed turn, usage or no usage', async () => {
  const stub = join(tmpdir(), `agent-fail-${process.pid}.mjs`);
  writeFileSync(stub, 'process.exit(3);');

  const result = await runAgent(`${process.execPath} ${stub}`, 'p', { root: process.cwd() });

  assert.equal(result.ok, false);
  assert.match(result.why, /exit code 3/);
  rmSync(stub, { force: true });
});
```

Extend the imports at the top of `tests/invoke.test.mjs`:

```javascript
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
```

Merge with whatever that file already imports rather than duplicating.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/invoke.test.mjs`
Expected: FAIL — `result.usage` is `undefined`, and `onOutput` is never called

- [ ] **Step 3: Make `runAgent` capture and relay**

In `loop/invoke.mjs`, replace the body of `runAgent`'s `new Promise(...)` with:

```javascript
  return new Promise((done) => {
    const child = spawn(bin, useStdin ? args : [...args, prompt], {
      cwd: root,
      // stdout is PIPED, not inherited, and that is the whole change. Inherited stdio is what ruled
      // out knowing the turn's cost: the numbers arrive in the stream, and an inherited stream cannot
      // be read. stderr stays inherited so a crash still lands in front of the operator untouched.
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'inherit'],
      shell: process.platform === 'win32',
      env: childEnv,
    });
    onSpawn?.(child);

    // Relayed as it arrives, line by line, so the turn can still be watched. Not byte-identical to the
    // CLI's own rendering — that is the price of the number, and it is stated in the plan.
    let buffered = '';
    let lastLine = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        lastLine = line;
        const text = readableLine(line);
        if (text !== null) (onOutput ?? ((value) => process.stdout.write(`${value}\n`)))(text);
      }
    });

    const stdin = useStdin ? pipePrompt(child, prompt) : null;

    child.on('error', (error) => done({ ok: false, usage: null, why: error.message }));
    child.on('close', (code) => {
      // The tail, in case the last line arrived without a newline.
      const all = buffered.trim() === '' ? lastLine : `${lastLine}\n${buffered}`;
      done({
        ok: code === 0 && !stdin?.error,
        usage: parseJudgeReply(all).usage,
        why: closeReason(code, stdin),
      });
    });
  });
```

Add the parameter to the signature — `onOutput` beside the others:

```javascript
export function runAgent(command, prompt, { root, env = {}, onSpawn, onOutput } = {}) {
```

Add the import at the top of `loop/invoke.mjs`:

```javascript
import { parseJudgeReply } from './telemetry.mjs';
```

And the renderer, above `runAgent`:

```javascript
/**
 * One stream-json line rendered for a human, or `null` when there is nothing worth showing.
 *
 * A tool that does not speak the envelope prints plain text, and that text is passed through
 * unchanged — `AGENT_CMD` is documented as pluggable and this must not turn another tool's output
 * into silence.
 */
function readableLine(line) {
  const text = line.trim();
  if (!text.startsWith('{')) return line;

  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return line; // not JSON after all; show it rather than swallow it
  }

  if (event.type === 'assistant') {
    const parts = event.message?.content ?? [];
    const rendered = parts
      .map((part) =>
        part.type === 'text' ? part.text : part.type === 'tool_use' ? `· ${part.name}` : null
      )
      .filter((value) => value !== null && value !== '')
      .join('\n');
    return rendered === '' ? null : rendered;
  }
  if (event.type === 'result') return `· turn ended: ${event.subtype ?? 'result'}`;
  return null; // system/user bookkeeping — the operator does not need it
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/invoke.test.mjs`
Expected: PASS

- [ ] **Step 5: Write the failing test for the summary columns**

Append to `tests/telemetry.test.mjs`:

```javascript
test('a summary row carries the agent usage beside the judge usage', () => {
  const row = summaryRow({
    iteration: 3,
    row: 'S6',
    phase: 'agent',
    outcome: 'judged',
    verdict: 'PASS',
    usage: { inputTokens: 2, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 100, costUsd: 0.5, durationMs: 1 },
    agentUsage: { inputTokens: 5, outputTokens: 900, cacheReadTokens: 7000, cacheWriteTokens: 20, costUsd: 1.25, durationMs: 2 },
    seconds: 42,
    note: '',
  });

  assert.match(row, /\| \$0\.5000 \|/, 'the judge cost must still be there');
  assert.match(row, /\| \$1\.2500 \|/, 'the agent cost is the number this adds');
  assert.match(row, /900/, 'agent output tokens');
});

test('an agent that reported nothing renders as unknown, never as free', () => {
  const row = summaryRow({ iteration: 1, row: 'S1', phase: 'agent', outcome: 'gate red', agentUsage: null });
  assert.doesNotMatch(row, /\$0\.0000/, 'a zero cost is a claim; "not reported" is not that claim');
});

test('the header names as many columns as a row has cells', () => {
  // The two drifted apart once already; this is what stops it happening again.
  const header = summaryHeader({
    startedAt: '2026-08-20T00:00:00.000Z',
    stage: 'scaffold',
    flow: null,
    branch: 'b',
    agentCmd: 'a',
    judgeCmd: 'j',
    stops: { maxIter: 1, kFailures: 1, noImprovement: 1 },
  });
  const names = header.split('\n').find((line) => line.startsWith('| iter'));
  const row = summaryRow({ iteration: 1, row: 'S1', phase: 'agent', outcome: 'judged' });
  assert.equal(row.split('|').length, names.split('|').length);
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `node --test tests/telemetry.test.mjs`
Expected: FAIL — the agent columns do not exist

- [ ] **Step 7: Add the agent columns**

In `loop/telemetry.mjs`, replace the `COLUMNS` constant:

```javascript
// Column order of the per-iteration table. Named once so the header and the rows cannot drift.
//
// The judge's numbers are prefixed `j-` and the agent's `a-`, because until this task the table had one
// unlabelled set and a reader had to know which. Both are recorded now, and a run summary that shows
// only one of them is a run summary that hides most of the cost: the agent turn is the larger half.
const COLUMNS = ['iter', 'row', 'phase', 'outcome', 'judge', 'j-in', 'j-out', 'j-cost', 'a-in', 'a-out', 'a-cost', 'sec', 'note'];
```

Extend `summaryRow` to take `agentUsage` and emit its three cells:

```javascript
export function summaryRow({
  iteration,
  row,
  phase,
  outcome,
  verdict = '',
  usage = null,
  agentUsage = null,
  seconds = null,
  note = '',
}) {
  const cost = (value) => (value === null || value.costUsd === null ? '—' : `$${value.costUsd.toFixed(4)}`);
  const values = [
    String(iteration),
    row,
    phase,
    outcome,
    verdict || '—',
    usage === null ? '—' : tokens(usage),
    usage?.outputTokens ?? '—',
    cost(usage),
    agentUsage === null ? '—' : tokens(agentUsage),
    agentUsage?.outputTokens ?? '—',
    cost(agentUsage),
    seconds === null ? '—' : seconds.toFixed(0),
    cell(note),
  ];
  return `| ${values.join(' | ')} |`;
}
```

And in `summaryTotals`, add the agent line beside the judge one — replacing the standing caveat, which
is no longer true:

```javascript
    `- judge usage: ${usage ? usageLine(usage) : 'not reported by this JUDGE_CMD'}`,
    `- agent usage: ${agentUsage ? usageLine(agentUsage) : 'not reported by this AGENT_CMD'}`,
```

Give `summaryTotals` the `agentUsage` parameter, and delete the two closing lines that say the agent's
usage is not captured.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test tests/telemetry.test.mjs`
Expected: PASS

- [ ] **Step 9: Thread the number through the runner**

In `loop/ralph.mjs`, keep what `runAgent` returns:

```javascript
    const { ok, why, usage: agentUsage } = await runAgent(config.agentCmd, prompt, {
```

Declare `let turnAgentUsage = null;` beside `headBeforeTurn`, assign it from the destructured value,
and pass `agentUsage: turnAgentUsage` in **both** `record({...})` calls — the failure branch and the
judged one. A turn that failed still cost what it cost, and leaving it out of the red rows would make
the totals understate exactly the turns worth understanding.

Add the running total beside the judge's, next to `judgeUsageTotal`:

```javascript
let agentUsageTotal = null;
```

accumulate it in `record` with the existing `addUsage`, and pass it to `summaryTotals`.

- [ ] **Step 10: Change the default AGENT_CMD**

In `loop/config.mjs`:

```javascript
// `--output-format stream-json --verbose` is what makes the agent's cost recordable. The stream emits
// one JSON object per line AS THE TURN RUNS, so the runner relays the text to the console and takes
// `usage` and `total_cost_usd` from the final object — the trade that used to be "watch it or price it"
// is no longer a trade. `--verbose` is required by the CLI for this format under `--print`.
const DEFAULT_AGENT_CMD =
  'claude -p --model claude-sonnet-5 --permission-mode auto --output-format stream-json --verbose';
```

Add to `tests/config.test.mjs`:

```javascript
test('the default agent command asks for the format its cost can be read from', () => {
  const { agentCmd } = stageConfig('tests', {});
  assert.match(agentCmd, /--output-format stream-json/);
  assert.match(agentCmd, /--verbose/, 'the CLI requires it for this format under --print');
  assert.match(agentCmd, /claude-sonnet-5/, 'the model stays pinned by id, not by an alias');
});
```

- [ ] **Step 11: Verify without spending anything**

Run: `node --test`
Expected: `fail 0`

Run: `npm run ralph -- --dry-run --stage scaffold`
Expected: the `agent:` line shows the new command including `--output-format stream-json`, and the run
ends with `Zero tokens spent.`

**Do not run a real turn to check this.** The stub tests in step 1 cover the parsing, and the first real
measurement is phase B — which is the point of the task.

- [ ] **Step 12: Prepare the commit — do not run it**

```bash
git add loop/invoke.mjs loop/config.mjs loop/telemetry.mjs loop/ralph.mjs \
        tests/invoke.test.mjs tests/config.test.mjs tests/telemetry.test.mjs
git commit -m "feat(loop): record what the agent cost, not only the judge"
```

---

## Task 14: Final verification and the measurements the experiment turns on

**Files:** none modified. This task produces the evidence for §12 of the design document.

- [ ] **Step 1: The whole harness suite**

Run: `node --test 2>&1 | grep -E " (tests|pass|fail) [0-9]+$"`
Expected: `fail 0`, and `tests` higher than 554 by the number of tests added in Tasks 2–13.

- [ ] **Step 2: Criterion 2 — every invariant green on the accepted scaffold**

Run: `node scripts/check-invariants.mjs`
Expected: exit 0, `OK — 6 check(s)`

- [ ] **Step 3: Criterion 3 — every invariant red on its own violation**

Run: `node --test tests/invariants.test.mjs 2>&1 | grep -E " (tests|pass|fail) [0-9]+$"`
Expected: `fail 0`. Each invariant has at least one test asserting it goes red; confirm the count of
negative-control tests is at least one per invariant by reading the file's test names:

Run: `node --test tests/invariants.test.mjs --test-reporter=tap 2>&1 | grep -E "^ok .*(red|reports)"`
Expected: at least six lines.

- [ ] **Step 4: Criteria 4 and 5 — recorded as evidence, not as a passing suite**

These two cannot be met by this plan, and that is by design: the unit tests and the canary are stage
0's output, so they exist only after phase B regenerates the framework. What phase A produces is the
**evidence that the requirement is satisfiable** — collected in Task 11 step 5 and Task 12 step 8.

Confirm the accepted scaffold is untouched and still green:

```bash
git status --porcelain --untracked-files=normal -- framework && node scripts/sut.mjs reset && dotnet test framework/ApiTests.sln --nologo
```

Expected: the `git status` output is **empty**, and the suite reports `Failed: 0, Passed: 23` — the
original 23, because both prototypes were deleted.

Then restate the recorded evidence in the report: the unit tests passed 9/9, the canary passed and went
red when a container registration was removed, Reqnroll did (or did not) need the csproj include.

Criteria 4 and 5 are formally met in phase D, after `npm run ralph -- --stage scaffold` has produced
the files itself. That is the point — a canary a human wrote proves a human can write one.

- [ ] **Step 5: Criterion 6 — measure the stage-0 gate**

Measure the cheap gate (a row before the smoke suite) and the expensive one:

```bash
node -e "const{gateSteps}=await import('./loop/gates.mjs');for(const r of ['S1','S6','S13','S14'])console.log(r, gateSteps('scaffold',{row:r}).map(s=>s.name).join(' -> '))" --input-type=module
```

Expected:

```
S1  check:scaffold -> dotnet build -> check:invariants
S6  check:scaffold -> dotnet build -> check:invariants
S13 check:scaffold -> dotnet build -> check:invariants
S14 check:scaffold -> dotnet build -> check:invariants -> sut reset -> dotnet test
```

Then time one cheap gate end to end:

```bash
time (node scripts/check-scaffold.mjs --through-row S6 --quiet && dotnet build framework/ApiTests.sln --nologo && node scripts/check-invariants.mjs --through-row S6 --quiet)
```

Record the number. Before this work a stage-0 gate measured ~50 s (10 s build + 27 s Docker restart +
~12 s test host); the expectation here is ~11 s, with **no Docker involved at all** — which is why
the command above can be run with the container stopped, and should be, at least once.

- [ ] **Step 6: Confirm the Docker restart count for a whole stage**

Count the gates that still restart Docker:

```bash
node -e "const{gateSteps}=await import('./loop/gates.mjs');const{SCAFFOLD_ROWS}=await import('./scripts/manifest.scaffold.mjs');console.log(SCAFFOLD_ROWS.filter(r=>gateSteps('scaffold',{row:r}).some(s=>s.name==='sut reset')))" --input-type=module
```

Expected: `[ 'S14' ]` — one row, so one restart per stage-0 run instead of ~27.

- [ ] **Step 7: Criterion 7 and the handover to phase B**

Criterion 7 — a committed stage-0 run summary — needs a real run and spends money, so it is the
operator's decision, not the implementer's. **Do not run it.** Report which criteria stand where:

| Criterion | Met by phase A? |
|---|---|
| 1. `npm test` green | **yes** (Task 1) |
| 2. every invariant green on the accepted scaffold | **yes** (Task 9, step 2 above) |
| 3. every invariant red on its own violation | **yes** (Task 5–8, step 3 above) |
| 4. unit tests and canary green | **no** — needs phase B; evidence recorded in Tasks 11–12 |
| 5. canary goes red on broken DI | **no** — but *proven possible* in Task 12 step 6 |
| 6. gate wall clock in minutes | **yes** (steps 5–6 above) |
| 7. a committed stage-0 run summary | **no** — phase B produces it |

Phase B, for the operator to run when ready:

```bash
node scripts/reset-run.mjs            # dry run first: prints what it would delete
node scripts/reset-run.mjs --yes      # deletes framework/ and resets both trackers
npm run ralph -- --dry-run --stage scaffold
npm run ralph -- --stage scaffold
```

The stage-0 run then has to produce the two unit tests and the canary itself, because the manifest and
the tracker now require them. If it cannot, the requirement was wrong — and the evidence from Tasks 11
and 12 is what tells you which of the two it is.

- [ ] **Step 8: Report the two design-document amendments**

Both were established by measurement during implementation and the design document still states the
old version:

1. ~~**D-23** — the last-green SHA is held in memory, not in a file.~~ **Done:** §7.2 and D-23 of the
   design document were amended after Task 4 landed. §7.2 now also records two bounds found while
   implementing it — `WATCHED` is declared *below* `preGate` in file order, so the skip block reads it
   before its `const` appears (safe only because `preGate` is first called long after module
   evaluation), and "a subset of what has just been proven" holds while targets advance in manifest
   order, which `pickTarget` guarantees.
2. **I7 is dropped** — `Smoke_tracker_cleans_up_in_order` asserts only on `StatusCode`, and rightly
   so. §8.1's table, the "7 invariants" count in §12 criteria 2 and 3, and appendix B's row for rubric
   check 8 all need correcting; check 8 stays with the judge.

Show the user both, and offer to amend `docs/design/2026-08-20-stage0-redesign.md`.

- [ ] **Step 9: Show the complete working tree and stop**

Run:

```bash
git status --porcelain --untracked-files=normal && git diff --stat
```

Present the full list. **Do not commit.** The prepared commit commands from Tasks 1–11 are ready to
run in order once the user approves.

---

## Self-Review

**Spec coverage.** Every deliverable of the design document's §5 maps to a task:

| Design section | Task |
|---|---|
| §5 deliverable 0, D-31 — green baseline | 1 |
| §7.1, D-20/D-21/D-22 — runtime steps only when tests exist | 2, 3 |
| §7.2, D-23/D-24 — skip the pre-gate on an unmoved HEAD | 4 |
| §8.1 I1, I2 | 5 |
| §8.1 I4 | 6 |
| §8.1 I3 | 7 |
| §8.1 I5, I6 | 8 |
| §8.1 I7 | **dropped** — see the deviations table; verified red on accepted work |
| §8.2, D-25/D-26/D-30 — the CLI, positive and negative controls | 5–9 (each invariant carries its own controls; Task 9 adds the whole-tree positive control) |
| *(scope added after the design document — §15 of the design must be written)* — a new flow costs no framework change | 10 |
| §9, D-27 — unit tests for the primitives | 11 — as a **requirement**, prototyped and proven, not hand-written into the deliverable |
| §10, D-28/D-29 — the canary | 12 — likewise |
| *(added at the operator's request — §16 of the design)* — the agent's cost is recorded, not only the judge's | 13 |
| §12 criteria 1, 2, 3, 6 | 14 (met by this plan) |
| §12 criteria 4, 5, 7 | 14 step 7 — handed to phase B; they need a regenerated framework |

**Gaps found and closed while reviewing:**

- The design document's §8.1 lists seven invariants; this plan implements six and says why, with the
  evidence. Recorded as a deviation rather than left as a silent shortfall.
- Task 2 originally added manifest entries without touching `loop/trackers/scaffold.md`, which
  `tests/manifest.test.mjs` cross-checks. Step 6 now handles that disagreement explicitly.
- Task 3's `check:invariants` step is asserted in `tests/gates.test.mjs` before the script exists.
  Step 5 spells out that this is expected and how to confirm the failure is not in the gate tests.
- Task 12 step 6 was missing: a canary that passes vacuously proves nothing, so the plan now breaks
  the container on purpose and requires the canary to go red.
- **Tasks 11 and 12 originally wrote C# into `framework/` as deliverables.** That crossed the line
  between the harness (input, mine) and the scaffold (output, stage 0's). `scripts/reset-run.mjs`
  deletes `framework/` whole, so those files would have been destroyed by the very rerun they were
  meant to support — and a canary a human writes proves only that a human can write one. Both tasks
  now prototype, prove, delete, and leave the requirement in the manifest and the tracker.
- Following from that: the ordering constraint is now stated up front. The invariants must be
  calibrated against the **accepted** scaffold (D-30), so phase A has to finish before the reset.
- `loop/PROMPT.scaffold.md` and `loop/rubrics/scaffold.md` are denied to `Edit` and `Write` by
  `.claude/settings.json`, so no task asks to touch them. The tracker's DoD is the one writable place
  the requirement can live, and the scaffold prompt already sends every turn there.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Every code step
carries the code; every command step carries the command and its expected output.

**Type consistency.** `rowOwning(path) → string | null` and `rowNeeds(rowId, path) → boolean | null`
are defined in Task 2 and used with those exact signatures in Tasks 3 and 9. `skipPreGate({
lastGreenSha, headSha, dirty }) → boolean` is defined in Task 4 and called with exactly those three
properties in `loop/ralph.mjs`. The pure invariants return `{ path, line, match }` (I1, I2),
`Set<string>` (I3), `boolean` (I4), `{ path, method }` (I5) and `string[]` (I6) — and
`check-invariants.mjs` consumes each in that shape.
