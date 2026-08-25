<!--
  Design document: redesigning stage 0's acceptance model.

  Read top to bottom. Sections 2-4 are the diagnosis and the target architecture — why anything
  should change at all. Section 5 fixes what is being built NOW and what stays conditional.
  Sections 7-10 are the design of that first step; the implementation plan is written from them.

  This document is alive: when the experiment in §12 comes back positive, phases 3-6 are written
  up HERE rather than in a second file.
-->

# Stage 0 — redesigning the acceptance model

**Date:** 2026-08-20
**Branch:** `feat/loop-harness-improvement`
**Status:** phases 1–2 are for implementation. Phases 3–6 are conditional on the experiment in §12.
**Scope:** stage 0 only. Nothing in this document changes stage 1.

---

## 1. Why this document exists

Stage 0 builds the test framework scaffold — 39 files that decide the quality of all 20 tests
stage 1 will write. Today it accepts that scaffold through **fourteen separate acceptances**, calling
an independent LLM judge on each one.

This document answers three questions:

1. Why the per-row acceptance boundary is the wrong one for stage 0 (§2).
2. Which boundary is right (§3).
3. What the smallest testable step is that confirms or refutes that, while deleting nothing (§5–§12).

The claim the experiment puts to the test:

> Of the nine "semantic" checks in the stage-0 rubric, six are mechanisable — they become text scans
> and tests that run in seconds on every wave, instead of costing roughly $0.5 per Opus call.

---

## 2. Diagnosis

### 2.1 How it works today

```
for each of the 14 tracker rows (S1…S14):
  ├─ pre-gate:   check-scaffold --through-wave N-1
  │              dotnet build
  │              sut reset
  │              dotnet test
  ├─ agent with an EMPTY context: re-reads design §4 (696 lines),
  │              the conventions (245), the row's DoD, and may read openapi.yaml (53 KB)
  ├─ post-gate:  check-scaffold --through-row Sn
  │              dotnet build + sut reset + dotnet test
  ├─ judge (Opus): rubric + a one-line "see the DoD in the tracker" + the diff of one row
  └─ the runner writes `done`
```

Measured on the developer machine on 2026-08-20 (full data in appendix A):

| Step | Time |
|---|---:|
| `dotnet build` | ~10 s |
| `sut reset` (Docker restart + readiness poll) | ~27 s |
| `dotnet test`, 23 tests | ~17 s |
| **one whole gate** | **~50 s** |

| Cost source, per stage | Volume |
|---|---|
| Gate runs | ~27 (13 pre + 14 post) → **~22 minutes** |
| Docker restarts | ~27 |
| `dotnet test` runs **with zero tests** | ~25 |
| Judge calls | 14 |
| Times the specification is re-read | 14× |

The zero-test runs are not a guess. Tests only appear in row S14, and the stage-0 prompt says so
itself:

> Before wave 8 exists there are no smoke tests yet, so `dotnet test` reporting zero tests is a
> pass, not a failure.

### 2.2 In six of fourteen calls the judge has nothing to check

`loop/rubrics/scaffold.md` holds 9 checks. Mapped onto the rows that own the relevant files:

| Rubric check | Rows it concerns |
|---|---|
| 1. One HTTP client for everything | S4 **and** S5 |
| 2. No hard-coded environment | S2 (+ everywhere) |
| 3. Data keyed by the scenario tag | S10 |
| 4. `Drain()` swallows only 404 | S7 |
| 5. `UniqueData` constraints | S6 |
| 6. All 22 routes present | S5 |
| 7. FluentAssertions pinned exactly | S1 |
| 8. Smoke tests assert on values | S14 |
| 9. `EnsureStatus` shows the response body | S4 |

**Rows no check applies to:** S3 (models), S8 (ReadinessProbe), S9 (ScenarioState), S11 (hooks and
DI), **S12 (all 22 request steps)**, S13 (feature skeletons) — **6 of 14**.

S12 is the largest row of the stage: 22 steps across four files, `OwnerSteps.cs` alone is 709 lines.

