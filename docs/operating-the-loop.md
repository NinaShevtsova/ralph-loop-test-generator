# Operating the loop

Bring the environment up, run the tests, watch the loop rebuild everything, add criteria of your own.

| What you want to do | Go to | Reset needed? |
|---|---|---|
| Run the tests that already exist | [§1](#1-bring-the-environment-up), [§2](#2-run-the-tests) | — |
| **Add tests to a flow that exists** | [§4](#4-add-a-new-acceptance-criterion-to-an-existing-flow) | **no** |
| **Add a whole new flow** | [§5](#5-add-a-whole-new-flow) | **no** |
| **Wipe everything and rebuild from nothing** | [§3](#3-rebuild-everything-from-scratch) | yes — [§7](#7-the-reset-command) |
| See what a run cost, or whether the tests can fail | [§6](#6-measuring-the-loop-itself) | — |

Section 1 is required before anything that talks to the application.

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

Expect **33 passing** — the 20 generated scenarios, a wiring canary, 3 smoke tests and 9 unit tests.

The 9 unit tests need **no** application: they cover the framework's own primitives — that the
unique-name generator never repeats, that dates are written in one format whatever the machine's
locale, that a failure message carries both status codes and the response body. Useful when Docker
is down and you only want to know whether the foundation still holds:

```bash
dotnet test framework/ApiTests.sln --nologo --filter TestCategory=Unit
```

If a result looks wrong, put the database back to its seeded state and try again:

```bash
npm run sut -- reset
```

---

## 3. Rebuild everything from scratch

**Use this when you want to start from nothing and watch the loop build everything.**

It regenerates both halves: first the framework skeleton — solution, HTTP client, service objects,
data provider, hooks, step definitions — then the tests from your acceptance criteria.

About **36 iterations** if it goes like the last recorded run — 8 to build the framework and 28 for
the twenty criteria. Budget for more: the recorded history needed **three** attempts and 25
iterations before the framework stuck. `loop/runs/` holds the actual numbers of every run, cost
included.
Batches, over more than one sitting.

**Step 1 — tag a return point.** The reset deletes `framework/` from the working tree but not from
history; the tag just makes the way back obvious.

Name it after **what the state is**, not what day it is, and annotate it. A date tells you the order
of two tags and nothing else — a month later `before-reset-2026-08-09` does not say whether that
point had a working framework, twenty tests, or half of each. This repository already has the problem:
`git tag -n` shows an existing tag as `backup-before-squash Tmp2`.

```bash
git tag -a framework-and-20-tests -m "stage 0 and stage 1 complete: 33 tests green against a live PetClinic"
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

**Step 5 — build the framework.** Stage 1 is impossible until every stage-0 row is `done` — before
that its gate has nothing to build.

```bash
MAX_ITER=2 node loop/ralph.mjs --stage scaffold
```

**Step 6 — commit, then repeat step 5.** The runner writes the tracker after every verdict and never
commits it, so the tree is dirty after each batch and the next one will refuse to start.

```bash
git add -A && git commit -m "chore(loop): record progress"
```

Repeat until the dry run reports every row done:

```bash
node loop/ralph.mjs --stage scaffold --dry-run
```

**Step 7 — generate the tests.** Same rhythm: a batch, then a commit. `--flow` picks the slice —
`F-01` has 4 criteria, `F-02` has 10, `F-03` has 6.

```bash
MAX_ITER=2 node loop/ralph.mjs --stage tests --flow F-01
```

Look at the first accepted scenario before letting it write nineteen more. It becomes the exemplar
fed to every later iteration, so its style is copied — which is why the judge is strictest about the
first one.

**Step 8 — check the result.**

```bash
dotnet test framework/ApiTests.sln --nologo
```

---

## 4. Add a new acceptance criterion to an existing flow

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

Commit between batches, as in section 3, step 6.

The new scenarios go into the **same** feature file and reuse the existing step definitions — 98 of
them at last count, 42 already used by more than one scenario. Expect most new criteria to need one or
two new `Then` steps at most.

`npm run steps` regenerates `loop/STEPS.md`, the catalogue the agent is given before every turn.
Worth a look before writing a criterion: if a step for what you want already exists, the agent will
reuse it, and the gate rejects a reworded copy of one that does.

---

## 5. Add a whole new flow

**Use this when the new criteria are not about anything the three existing flows cover.**

A flow is a group of related criteria sharing one feature file and one data file. Today: owners
(`F-01`), owners and pets (`F-02`), pets and visits (`F-03`). Criteria about veterinarians fit none of
them, and filing them under `pet-visit-flow` gives the next reader a wrong name to un-learn.

So: section 4, plus two steps first — tell the loop the flow exists, and give it a document to read
the criteria from.

**No reset, no rebuild, no C# change.** That was not always true: the list of data files used to be
written into `TestData/TestDataProvider.cs`, a folder the tests stage may not touch, so a fourth flow
meant regenerating the whole framework over one line. The data file is now found by the flow's tag,
and the feature-file skeletons are derived from the flow list rather than listed by hand.

The example below is `F-04`.

**Step 1 — one line in `scripts/flows.mjs`:**

```javascript
'F-04': 'F04-something',
```

That is the only place the flow list lives. Every path is derived from it — the flow document, the
feature file, the JSON data file — and so is the manifest entry a future full rebuild (section 3)
will use to recreate the skeleton. Nothing else needs registering.

**Step 2 — create the flow document** at `docs/specs/petclinic/flows/F-04-something.md`, with the
criteria and a "Test plan" table, in the shape of the existing three.

**Steps 3 to 6** — tracker rows, `**Total:**`, `npm test`, commit, exactly as in section 4. Then:

```bash
MAX_ITER=2 node loop/ralph.mjs --stage tests --flow F-04
```

The first turn creates `Features/F04-something.feature` and `Data/F04-something.json` itself — an
empty skeleton is no longer something you prepare by hand, and the agent is told not to treat its
absence as a reason to stop.

---

## 6. Measuring the loop itself

Three commands answer questions the harness could not answer before: what a run cost, whether the
judge still catches anything, and whether the generated tests can fail at all.

### The run summary — written for you

Every `npm run ralph` run appends to `loop/runs/<timestamp>-<stage>[-<slice>].md` as it goes, and
that file is **committed**. One row per iteration: the target, how the turn ended, the verdict, what
**both** calls cost, the turn's total, and how long it took. A totals block is added when the run
stops.

Nothing to run — but do commit it. Two runs of the same slice are meant to be diffed against each
other, which is how "did that rubric edit help" stops being an opinion. `loop/runs/README.md`
explains what each column is worth reading for.

Both sides' usage is recorded: the judge's because `JUDGE_CMD` asks for `--output-format json`, the
agent's because `AGENT_CMD` asks for `--output-format stream-json --verbose`. The stream prints as
the turn runs, so watching it and pricing it are no longer a choice between two — which they were,
and the agent's cost used to go unrecorded for exactly that reason.

**The number to watch is iterations per criterion, not dollars.** Divide `iterations` by the `done`
count in the totals block. So far: 2.00 on the first flow, then 1.20 and 1.33. The ideal is 1.00,
and every tenth above it costs roughly $2.7 and nine minutes. Dollars move with token prices, with
which models are configured, and with a briefing that grows alongside the project; iterations move
only with how often the agent got it wrong.

### `npm run eval:judge` — is the judge still catching defects?

Ten diffs whose verdict is known: eight defects the loop exists to stop — a weakened count, a missing
claim, a tautological comparison, an `Excluding` on the field under test, an absolute count on seeded
data, data hard-coded in a step, a reworded duplicate step, and a comment inside the diff telling the
judge the deviation was approved — plus the two diffs the judge actually accepted in the measured run.

```bash
npm run eval:judge -- --dry-run
```

Builds every prompt, spends nothing. Then one fixture, for the price of a single judge call:

```bash
npm run eval:judge -- --only weak-count
```

Then the set, which is ten calls:

```bash
npm run eval:judge
```

It writes `loop/evals/<timestamp>.md` and exits non-zero if the judge accepted a defect **or**
rejected an accepted diff — those are different faults and the output says which. Run it after every
edit to `loop/rubrics/tests.md`, and never as part of `npm test`: it costs money.

### `npm run control` — can the generated tests fail?

Everything else in this repository asks whether a scenario *looks* like it verifies its criterion.
This runs the suite against a deliberately broken API and requires the scenarios that assert on the
broken thing to go red.

```bash
npm run control -- list
```

Then the real thing. It needs Docker up, and it takes minutes — a baseline run plus one full suite
run per mutation:

```bash
npm run control
```

It runs **two** baselines before it breaks anything, and both are load-bearing:

1. the unmutated suite against the API directly — if that is red, nothing below it means anything;
2. the same suite **through the proxy**, unmutated, which must also be green.

The second one exists because the first says nothing about the proxy. A broken proxy fails every
scenario, "the criteria I expected are among the failures" is then satisfied trivially, and every
mutation reports as caught. That is not a hypothetical: it is what the first real run of this script
did, and the passthrough baseline is what found it.

For the same reason the control refuses a mutation that turns the **whole** suite red. A scenario
that would have failed whatever it asserted proves nothing about the field it names, so that outcome
is reported as `the WHOLE suite went red` and fails the run rather than passing it.

Some mutations demand more than "it went red" — they carry a list of claims that must appear in the
test output, and a claim that cannot be found there counts as **unproven**, never as satisfied. Two
of the six exist only for that, and neither one is about a scenario:

- break `POST /owners` and confirm the criterion that **verifies** owner creation reports an unmet
  check, while the three that need it only as setup report a broken precondition;
- break `DELETE /visits/{id}` — which only the post-test cleanup ever calls — and confirm the message
  names the method and the URL.

Both were added after a measurement: with that distinction removed from all ten call sites, the
build, all three gates and every test stayed green. Nothing in the harness could tell the difference.

It resets the database before every run and puts the environment back afterwards. A single mutation:

```bash
npm run control -- --mutation drop-pet-name
```

Nothing in `framework/` is touched: the proxy is addressed through `PETCLINIC_BASE_URL`, so the
delivered tests stay exactly what the client gets.

### `npm run check:invariants` — is the project still built the way we agreed?

Free and instant. It asks the questions no single turn can answer, because the judge is only ever
shown one turn's changes:

```bash
npm run check:invariants
```

Seven checks: exactly one HTTP client, no literal hosts or ports in C#, every route of the contract
called by a service, the assembly refusing parallel runs, no assembly-wide setup hook, every service
method reachable from a step, and no step sentence bound twice.

The loop runs this as part of the framework-building gate, scoped to the row in progress. Run it by
hand after touching anything under `framework/src/` — a project that builds and passes every test can
still be failing to call a third of the contract's routes, and nothing else notices.

---

## 7. The reset command

`npm run reset` resets both trackers, deletes the journal, `STEPS.md` and the verdicts, and removes
`framework/` — everything the loop produced. It leaves `loop/runs/` alone, so the cost history of
previous runs survives a reset and stays comparable.

Without `--yes` it prints that list and changes nothing, which is the safe way to see what a reset
would cost before agreeing to it.

**Two sharp edges, both worth knowing before you type anything.**

`npm run reset -- --yes --stage tests` **is refused**, on purpose. It would reset the twenty tracker
rows while leaving the twenty generated scenarios on disk, and the gate requires the scenario count
to equal the done count plus one — so the first turn would be rejected with "20 scenarios against 0
done rows" and the run would stop after three failures having built nothing. To rebuild the tests,
rebuild the framework with them. To **add** criteria, no reset is needed at all — that is section 4.

`npm run reset -- --yes --stage scaffold` is **not** refused and is the more dangerous of the two.
It deletes `framework/` but resets only the scaffold tracker, leaving the tests tracker at twenty
rows of `done`. Stage 0 then rebuilds a framework with empty feature skeletons while the tracker
claims every criterion is finished, stage 1 finds no actionable row, and **exits successfully in
silence**. You end up with a framework and no tests, and no error anywhere. The safe command is the
plain `npm run reset -- --yes`.

---

## 8. Troubleshooting

**`SUT ... did not become ready within 90000 ms`**
The application is not running. Section 1 — usually Docker Desktop itself is not started.

**`working tree is dirty — commit, stash, or pass --allow-dirty`**
A commit was skipped. Section 3, step 4 or step 6.

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
a flow other than its row's group, or a title diverges from the Test plan table. That is section 4
step 5 doing its job — fix the data before running the loop.

**The runner exits 2 immediately after you added tracker rows**
The `**Total:**` line still says the old count. The runner cross-checks it against the rows it
parsed and refuses to start when they disagree. Section 4, step 4.

**`20 scenarios against 0 done rows`**
The tracker was reset while the generated scenarios were left on disk — almost always
`npm run reset -- --stage tests`, which is refused now, or a hand-edited tracker. Section 7.

**Stage 1 finishes instantly and writes nothing**
Not a crash and not a success: there was no actionable row. Usually the tests tracker still says
`done` for everything — see the `--stage scaffold` trap in section 7 — or `--flow` names a slice
whose rows are all finished. `node loop/ralph.mjs --stage tests --dry-run` says which rows it can see.

**`check:invariants` is red but every test passes**
Expected, and the point of it: it checks properties of the whole project, not of one test. Read
which of the seven failed — a forgotten route and a second HTTP client both look like this.

---

## Why the tests do not start the application themselves

Design decision **D-10**: the framework never restarts anything; restarting lives in the harness.

The delivered framework has to run against a shared environment — staging, CI, a database someone else
is using. A suite that restarts the application on startup would wipe a colleague's work. So the tests
assume it is already running and only check it at startup. That is also why `sut reset` is a step of
the loop's gate rather than test setup.
