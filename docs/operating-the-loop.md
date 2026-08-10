# Operating the loop

Bring the environment up, run the tests, watch the loop rebuild or regenerate, add criteria of your own.

---

## 1. Bring the environment up

**Required before anything else.** The tests talk to a real PetClinic in Docker on port 9966, and
nothing starts it for you. Skip this and every test fails with:

```
SUT at http://localhost:9966/petclinic/api/pettypes did not become ready within 90000 ms.
```

**Step 1 — start Docker Desktop.**

```powershell
Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
```

Or launch it from the Start menu. Either way it takes 30–90 seconds.

**Step 2 — wait until the engine answers.** Starting the app is not the same as the engine being
ready, and that gap is exactly where pressing Run looks like a test failure. This blocks until it is:

```powershell
do { Start-Sleep 5; docker version --format '{{.Server.Version}}' 2>$null } while (-not $?)
```

**Step 3 — start the application.** Creates the container if missing, then waits for readiness. The
first run pulls the image and takes a few minutes.

```bash
npm run sut -- ensure
```

**Step 4 — confirm.** `200` means go; `000` means the app is not up, return to step 1.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9966/petclinic/api/pettypes
```

---

## 2. Run the tests

```bash
dotnet test framework/ApiTests.sln --nologo
```

From Visual Studio: do section 1 first, then open `framework/ApiTests.sln` and run.

Expect **23 passing** — 3 smoke tests plus the 20 generated scenarios.

If a result looks wrong, put the database back to its seeded state and try again:

```bash
npm run sut -- reset
```

---

## 3. Rebuild everything from scratch

**Use this when you want to start from nothing and watch the loop build everything.**

It regenerates both halves: first the framework skeleton — solution, HTTP client, service objects,
data provider, hooks, step definitions — then the tests from your acceptance criteria.

The other reason is repair: the framework's design changed, or something broke badly enough that
rebuilding costs less than fixing it by hand.

About 34 iterations — batches, over more than one sitting.

**Step 1 — tag a return point.** The reset deletes `framework/` from the working tree but not from
history; the tag just makes the way back obvious.

Name it after **what the state is**, not what day it is, and annotate it. A date tells you the order
of two tags and nothing else — a month later `before-reset-2026-08-09` does not say whether that
point had a working framework, twenty tests, or half of each. This repository already has the problem:
`git tag -n` shows an existing tag as `backup-before-squash Tmp2`.

```bash
git tag -a framework-and-20-tests -m "stage 0 and stage 1 complete: 23 tests green against a live PetClinic"
```

Then the list explains itself:

```bash
git tag -n
```

**Step 2 — preview.**

```bash
npm run reset
```

**Step 3 — do it.**

```bash
npm run reset -- --yes
```

**Step 4 — commit.**

```bash
git add -A && git commit -m "chore(loop): full reset"
```

**Step 5 — build the framework first.** Stage 1 is impossible until all 14 stage-0 rows are `done` —
before that its gate has nothing to build.

```bash
MAX_ITER=2 node loop/ralph.mjs --stage scaffold
```

Commit between batches as in section 4, step 8, and repeat until the dry run reports every row done:

```bash
node loop/ralph.mjs --stage scaffold --dry-run
```

**Step 6 — then generate the tests.** Continue from section 4, step 5.

---

## 4. Regenerate the tests (keep the framework)

**Use this when you want to watch the loop generate tests, without rebuilding the framework.**

It regenerates the twenty scenarios, their step definitions and their data from your acceptance
criteria — the agent writing a scenario, the judge refusing it when a claim has nothing asserting it,
the agent fixing exactly that. The framework stays, so you only pay for the tests and can stop after
two iterations.

The other reason is repair: the criteria changed, and the scenarios describe behaviour the system no
longer has. Regenerating beats patching twenty by hand.

About 20 iterations — run it in batches.

**Step 1 — start from a clean tree.** Empty output is good.

```bash
git status --porcelain --untracked-files=normal
```

**Step 2 — preview.** Changes nothing. Check that `delete framework` is **not** in the list.

```bash
npm run reset -- --stage tests
```

**Step 3 — do it.**

```bash
npm run reset -- --yes --stage tests
```

**Step 4 — commit.** Required. The trackers are committed files, so the reset leaves the tree dirty
and the loop will refuse to start.

```bash
git add -A && git commit -m "chore(loop): reset the tests tracker"
```

**Step 5 — check the environment is alive.**

```bash
npm run sut -- ensure
```

**Step 6 — dry run.** Free. Expect `20 todo`, `next: AC-F01-01`, `start: ready`. If it says
`not ready`, go back to step 4.

```bash
node loop/ralph.mjs --stage tests --dry-run
```

**Step 7 — run a batch.** `--flow` picks the slice, `MAX_ITER` caps the iterations. Do not run all 20
at once.

```bash
MAX_ITER=2 node loop/ralph.mjs --stage tests --flow F-01
```

**Step 8 — commit, then repeat step 7.** The runner writes the tracker after every verdict and never
commits it, so the tree is dirty again after each batch and the next one will refuse.

```bash
git add -A && git commit -m "chore(loop): record progress"
```

Flows are `F-01` (4 criteria), `F-02` (10), `F-03` (6).

---

## 5. Add a new acceptance criterion to an existing flow

**Use this when you want more tests to be generated based on new ACs, and the ones you have should stay.**

New criteria arrive — a case nobody thought of, an endpoint left out, a bug that should not come back.
The loop writes scenarios for those and touches nothing else: no existing test is regenerated, the
framework is unchanged. Each new scenario goes into the same feature file, and the judge grades it as
it graded the rest.

Say two more criteria about owners: `AC-F01-05` and `AC-F01-06`. **No code changes.** Four data edits,
then run the loop on that flow.

**Step 1 — describe the criteria** in `docs/specs/petclinic/flows/F-01-owner-lifecycle.md`, in the
same shape as the others: a `**Given**`, then numbered steps with `**When**` and `**Then**`.

**Step 2 — add them to that document's "Test plan" table.** This matters more than it looks: the gate
compares the generated scenario's title against this table, so the title lives here first.

**Step 3 — add the rows to `loop/trackers/tests.md`**, directly after the flow's existing rows. The
title must match the Test plan entry:

```
| AC-F01-05 | F-01 | <title, exactly as in the Test plan> | todo |
```

**Step 4 — update the `**Total:**` line** in the tracker. The runner cross-checks it against the row
count and refuses to start if they disagree.

**Step 5 — check the data before spending anything.**

```bash
npm test
```

This now catches a mismatch between the tracker and the flow document — a criterion with no row, a row
with no criterion, an id whose flow disagrees with its group, a title that diverges. All of them are
silent at runtime: the runner would report a finished stage either way.

**Step 6 — commit.** The tracker is a committed file, so the loop refuses to start until this is done.

```bash
git add -A && git commit -m "spec(F-01): two more acceptance criteria"
```

**Step 7 — run.** The existing rows are already `done`, so the loop skips them and picks up the new
ones.

```bash
MAX_ITER=2 node loop/ralph.mjs --stage tests --flow F-01
```

Commit between batches as in section 4, step 8.

The new scenarios go into the **same** feature file and reuse the existing step definitions — 58 of
them at last count, 51 already used by more than one scenario. Expect most new criteria to need one or
two new `Then` steps at most.

---

## 6. Add a whole new flow

**Use this when the new criteria are not about anything the three existing flows cover.**

A flow is a group of related criteria sharing one feature file and one data file. Today: owners
(`F-01`), owners and pets (`F-02`), pets and visits (`F-03`). Criteria about veterinarians fit none of
them, and filing them under `pet-visit-flow` gives the next reader a wrong name to un-learn.

So: section 5, plus three steps first — tell the loop the flow exists, give it a document to read the
criteria from, and a file to write the scenarios into.

The example below is `F-04`.

**Step 1 — one line in `scripts/flows.mjs`:**

```javascript
'F-04': 'F04-something',
```

That is the only place the flow list lives. Every path is derived from it — the flow document, the
feature file, the JSON data file. Nothing else needs registering.

**Step 2 — create the flow document** at `docs/specs/petclinic/flows/F-04-something.md`, with the
criteria and a "Test plan" table, in the shape of the existing three.

**Step 3 — create an empty feature file** at
`framework/src/PetClinic.ApiTests/Features/F04-something.feature`:

```gherkin
Feature: <name>

  <one paragraph on what this flow verifies>