**Worse, four checks cannot be answered from one row's diff at all.** Checks 1, 2, 6 and 9 ask about
properties of the whole scaffold. When S4 is judged the services do not exist yet; when S5 is judged
`ApiClient` is not in the diff. At that moment the judge either answers from a partial view or reads
files outside the diff — which its own list of inputs ("this rubric; §4 of the design; the full
diff") does not provide for.

Small but telling: the rubric opens with "You are an independent evaluator of **one wave** of
framework scaffolding", while the runner has long since been grading one **row**. The text the work
is judged against describes something other than what happens.

### 2.3 The Reqnroll pipeline is never executed in stage 0

This is the most serious finding, and the code itself confirms it.
`Tests/Smoke/FrameworkSmokeTests.cs`:

> Plain NUnit, no Reqnroll/Gherkin involved

The smoke suite constructs the services and `ResourceTracker` by hand in `[SetUp]` and drains in
`[TearDown]`. So after the **whole** of stage 0, none of the following has ever run:

- `ScenarioHooks.BeforeScenario` and the registration of five instances in `IObjectContainer`;
- resolution of `ScenarioState` and `ResourceTracker` **through the container**;
- `TestDataProvider.ResolveFeatureFile()` and `ResolveAcTag()` — the "scenario tag → JSON block" path;
- **all 22 request steps** (S12);
- `AfterScenario` → `Drain()` through the container.

`TestDataProvider` carries a seam built specifically for the smoke suite, and its comment says it
plainly:

> Seam for FrameworkSmokeTests: … a plain NUnit test carries no FeatureContext/ScenarioContext to
> derive fileName/key from — so the smoke test passes them in directly

So the smoke suite proves the file read and the JSON parse, but **deliberately bypasses** the two
methods that are the only link between a scenario tag and its data. The seam exists precisely because
the smoke test cannot reach them.

**Consequence.** The first real execution of all this machinery happens inside stage 1's first paid
iteration — the most expensive possible place — and that iteration is the one that becomes the
exemplar the other 19 copy.

### 2.4 Most of the rubric is mechanisable

Verified against the real files.

The routes in the specification are an ordinary markdown table in §7, with tokens like:

```
| `Pet` | **only** `POST /owners/{ownerId}/pets` | `GET /pets`, `GET /pets/{petId}`, … |
```

The routes in the code are literal templates, with the verb encoded in the method name:

```csharp
public Task<ApiResponse<Pet>> AddPet(int ownerId, Pet pet) =>
    _client.Post<Pet>("owners/{ownerId}/pets", pet, b => b.WithPathParam("ownerId", ownerId));
```

Both sides are machine-readable. So rubric check 6 — "all 22 routes present, pay particular attention
to the asymmetric ones" — is a script, not a model call. The full mapping "rubric check → what
replaces it" is appendix B.

### 2.5 Local, global and cross-cutting properties

The architecture should follow the boundary of what can actually be validated, not the shape of the
tracker:

| Property | Kind | Answerable from one diff? | Who should check it |
|---|---|---|---|
| 39 files present and non-trivial | local | yes | **code** — exists (manifest, 91 probes) |
| FluentAssertions pinned | local | yes | **code** — exists in the manifest (the rubric duplicates it) |
| Compiles, warnings-as-errors | global | no | **code** — exists |
| One `RestClient` in the whole project | global | **no** | **code** — missing, added as I1 |
| No hard-coded base URL | global | **no** | **code** — missing, added as I2 |
| All 22 routes | global | **no** | **code** — missing, added as I3 |
| `NonParallelizable` | local | yes | **code** — missing, added as I4 |
| Every route reachable from a step | cross-cutting | no | **code** — missing, added as I5 |
| No sentence bound twice | local | yes | **code** — missing, added as I6 |
| No assembly-wide setup hook | global | **no** | **code** — missing, added as I7 |
| Smoke asserts on values | local | yes | **the judge** — a text scan for it goes red on accepted work, see §8.1 |
| `UniqueData` constraints | local | yes | **unit test** — missing, added |
| `EnsureStatus` puts the body in its message | local | yes | **unit test** — missing, added |
| `Drain()`: order, 404 only, second call safe | cross-cutting | no | **already executed** by smoke test 2 |
| Data by tag, hooks, DI, `ScenarioState`, 22 steps | cross-cutting | no | **executed by nothing** → the canary |
| Coherence of abstractions, duplicated responsibility | global, semantic | no | **the judge, and only the judge** |

---

## 3. Target architecture

Three principles, each a direct consequence of §2:

1. **On stage 0 the loop is driven by the compiler, not by the judge.** The signal a loop exists for
   here is compilation and checks: free, deterministic, seconds. The judge is the most expensive
   participant, and in six of fourteen calls it has nothing to say.
2. **There are two units, and today they are fused into one.** Building proceeds in **waves** (a wave
   is a layer that compiles). Acceptance concerns **invariants and the scaffold as a whole**. A
   tracker row is neither.
3. **The stage-0 judge should grade state, not a diff.** Stage 1 is "one change = one AC", where the
   diff is the right object. Stage 0 is greenfield: there is no meaningful "change", only state.

```
                        INPUT (protected from the agent by the deny-list)
        docs/design §4 · conventions §7/§10/§11 · openapi.yaml · MANIFEST
                                    │
     ┌──────────────────────────────┴──────────────────────────────┐
     │                  PHASE 1 — BUILD, WAVE BY WAVE              │
     │            (8 agent sessions, context FRESH each time)      │
     │                                                             │
     │   wave N ──► agent builds the layer ──► DETERMINISTIC GATE   │
     │      ▲                                    │                 │
     │      │                     ┌──────────────┴──────────────┐  │
     │      │                     │ 1. manifest --through-wave N│  │
     │      │                     │ 2. dotnet build (warn=err)  │  │
     │      │                     │ 3. check-invariants         │  │
     │      │                     │ 4. unit tests (no Docker)   │  │
     │      │                     └──────────────┬──────────────┘  │
     │      │  red: the same wave again          │ green           │
     │      └────────────────────────────────────┤ commit, wave++  │
     │           (max 2 attempts, NO judge)      │                 │
     └───────────────────────────────────────────┼─────────────────┘
                                                 ▼
     ┌───────────────────────────────────────────────────────────────┐
     │            PHASE 2 — EXECUTABLE ACCEPTANCE (once)             │
     │   sut reset  ──►  3 smoke tests  ──►  THE CANARY              │
     │                                       one BDD scenario:       │
     │                                       hooks + DI +            │
     │                                       ScenarioState +         │
     │                                       data BY TAG +           │
     │                                       the real request steps  │
     └───────────────────────────────┬───────────────────────────────┘
                                     ▼
     ┌───────────────────────────────────────────────────────────────┐
     │      PHASE 3 — JUDGE ON STATE, NOT ON A DIFF (one call)       │
     │   input: the semantic rubric + the tree (read-only) + the      │
     │          report of every deterministic check                   │
     │   question: "does the FINISHED scaffold satisfy these          │
     │              architectural invariants?" — not "is row S6 good?"│
     └───────────────┬───────────────────────────────┬───────────────┘
                     │ PASS                          │ REJECT
                     ▼                               ▼
              PHASE 4 — a human               rework from the findings
              reads the diff once                    │
                     │                               ▼
                     ▼                   the same gates as phases 1+2
              stage 0 accepted                       │
                                                     ▼
                                          judge again (max 2 rounds)
                                                     │
                                          3rd REJECT ─► ESCALATE TO A HUMAN
```

**The unit of progress in the target model** is a wave closed by deterministic gates. Formally:

```
wave closed  ⟺  manifest through wave N green
                ∧ dotnet build green (warnings-as-errors)
                ∧ check-invariants green
                ∧ unit tests green
```

This is **stricter** than the property that holds today. Today the runner writes `done` on a model's
verdict; here `done` is a set of facts on disk, and the LLM leaves the progress metric entirely. The
judge stays, but as a final architectural review rather than as the gatekeeper of progress.

**Fresh context is preserved — 8 sessions, not one long one.** A single long session loses on two
counts, both serious:

- an early mistake propagates silently: having chosen a poor shape for `ApiResponse` in wave 3, the
  agent will write 22 steps against it in wave 7, because it remembers its own decision. A fresh
  context reads the **code**, and the code has been checked;
- recovery breaks: the system is built on everything necessary living on disk, whereas a long session
  holds its model of the world in the conversation, and a crash destroys it.

"Understand the architecture once" has a cheaper solution — **executable invariants**: if the
cross-cutting rules are checked by code after every wave, a fresh context cannot drift away from them.

### Why not a judge per wave

A wave is a unit of building, not of invariants. "One `RestClient` in the whole project" spans wave 3
(`ApiClient`) and wave 4 (the services). A judge at wave 3 cannot answer it; a judge at wave 4 would
be checking wave 3's property. Wave boundaries and invariant boundaries **do not coincide** — a judge
per wave is the same mistake as a judge per row, only coarser.

---

## 4. The lesson of the historical batching failure

Recorded in the comments of `loop/tracker.mjs` and `loop/PROMPT.scaffold.md`:

```
a turn delivered S6+S7+S8 in one commit
   → the judge was asked "is S6 good?"
   → it found real defects in S7's and S8's files
   → the rework touched only S7 and S8
   → S6's own work fell out of the diff permanently
   → row S6 could never be graded again
```

**Batching is not what broke.** The binding broke: the work was combined while acceptance stayed
per-row.

| Candidate cause | Guilty? |
|---|---|
| Batching itself | no |
| Mixing batched generation with row-level acceptance | **yes — first root cause** |
| The judge grading a diff rather than system state | **yes — second root cause** |
| No stable diff baseline | contributed; fixed later (`loop/verdicts/<id>.base`) |
| Wrong unit of attribution | yes, a consequence of the first root cause |
| Tracker and commit semantics | consequences |

**How the target model makes this class of failure structurally impossible** (without adding another
guard):

- the unit of acceptance is the **whole scaffold**, not a row: there is nothing to lose when nothing
  is bound;
- the judge grades the **state of the tree**: the question "is there a second `new RestClient`
  anywhere" cannot "fall out of the diff", because there is no diff.

---

## 5. What this document commits to

Implemented **now** — phases 1–2, the experiment:

| # | Deliverable | Section |
|---|---|---|
| 0 | A green baseline: fix `tests/check-spec.test.mjs:719` (CRLF) and add `.gitattributes` | §6, D-31 |
| 1 | Stage-0 gate optimisation | §7 |
| 2 | `scripts/check-invariants.mjs` + its negative control | §8 |
| 3 | Unit tests for the primitives | §9 |
| 4 | The canary scenario | §10 |
| 5 | A new flow costs no change to the framework | §15 |
| 6 | The agent's cost is recorded, not only the judge's | §16 |

Deliverable 0 goes first and needs no separate argument: without a green `npm test` there is nothing
to measure §12 against — a red test cannot be attributed to the experiment or to what preceded it.

**NOT in scope** — these stay exactly as they are:

- the per-row loop of stage 0;
- `loop/trackers/scaffold.md`;
- `loop/PROMPT.scaffold.md`;
- `loop/rubrics/scaffold.md` and the judge call after every row;
- the dual scope `--through-row` / `--through-wave`;
- all of stage 1.

No existing mechanism is removed. Checks are added and provably empty work is taken out. Phases 3–6
are §14, and they happen only if the criteria in §12 are met.

---

## 6. Decisions

The numbering continues the decisions register of the main design document, which ends at D-19.

| # | Decision | Rationale |
|---|---|---|
| D-20 | Stage-0 gates do not run `sut reset` or `dotnet test` while the suite holds no tests | ~25 of ~27 runs test nothing; the stage-0 prompt says so itself |
| D-21 | "Tests now exist" is derived from the **manifest**, not from a wave number | A wave number would be a magic constant in two places; the manifest already knows which row owns the smoke-suite file |
| D-22 | `loop/gates.mjs` stays pure data, with no filesystem access | Its stated property: "declaring the steps rather than hard-coding a chain means the ORDER is unit-tested" |
| D-23 | The pre-gate is skipped only when HEAD equals the last green gate **and** `framework/` is clean; any doubt runs the gate. The SHA lives **in memory**, not in a file | Fail-closed, like every other check here. A gate skipped when it was needed is not an acceptable outcome. A file would only buy a skip on a resumed run, and would cost four failure branches — see §7.2 |
| D-24 | Pre-gate skipping is introduced for **stage 0 only** | On stage 1 the pre-gate also resets the database, and D-09 requires a clean start before a run. That is a separate decision with its own rationale |
| D-25 | The invariants are a standalone CLI in the style of the existing checks (the `Verdict` class from `scripts/lib.mjs`) | One output format and one exit-code convention; `runGate` grades on the exit code alone |
| D-26 | Every invariant has a negative control: a test that requires the check to **go red** on an injected violation | The direct lesson of `scripts/mutation-control.mjs`: a check that has never gone red proves nothing |
| D-27 | Unit tests are marked `[Category("Unit")]` and run through a filter, without Docker | Lets them sit in the cheap gates before wave 8 |
| D-28 | The canary scenario lives **outside** `Features/` and outside the stage-1 fence | `check-tests.mjs` counts scenarios only under `Features/`; `Tests/` is not in `STAGE1_ALLOWED`, so stage 1 cannot modify it |
| D-29 | The canary adds no new step definitions | Rules out `Ambiguous step definitions` and keeps `loop/STEPS.md` clean |
| D-30 | The invariants are first run against the **current accepted scaffold**, which is the reference | A check that goes red on accepted work is too strict and is to be loosened, not shipped. **One recorded exception, D-40:** where the measurement says the scaffold itself is wrong, the red is the finding |
| D-32 | The S13 feature skeletons are **derived** from the flow list rather than written out | A flow added later would otherwise have no skeleton until somebody remembered a list in the manifest — and the omission surfaces as a rejected stage-1 turn, not as a missing entry |
| D-33 | `TestDataProvider` finds a flow's data file **by the flow tag**, not from a closed map | `TestData/` is outside the stage-1 fence, so a closed map makes a new flow impossible for stage 1 to add. Resolution by tag needs no framework change per flow |
| D-34 | The generated target section tells a tests turn it may **create** a missing feature file | A flow added after stage 0 ran has no skeleton; `Features/` is inside the fence and the file check runs after the turn, so creating it is legal — the agent just had no way to know. `loop/PROMPT.tests.md` is write-protected, so the sentence belongs in the section the runner generates |
| D-31 | The repository gains a `.gitattributes`, and multi-line fixtures in tests normalise line endings | `tests/check-spec.test.mjs:719` is red on any checkout with `core.autocrlf=true`. `loop/judge-eval.mjs` already learned this and normalises CRLF explicitly; the same treatment is needed at the second site |

---

## 7. Deliverable 1 — stage-0 gate optimisation

### 7.1 Do not run the runtime steps while there are no tests

**Where:** `loop/gates.mjs` — `gateSteps('scaffold', …)` and `preGateSteps('scaffold', …)`.

**What:** the `sut reset` and `dotnet test` steps enter the pipeline only from the row that owns the
smoke-suite file onward. Before it, a stage-0 gate is `check-scaffold` + `dotnet build` +
`check-invariants`. **No test run of any kind** — see below.

**How the boundary is determined (D-21, D-22):** `scripts/manifest.scaffold.mjs` gains an export that
answers "which row owns `Tests/Smoke/FrameworkSmokeTests.cs`" and "what is a row's ordinal".
`gates.mjs` compares the target row's ordinal against that boundary. No filesystem access is added —
manifest data is compared.

**No filtered unit run, and that is a measured correction.** The first version of this section put
`dotnet test --filter TestCategory=Unit` in the cheap gate, on the assumption that unit tests need no
SUT. They do, through no fault of their own: Reqnroll generates an assembly-level `[SetUpFixture]`
whose `[OneTimeSetUp]` calls `TestRunnerManager.OnTestRunStartAsync`, which fires `ScenarioHooks`'s
`[BeforeTestRun]` → `ReadinessProbe.WaitUntilReady()` on a 90 s budget — for **any** test run in the
assembly, filter or no filter. Measured with the container stopped: **97 seconds and red**, for a step
meant to replace a ~50 s one. And no gate below S14 has a `sut reset` to bring the container up, so on
a from-scratch run that is three red gates and `K_FAILURES` ends it at S6.

§9 turns the fix into a requirement — readiness moves to `[BeforeScenario(Order = -1)]` behind a
`Lazy<Task>`, measured at **4 seconds** with the container still down. Once a regenerated framework
satisfies that, the step can come back; `UNIT_TEST_ENTRY` in the manifest is the boundary it will use.

**Tests:** `tests/gates.test.mjs` — the composition and the **order** of steps for a row before the
boundary, at it, and after it. Order is load-bearing: `sut reset` must precede `dotnet test` (D-09).
One test forbids `dotnet test` in any form below S14, so the measurement above cannot be undone by
accident.

### 7.2 Skip the pre-gate when HEAD has not moved

**Where:** `loop/ralph.mjs`, the `preGate(row)` function.

**What:** after a green post-gate the runner remembers the SHA **in memory** — `let lastGreenSha`,
not a file. The pre-gate is skipped when a pure predicate, `skipPreGate` in `loop/gates.mjs`, says
all three of these hold:

```
lastGreenSha is a non-empty string   (a fresh process has null, so it runs the gate)
  ∧ it equals the current rev-parse HEAD
  ∧ git status --porcelain --untracked-files=normal -- framework   is empty
```

Otherwise the gate runs (D-23). Both git probes go through `gitTry`, and a failure of either runs
the gate: `git()` returns `''` for a failed command as well as for an empty result, and `''` must
never be able to satisfy a skip.

**In memory rather than on disk, and that is a change from this document's first draft.** A file —
`loop/verdicts/.gate-green` was the candidate — would additionally skip the first pre-gate of a
*resumed* run, one gate per resume, at the cost of four failure branches: the file missing,
unreadable, stale after a rebase, and removed by `git clean`. A fresh process starts at `null` and
simply runs the gate, which is the conservative answer and needs no branches at all.

**A skipped pre-gate prints one line.** `pre.log` was only ever printed on the red path, so every
skip message the runner built — including the two that predate this change — was constructed and
thrown away. Without the line a run's timing is unexplainable: an operator cannot tell a gate that
passed in eleven seconds from one that never ran, which is exactly the question this skip raises.

**Why this is sound.** The green post-gate of row S6 checked the manifest `--through-row S6`, that is
rows S1…S6. The next row's pre-gate asks `--through-wave 4`, that is S1…S5 — **a subset of what has
just been proven**, on the same HEAD and with `framework/` clean.

**Tests:** `tests/gates.test.mjs` — the predicate is pure, so all five boundaries are unit tests:
skip on a match; run on a moved HEAD; run on a dirty tree even when the SHA matches; run on a fresh
process (`null`); run on `''` or `undefined` on either side. `tests/ralph.test.mjs` exercises the
branch for real — two of its scaffold tests take a second iteration, so both `gitTry` probes and the
predicate execute inside a temporary clone.

**A bound worth recording about file order.** The skip block reads `WATCHED`, whose `const` is declared
**below** `preGate` in `loop/ralph.mjs`. That is safe only because `preGate` is first called long after
module evaluation; it becomes a TDZ `ReferenceError` the moment `preGate` gains a caller during
evaluation. Nothing enforces that today.

**A bound on "a subset of what has just been proven".** It holds while targets advance in manifest
order, which `pickTarget` guarantees by walking rows in file order. A tracker holding a `done` row
after a not-done one would break the reasoning — the skipped pre-gate would omit rows the post-gate
never covered — but the gates themselves refuse a later wave whose earlier waves lack files, so no
reachable path to that state was found.

### 7.3 Expected effect

| | Today | After §7.1 | After §7.1 + §7.2 |
|---|---:|---:|---:|
| Gate runs | ~27 | ~27 | **~15** |
| Gate wall clock | ~22 min | ~6 min | **~3.5 min** |
| Docker restarts | ~27 | 1 | **1** |
| Runs with zero tests | ~25 | **0** | **0** |

**One, unconditionally** — the earlier draft of this section said "1–2" and that branch no longer
exists. `gateSteps` and `preGateSteps` are different functions, and the scaffold branch of the second
contains no `sut reset` at **any** wave. Verified across all eight: every scaffold pre-gate is
`check:scaffold (through the previous wave)` plus `dotnet build`, nothing more. So the only restart in
a stage-0 run is the post-gate of S14, whether or not §7.2 skips anything.

Measured end to end with the container **stopped**: the cheap gate is **about 3.2 seconds** — 0.25 s
manifest, 0.5 s invariants, 2.5 s incremental build (about 8 s after a real edit forces a recompile).
The expensive S14 gate, container up, is **23 seconds**. Against ~50 s per gate and ~22 minutes per
stage before this work, the projection is **1.5–2 minutes**.

Two corrections to an earlier draft of this paragraph, both from re-measuring rather than re-reasoning.
It called the cheap gate 2.7 s while listing parts that sum to 3.25 s — 2.7 s was the build alone,
labelled as the whole. And the invariants moved 0.3 s → 0.5 s when I7 joined them: it walks the project
sources a third time, after I1 and I2, at a measured 70–90 ms. Left as three walks rather than memoised
— 90 ms against a 3.2-second gate does not earn a shared cache between three otherwise independent
rules.

---

## 8. Deliverable 2 — `scripts/check-invariants.mjs`

A new CLI in the style of `check-scaffold.mjs` / `check-tests.mjs`: the `Verdict` class, a `--quiet`
flag, exit code 0/1, and exit code 2 for a broken invocation.

### 8.1 The invariants

| # | Invariant | Method | Replaces |
|---|---|---|---|
| I1 | Exactly one `new RestClient(` across `framework/**/*.cs`, and it is in `Http/ApiClient.cs` | text scan | rubric check 1 |
| I2 | No literal `http://localhost` or `:9966` in `.cs` | text scan | rubric check 2 |
| I3 | All 22 routes of §7 are covered | parse the §7 table → a set of `VERB /path` pairs; extract `_client.Get/Post/Put/Delete[<T>]("template")` calls from `Services/*.cs` → a second set; compare **in both directions** | rubric check 6 |
| I4 | `[assembly: NonParallelizable]` is present | text scan | S11's DoD — checked by nothing |
| I5 | Every public method of `Services/*.cs` — **constructors excluded** — is referenced at least once from `StepDefinitions/*.cs` | text scan | **a gap**: the route exists, no step uses it, and a later AC stalls |
| I6 | No sentence is bound twice under the same keyword | `extractSteps` from `scripts/steps-inventory.mjs` | **a gap**: S12 (~1600 lines) has no check at all |
| I7 | No `[BeforeTestRun]` and no hand-written `[SetUpFixture]` anywhere in the assembly | text scan over active lines | **a gap**: three comments state the rule in prose and nothing enforced it |

Implementation notes:

- **I3 compares both directions, not one.** A missing route stalls a later AC; an extra route means
  the code and the specification have diverged. Both are red, and the message names both differences.
- **I3 reads the specification rather than a hard-coded list.** The 22 routes are not written into the
  script: they are parsed from the §7 table of
  `docs/specs/petclinic/context-and-conventions.md`. Otherwise a fifth copy of the rule appears — and
  collapsing the copies into one is the whole point.
- **I6 has no count, and that was measured rather than assumed.** A count of step bindings against the
  §7 route set reported 97 against 22 on the accepted scaffold. D-13 means 22 *request* steps; the 52
  `Then` bindings are assertion steps, and stage 1 adds more of them — so the quantity is neither
  route-derived nor stable between stages. I3 and I5 together already prove that every route of the
  contract is reachable from a step, which is what the count was reaching for.
- **I7 exists because a probe can only require, never forbid.** The manifest entry for
  `Hooks/ScenarioHooks.cs` requires a `Lazy<Task>` and its comment used to claim "the negative half of
  this probe is the load-bearing half" — but `check-scaffold.mjs` asks only whether a marker is
  PRESENT. A file carrying both a `Lazy<Task>` and a `[BeforeTestRun]` satisfied every probe on it
  while restoring the 96-second regression whole. The rule needed a checker that can say *no*.
- **I7's positive control is a fixture, not the accepted scaffold — the one exception to D-30.** The
  accepted `Hooks/ScenarioHooks.cs` declares `[BeforeTestRun]` at line 19, so I7 is red on it by
  construction. That red is the finding rather than a fault in the rule: it names the same defect the
  gate design already acted on when it removed the filtered unit run. It stands with the six forward
  requirements `check:scaffold` reports, and it clears when phase B rewrites the file to its DoD.
- **`[OneTimeSetUp]` is deliberately not forbidden.** Inside a test fixture it is scoped to that
  fixture, and the smoke suite uses exactly that to await readiness for its own three tests. Including
  it would go red on accepted work for no gain — it is not what costs the 96 s.
- **Fail-closed.** An unreadable file, an empty file list, an unparsed §7 table — red gate with a
  named reason, never "let it pass". The `Verdict` class already refuses to call a run green when it
  performed no checks.

### 8.2 The negative control (D-26)

`tests/check-invariants.test.mjs`. For **every** invariant: a copy of the tree, one injected
violation, and the requirement that the script goes red and names the file. The minimum set of
violations:

| Invariant | Injected violation |
|---|---|
| I1 | a second `new RestClient(` in `PetsService.cs` |
| I2 | `"http://localhost:9966"` in `SettingsLoader.cs` |
| I3 | remove `Update` from `PetsService.cs` (a missing route), and as a separate case add an extra route |
| I4 | remove `[assembly: NonParallelizable]` |
| I5 | add a service method no step calls |
| I6 | duplicate a sentence under the same keyword |
| I7 | `[BeforeTestRun]`, and separately a hand-written `[SetUpFixture]`; plus the qualified, suffixed and argument-carrying spellings |

Plus the mandatory positive control: **I1–I6 are green on the current accepted scaffold** (D-30), each
named in `tests/check-invariants.test.mjs` rather than counted, so adding an invariant cannot quietly
retire one of them. The deliverable is not done without both halves — a set of violations alone is
passed equally well by a check that goes red every time.

**I7's positive control is a fixture** in `tests/invariants.test.mjs`: the hook shape S11's DoD asks
for, which must stay green. On the real tree the CLI test pins the pair that holds on both sides of
phase B — the rule ran, and if it found something it named the file. The exit code is deliberately not
asserted there: it is 1 before the first regeneration and 0 after, so pinning either value would make
the test fail on one side of the change it exists to survive.

---

### 8.3 The two decisions I7 rests on

| # | Decision | Why |
|---|---|---|
| D-39 | The prohibition on `[BeforeTestRun]` becomes I7, an invariant, rather than another sentence of prose | It was already prose in three places — the manifest entry, S11's DoD and the gate that stopped running a filtered unit suite because of it — and prose is what let the accepted scaffold carry it. A manifest probe cannot express it: probes require markers, they do not forbid them |
| D-40 | I7 is shipped **red** on the accepted scaffold, against D-30's usual reading | D-30 exists to stop an invariant that encodes a preference the working scaffold contradicts. Here the scaffold carries the defect and the measurement says so: 96 s and red with the container stopped. Same standing as the six forward requirements `check:scaffold` already reports, and the same treatment as `UniqueData` — the requirement is recorded, the file is not hand-patched, phase B regenerates it |

## 9. Deliverable 3 — unit tests for the primitives

A new directory `framework/src/PetClinic.ApiTests/Tests/Unit/`, every test marked
`[Category("Unit")]` (D-27). No SUT required.

| Test | What it proves | Replaces |
|---|---|---|
| `LastName` — letters-only suffix, length ≤30 | §10.5: digits in a last name are rejected with `400` | rubric check 5 |
| `Telephone` — exactly 10 digits | §11: 11–20 digits pass schema validation and then fail with `500` on save | rubric check 5 |
| `PetName` ≤30, `PetTypeName` ≤80 | contract constraints | rubric check 5 |
| Dates are `yyyy-MM-dd` with `CultureInfo.CurrentCulture = uk-UA` | a culture-sensitive format produces `14.05.2020` and a `400` | rubric check 5 |
| `EnsureStatus` puts `RawContent` into the exception message on a wrong code | all 20 scenarios route their code checks through this method | rubric check 9 |

S6's DoD in the tracker demands "unit checks prove …", but no such tests exist in the scaffold — the
property is currently checked by a judge reading code.

The culture test restores `CurrentCulture` in a `finally`: the assembly is `[assembly:
NonParallelizable]`, but leaking a culture between tests is unacceptable regardless.

---

## 10. Deliverable 4 — the canary scenario

One BDD scenario that, for the first time in stage 0, **executes** the Reqnroll pipeline: the hooks,
DI through `IObjectContainer`, `ScenarioState`, `ResolveFeatureFile()` + `ResolveAcTag()`, the real
request steps, and `Drain()` through the container.

### 10.1 Constraints discovered while designing it

Read from `TestData/TestDataProvider.cs`:

1. `ResolveFeatureFile()` takes the tag from the `Feature:` line out of a **hard-coded map** of
   `F01/F02/F03` and throws when there is no match. A new tag such as `@FRAMEWORK` will not resolve.
2. `ResolveAcTag()` takes the first scenario tag **starting with `AC-`** and throws when there is
   none. A tag `@FRAMEWORK-WIRING` will not do.

Both constraints were unknown precisely because this path never ran. Discovering them is already
partial confirmation of the hypothesis in §2.3.

### 10.2 Composition

| File | Contents | Why there |
|---|---|---|
| `Tests/Smoke/F00-framework-wiring.feature` | `@F00` on `Feature:`, `@AC-F00-01` on the scenario; steps are existing request steps only | Outside `Features/`: `check-tests.mjs` counts scenarios only there, so the "scenarios = done + 1" arithmetic survives. Outside the stage-1 fence (`Features/`, `StepDefinitions/`, `Data/`) — stage 1 cannot modify it (D-28) |
| `Data/F00-framework-wiring.json` | a block keyed `AC-F00-01` | the same shape as the other data files. The `F00-` prefix is load-bearing, not decoration: `TestDataProvider` resolves a flow's data file BY THE FLOW TAG (D-33), so the tag has to be in the name |
| `TestData/TestDataProvider.cs` | **nothing — no entry, and no map** | D-33 replaced the closed `FeatureFiles` map with resolution by flow tag over the files on disk. An `["F00"] = …` line is the exact shape that made a fourth flow impossible for stage 1 to add, since `TestData/` sits outside the fence |

Both file names above read `FrameworkWiring.*` in the first draft of this section, and the manifest
later overruled them: `check-scaffold.mjs` demands `F00-framework-wiring.*`. Left as they were, a
reader following this table would write `FrameworkWiring.json`, get a red gate, and own a data file
that resolution by tag cannot find — the loop never reads this document, but a person does.

**No new step definitions (D-29).** The scenario is assembled from existing request steps, and the
status-code assertions are made by `EnsureStatus` inside them. Hence: no risk of `Ambiguous step
definitions`, nothing to add under `StepDefinitions/`, and `loop/STEPS.md` stays clean (the inventory
scans only `StepDefinitions/` and `Features/`).

### 10.3 Verified free of side effects

| Mechanism | Effect of `@F00` / `@AC-F00-01` |
|---|---|
| `checks.mjs → scenarioTags`, `scenarioTitles` | scan `Features/` only — they never see the canary |
| `check-tests.mjs` §6, scenario count | counts `Features/` only — the arithmetic is intact |
| `check-tests.mjs` §1, diff fence | `Tests/` is outside `STAGE1_ALLOWED` — a stage-1 turn editing it gets a red gate, which is the intent |
| `flows.mjs → flowGroupOfAc` | called only for ACs from the stage-1 tracker, which holds no F00 rows |
| `steps-inventory.mjs` | scans `StepDefinitions/` and `Features/` — the canary is not indexed |

### 10.4 Side benefit

The canary becomes a regression net for stage 1 as well: if a stage-1 turn widens a shared step and
breaks it, `dotnet test` goes red on the canary — which is exactly the risk the main design document
lists as open ("a stage-1 iteration changes a shared step and breaks accepted scenarios").

---

## 11. What is left untouched

The per-row loop of stage 0 · the stage-0 tracker · `PROMPT.scaffold.md` · `rubrics/scaffold.md` ·
the judge call after every row · the dual scope `--through-row` / `--through-wave` · the manifest **as
the specification of stage 0** (now 43 entries and 105 probes, up from 39/91 — it gained requirements,
it did not change role) · the 3 smoke tests · `sut reset` with its proof of restart and seed · the
deny-list · the
write protection of specs, rubrics and prompts · fail-closed reads through `gitTry` · the strict
verdict parser and the "when uncertain, REJECT" asymmetry · `SPEC_UNCLEAR` routing to a human · the
clean-tree requirement and the refusal to work on `main` or a detached HEAD · recovery after an
interruption · pinned model IDs · **all of stage 1**.

**Two entries left this list during implementation, and honesty is worth more than a tidy claim.**
The stage-0 **tracker** was edited: §9 and §10 write their requirements into its rows' DoD, because
that is the only writable place they can live — `loop/PROMPT.scaffold.md` and
`loop/rubrics/scaffold.md` are denied to `Edit` and `Write`, deliberately. And **telemetry** was
rewritten rather than preserved, by §16. Neither loses a property: the tracker gained requirements
and lost none, and the run summary gained the agent's cost beside the judge's.

---

## 12. Success criteria for the experiment

Criteria 1, 2, 3 and 6 are met by the harness work itself. Criteria 4, 5 and 7 need a **regenerated**
framework, because the unit tests and the canary are stage 0's output — the harness work only makes
them a requirement and proves that requirement satisfiable. The two groups are marked below.

The experiment succeeds when **all** of the following hold:

| # | Criterion | How it is checked |
|---|---|---|
| 1 | `npm test` is green | Including the fix for the failing `tests/check-spec.test.mjs:719` — it is red on a CRLF checkout, so there is no baseline today (appendix A) |
| 2 | I1–I6 are green on the **current accepted** scaffold, and I7 is red on it for the reason §8.1 records | `node scripts/check-invariants.mjs` — six `ok` lines and one named failure |
| 3 | Each of the 7 invariants **goes red** on its own injected violation | `tests/invariants.test.mjs` |
| 4 | The 5 unit tests and the canary are green | `dotnet test` |
| 5 | The canary **goes red** when `[BeforeScenario(Order = 0)]` is commented out — see the note below | Proves it really exercises DI rather than passing vacuously |
| 6 | Stage-0 gate wall clock is minutes, not ~22 | Measured before and after |
| 7 | At least one stage-0 run summary is committed | `loop/runs/` currently holds only a README — there is no baseline |

**On criterion 5, and this correction cost a task to find.** The obvious mutation — remove one
`RegisterInstanceAs` from `ScenarioHooks` — is a **no-op**. Measured three ways: removing
`PetsService`'s registration, `OwnersService`'s, or `ApiClient.Shared`'s each left the canary green,
because Reqnroll's BoDi container auto-constructs any concrete type whose constructor arguments it can
already resolve. No single registration line is individually load-bearing.

What does turn it red is one line — commenting out the hook attribute itself — and the failure names
the whole chain:

```
Circular dependency found! System.Uri (resolution path:
  OwnerSteps → OwnersService → ApiClient → RestClient → System.Uri)
```

That error is the proof the criterion was after: BoDi walked from the step definition down to the HTTP
client and could not finish. Commenting out all five registrations does the same.

**And the reasoning behind the criterion needed correcting too.** A mutation that passes proves the
**mutation** is a no-op — not that the test is vacuous. The first draft drew the opposite conclusion
and would have declared the canary void on the strength of a badly chosen mutant.

**If 2–5 hold:** six of the nine rubric checks are mechanised and run for free on every wave, and the
cross-cutting path that was never executed now is. Phases 3–6 (§14) are then safe.

**If any of 2–5 fails:** that rubric check does not mechanise — it stays with the judge, and the scope
of phase 3 shrinks by that check. That is also a result, obtained without deleting anything.

---

## 13. Risks

| Risk | Assessment | Mitigation |
|---|---|---|
| Skipping the pre-gate hides a genuinely red HEAD | low | D-23: skip only on a SHA match **and** a clean `framework/`; any doubt runs the gate. Five boundary tests |
| I3 breaks when the services are refactored to another call style | medium | The failure is self-diagnosing: the script prints which routes it did not find. The negative control pins the expected style |
| I5/I6 are too strict and go red on legitimate work | medium | D-30: run against the accepted scaffold first. If they go red there, loosen to a form that passes rather than ship them |
| The canary turns out to be flaky (data, seed) | low | It uses only existing steps and its own data file, and runs after `sut reset` alongside the smoke suite |
| The one-line change to `TestDataProvider` breaks something | low | §10.3 — cross-checked against every mechanism that reads tags; the unit tests and the smoke suite run in the same gate |
| Gates get slower because of the new checks | negligible | Text scans ~1 s, unit tests seconds, no Docker |
| The experiment succeeds but phases 3–6 are postponed | medium | Nothing breaks: deliverables 1–4 are useful on their own and do not depend on phases 3–6 |

---

## 14. What comes next — phases 3–6

These happen **only** if the criteria in §12 are met. They are written up in this same document when
their turn comes.

| Phase | Content | Expected effect |
|---|---|---|
| 3 | The judge is called once at the end of the stage and receives the **state of the tree** plus the report of the deterministic checks instead of a diff. The rubric shrinks to its semantic items. Row statuses are set from the manifest | 14 judge calls → 1–2. Requires a stage-0 golden set: the accepted scaffold as the PASS control and 4–6 variants with injected semantic defects as REJECT controls, modelled on `loop/judge-eval.mjs` |
| 4 | 8 wave sessions instead of 14 per-row turns; `--through-row` is removed | −6 agent sessions, −43 % of specification re-reading |
| 5 | Remove the stage-0 tracker, `PROMPT.scaffold.md`, the old rubric, the `row` field on all 39 manifest entries, the scope branches in `gates.mjs`, and the related tests | −600…800 lines of harness, −450 lines of documents. A rule stops existing in four copies |
| 6 | The canary becomes the entry condition for stage 1 | A cross-stage gate: stage 1 does not start until the Reqnroll pipeline has been proven by execution |

Convergence of the target model: 2 attempts per wave against the deterministic gates, 2 rework rounds
after the judge, a stop on a repeated identical findings set (by hash), and escalation to a human
through `SPEC_UNCLEAR`.

---

## 15. Adding a flow after the fact

Deliverable 5. The requirement: the flow must be re-runnable and extensible in both directions — a
full rebuild from nothing, and adding work to a framework that already exists.

### What blocked it

Adding a fourth flow needs six things, and five of them are input:

| # | What | Where | Who |
|---|---|---|---|
| 1 | `FLOW_GROUPS['F-04'] = 'F04-<slug>'` | `scripts/flows.mjs` | one line — every path (`flowDocPath`, `featurePath`, `dataPath`, `flowGroupOfAc`) already derives from it |
| 2 | The flow document with its ACs and Test plan | `docs/specs/petclinic/flows/` | a human, or the `spec-builder` skill |
| 3 | Rows, and the `**Total:**` line | `loop/trackers/tests.md` | a human |
| 4 | The feature skeleton | the framework | stage 1 **can** — `Features/` is inside its fence and the file check runs after the turn. It just was not told (D-34) |
| 5 | A manifest entry for that skeleton | the manifest | needed so a from-scratch rebuild produces it (D-32) |
| 6 | A `FeatureFiles` map entry in `TestDataProvider` | the framework | **the hard blocker.** `TestData/` is outside the stage-1 fence, so no stage-1 turn may add it (D-33) |

Item 6 is the one that made this "not a stage-1 operation": without the map entry
`ResolveFeatureFile()` throws and every scenario of the new flow fails, and with it a human has to
edit a file stage 0 is supposed to generate.

### What it costs after D-32, D-33 and D-34

```
1. one line in scripts/flows.mjs          'F-04': 'F04-owner-search',
2. write the flow document                docs/specs/petclinic/flows/F-04-owner-search.md
3. append rows as todo, fix **Total:**    loop/trackers/tests.md
4. npm run ralph -- --stage tests --flow F-04
```

The first turn creates `Features/F04-owner-search.feature` and `Data/F04-owner-search.json` itself;
`TestDataProvider` finds the data file because its name starts with `F04`. No C# change, no rebuild,
no reset.

### The two entry points, stated

| Entry | When | Command |
|---|---|---|
| From nothing | the framework is being rebuilt, or does not exist | `npm run reset -- --yes` then `--stage scaffold` then `--stage tests` |
| Straight to stage 1 | the framework exists and more scenarios are wanted | append rows as `todo`, fix `**Total:**`, run `--stage tests --flow F-0X`. **No reset.** |

Two sharp edges worth naming:

- **`npm run reset -- --yes --stage scaffold` should not be used.** It deletes `framework/` and resets
  only the scaffold tracker, leaving the tests tracker at 20 `done`. Stage 0 then rebuilds a framework
  with empty feature skeletons while the tracker claims every criterion is finished, and nothing
  catches it: stage 1 sees no actionable row and exits 0. The safe command is the full `--yes`.
- **Adding rows without updating `**Total:**`** stops the run at once — `validateTable` cross-checks
  the declared total against the parsed row count, and the runner exits 2. That is the guard working,
  but it is the easiest way to lose ten minutes.

### Timing

D-33's requirement takes effect when stage 0 next runs, because `TestDataProvider` is stage 0's
output. Doing it **before** the rebuild means one rebuild; doing it after means two.

---

## 16. The agent's cost becomes a recorded number

Deliverable 6, added at the operator's request before phase B, so that the regeneration produces the
one measurement worth having instead of throwing it away.

### What was missing

The run summary recorded what the **judge** cost and said nothing about the **agent** — documented as a
deliberate trade in `loop/telemetry.mjs`: its stdio is inherited so a human can watch the turn, which
ruled out the output format that reports usage. The trade was "watch it or price it".

### What removes the choice

`--output-format stream-json --verbose` emits one JSON object per line **as the turn runs**, so the
runner relays the text to the console *and* takes `usage` and `total_cost_usd` from the final object.
The run summary gains three columns beside the judge's — `a-in`, `a-out`, `a-cost` — and a matching
line in the totals block.

| D | Decision | Rationale |
|---|---|---|
| D-35 | `AGENT_CMD` defaults to `--output-format stream-json --verbose`, and `runAgent` pipes stdout instead of inheriting it | The numbers arrive in the stream, and an inherited stream cannot be read. stderr stays inherited, so a crash still lands in front of the operator untouched |
| D-36 | The turn stays watchable: each assistant message, each tool call and each tool RESULT is relayed as it arrives | The price of the number is that this is the runner's rendering, not the CLI's own. Stated rather than hidden — if that visibility matters more, this deliverable is the one to drop |
| D-37 | The agent's usage is parsed by `parseAgentUsage`, **not** by `parseJudgeReply` | Measured: the judge's parser requires `result` to be a **string**, which is right for the judge — the verdict IS that field. Reusing it dropped the cost of four realistic shapes, including every turn that ended `error_max_turns`. A turn that ran out of turns still cost what it cost |
| D-38 | The failure branch records the agent usage too | A red turn cost what it cost. Leaving it out would make the totals understate exactly the turns worth understanding |
| D-42 | A tool result is trimmed to the HEAD on success and the TAIL on failure, with the dropped line count printed | The first draft of D-36 relayed `user` events not at all, so a red test showed `· Bash` and no answer under it — the tool named, its verdict withheld. Untrimmed is not an option either: one `dotnet test` result would bury every other turn. Head and tail differ because a success is recognised by what it set out to do and a failure is explained by what it ended with — `dotnet build` and `dotnet test` both put the summary last |
| D-41 | Both spawn wrappers call `setEncoding('utf8')` on the stream rather than letting `+=` decode each chunk | A pipe splits on BYTE boundaries. `buffered += chunk` decodes every Buffer on its own, so a character whose bytes straddle a split becomes U+FFFD on both sides — and this is the release that started reading that stream instead of inheriting it. Worse on the judge path, where the stdout IS the verdict: `PASS` and `REJECT` are ASCII and survive, so the judgement stands while its reasoning turns to mojibake. A stub writing one byte per event, a millisecond apart, is the negative control |

### The four shapes that lost the number

All measured with stubs before the fix; each returned `null` where the cost was plainly present:

```
{"type":"result","subtype":"error_max_turns","is_error":true,"usage":{…}}   no `result` field
{"type":"result","result":{"code":"…"},"usage":{…}}                        `result` is an object
the envelope followed by any non-JSON line                                 last line is not it
the envelope followed by any further JSON line                             last line is not it
```

`parseAgentUsage` scans lines from the end and takes the first object carrying `usage` or
`total_cost_usd`, so a shutdown line after the envelope cannot displace it. It returns `null` and never
zeroes when nothing reported anything: a zero cost is a claim about a run, and "nobody said" is not
that claim.

### One claim still unverified

That `--verbose` is **required** by the CLI for this format under `--print` was not measured, because
measuring it would have meant spawning the real binary during implementation. It is harmless if
redundant. Worth one `claude --help` before phase B.

---

## Appendix A — measurements

Developer machine, 2026-08-20. Docker 29.1.2, .NET SDK 10.0.303, container `petclinic`
(`springcommunity/spring-petclinic-rest`).

| Quantity | Value | How it was obtained |
|---|---:|---|
| `dotnet build framework/ApiTests.sln --nologo` | ~10 s | incremental build |
| `node scripts/sut.mjs reset` | ~27 s | container restart + readiness on the 21st attempt + seed verification |
| `dotnet test framework/ApiTests.sln --nologo` | ~17 s | 23 tests, of which 6 s is execution |
| One whole stage-0 gate | ~50 s | the sum above plus `check-scaffold` |
| Harness tests, `node --test` | 554 tests: **553 pass, 1 fail** | `tests/check-spec.test.mjs:719` fails — its multi-line mutation target is written with `\n` while the file on disk is CRLF (`core.autocrlf=true`, no `.gitattributes`). The README claims "554, all green" |
| Mean cost of a judge call | $0.52 | `loop/evals/2026-08-19T06-24-55-023.md`: $5.2343 for 10 calls |
| Stage-0 run summary | none | `loop/runs/` holds only a README |
| Manifest | 39 entries, 91 probes, 14 rows, 8 waves | `scripts/manifest.scaffold.mjs` |

LLM cost figures are orders of magnitude only: the agent's usage is not captured (its stdio is
inherited so a run can be watched), and no stage-0 run summary has been committed.