```

The gate reads this file, so it must exist before the first turn. If you want a future full rebuild
(section 3) to recreate it, also add it to `scripts/manifest.scaffold.mjs` and give it a row in
`loop/trackers/scaffold.md` — otherwise a full reset deletes `framework/` and will not put it back.

**Steps 4 to 7** — tracker rows, `**Total:**`, `npm test`, commit, exactly as in section 5. Then:

```bash
MAX_ITER=2 node loop/ralph.mjs --stage tests --flow F-04
```

---

## 7. The two reset commands

`--yes` decides *show or do*. `--stage` decides *how much*. Without `--yes` both only print a list.

| | `npm run reset` | `npm run reset -- --stage tests` |
|---|---|---|
| stage-0 tracker | resets | leaves alone |
| stage-1 tracker | resets | resets |
| journal, `STEPS.md`, verdicts | deletes | deletes |
| **`framework/`** | **deletes** | **keeps** |

---

## 8. Troubleshooting

**`SUT ... did not become ready within 90000 ms`**
The application is not running. Section 1 — usually Docker Desktop itself is not started.

**`working tree is dirty — commit, stash, or pass --allow-dirty`**
A commit was skipped. Section 4, step 4 or step 8.

**`the repository was red before the turn`**
The gate was already failing before the agent was called, so the run stopped without spending
anything. Check which gate step failed — usually `sut reset`, meaning Docker.

**`the turn left work uncommitted in framework`**
The turn changed something and did not commit it. The runner already marked the row `rework` and
recorded the reason; the next iteration passes that note to the agent.

**`no progress for 3 iterations`**
A stop, not a crash: three iterations added nothing to `done`. Read `loop/verdicts/<id>.md` for the
judge's last verdict and its reasons.

**`git add` fails with `Permission denied` on a `.vs` file**
Visual Studio's per-user state landed inside `framework/`. Already ignored; if a new IDE artifact
appears, the loop reports it as uncommitted work — add it to `.gitignore`, the message names the file.

**`npm test` fails after editing a flow document or a tracker**
Read the failure: the tracker and the flow documents disagree about which criteria exist, an id names
a flow other than its row's group, or a title diverges from the Test plan table. That is section 5
step 5 doing its job — fix the data before running the loop.

---

## Why the tests do not start the application themselves

Design decision **D-10**: the framework never restarts anything; restarting lives in the harness.

The delivered framework has to run against a shared environment — staging, CI, a database someone else
is using. A suite that restarts the application on startup would wipe a colleague's work. So the tests
assume it is already running and only check it at startup. That is also why `sut reset` is a step of
the loop's gate rather than test setup.