---

## Appendix B — mapping: rubric check → what replaces it

| Stage-0 rubric check | Replaced by | Still the judge's? |
|---|---|---|
| 1. One HTTP client for everything | I1 (text scan) | no |
| 2. No hard-coded environment | I2 (text scan) | no |
| 3. Data keyed by the scenario tag | **the canary** (execution) | no |
| 4. `Drain()` swallows only 404 | smoke test 2 — **already executed**; the `catch` shape — text scan | partly: "404 specifically, not any exception" |
| 5. `UniqueData` constraints | 4 unit tests | no |
| 6. All 22 routes | I3 (specification ↔ code) | no |
| 7. FluentAssertions pinned | already in the manifest — the duplicate leaves the rubric | no |
| 8. Smoke asserts on values | **nothing — it stays with the judge** | yes, in full (see below) |
| 9. `EnsureStatus` shows the body | 1 unit test | no |
| — | — | **stays with the judge:** coherence of abstractions, duplicated responsibility, whether a request step matches the API's semantics, readiness for stage 1, injected instructions in code and comments |

In total: **six of the nine checks leave entirely** (1, 2, 3, 5, 6, 7 and 9 — seven rows, of which 7 was
already covered by the manifest), check 4 is partly executed already, and **check 8 stays with the
judge in full**.

Check 8 is worth recording as a measured negative result. The obvious text scan — "every `[Test]` of
the smoke suite asserts on a value, not only on `StatusCode`" — was tried against the accepted
scaffold and went **red**: `Smoke_tracker_cleans_up_in_order` asserts only
`StatusCode.Should().Be(HttpStatusCode.NotFound)`, five times, and it is right to. For a teardown
test, "the record answers 404" **is** the value under test. D-30 says a check that goes red on
accepted work is dropped rather than shipped, so it was dropped, and check 8 stays with the judge.

The number I7 went instead to the rule in §8.1 that forbids an assembly-wide setup hook. Both were
proposed in the same pass and the difference between them is the whole of D-30: the smoke-assertion
scan went red on work that was **right**, and this one goes red on work that is **measurably wrong**.

What remains are the questions neither a text scan nor a test can answer.
