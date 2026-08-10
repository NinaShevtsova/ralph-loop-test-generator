# Final review of the loop harness — 2026-08-07

Four independent read-only reviews of `86a7df9..29b4f7e` (93 commits, 42 files, ~10,900 lines):
the runner, the gate CLIs, the loop content, and the test suite itself. Every finding below was
**measured** unless marked *reasoned*.

Three findings were reported independently by two reviewers each — the diff-fence base, the step
inventory handed to the judge, and `RALPH_JUDGE`. Independent agreement, not one reviewer's theory.

## What the review retired from the "unverified" list

The runner reviewer built a throwaway clone with stub `docker`, `dotnet`, a readiness server on 9966
and a `claude.cmd` that dispatches on `RALPH_JUDGE`, and **executed the region the plan says has never
run**: green gate, left-behind probe, `headUnmoved`, the failure branch, the judge call, the read-only
comparison, `diffBase` and its recorded-base fallback, the verdict write, the malformed counter, all
three status writes.

**Stops 2 and 3 fired for the first time**, with correct exit codes and correct counts. The plan's
statement that "the loop's refusals are well tested and its accept path is not tested at all" is now
out of date in the runner's favour.

Confirmed correct under execution, having been suspected: `preGateSteps` versus `gateSteps`, both of
`preGate`'s skips, `WATCHED` and the preflight clean-scope check, both `diffBase` branches, and the
crash-ordering of every write. The verdict parser could not be broken by any of fenced, bolded,
blockquoted, lowercase, empty, null or prose-first input.

---

## Addendum, 2026-08-07 — `sut.mjs` verified against live Docker

Docker Desktop failed to start with the same class of fault as before: a dangling reparse point, this
time `%LOCALAPPDATA%\docker-secrets-engine\engine.sock` (mode `-a---l`, `fsutil reparsepoint query` →
`Error 1920`, `Remove-Item` → "The file cannot be accessed by the system"). Renaming the parent
directory cleared it, as it did for `Docker\run` on 2026-08-05. Engine 29.1.2, linux containers.

The deferred plan Task 3 Step 6 now passes, and two things beyond it were measured for the first time.

**D-09 holds end to end.** The design rests on "the state is reset before every gate run, because only
then does a red test unambiguously mean *the test is bad* rather than *the database is dirty*", and
nothing had ever checked it. Measured: `POST /owners` → id 11, `GET /owners/11` → **200**;
`npm run sut -- reset` → exit 0, ready after 14 attempts; `GET /owners/11` → **404**. The reset really
resets.

Also measured: `ensure` on a missing container pulls, creates and waits (ready after 44 attempts);
`ensure` on an existing one starts it; `wait` returns after 1 attempt against a live app; the gate's
exact invocation `node scripts/sut.mjs reset` exits 0; and the suite stays 278/278 with a live
container. `sut stop` remains unverified — the gate does not use it.

**Finding 16 confirmed live, in an adjacent form.** `exists()` filters on `name=^/petclinic$` alone.
A previous `ensure` had left a container in state `created` with `9966:9966` baked into its
`HostConfig.PortBindings`; the next `ensure` therefore saw it as existing and went straight to
`docker start`, which failed on the port. The message named the real reason, so the behaviour is not
silent — but the container's stored configuration is never compared against the current environment,
which is what the reasoned form of this finding predicted for a changed `PETCLINIC_PORT`.

One environmental note worth keeping: port 9966 was held by a **native** Spring PetClinic under JDK 17,
serving the identical readiness payload. The harness is built around `sut reset` restarting a
container, which cannot restart a native process, so the native instance was stopped rather than
adopted. A machine that has one running will fail `sut ensure` at the port bind, with an accurate
message.

---

## Blockers — the loop does not work correctly until these are fixed

### B1. The first stage-1 turn cannot legally finish

`loop/PROMPT.tests.md:90-101` tells the agent to run `check-tests.mjs` and **then** commit on green.
`scripts/check-tests.mjs:91` reads `git diff --name-only HEAD~1 HEAD` — the **previous** commit.
Measured now:

```
$ node scripts/check-tests.mjs --ac AC-F01-01
  FAIL diff fence: a stage-1 turn must not touch docs/plans/2026-08-05-loop-harness.md
```

That file is from an earlier commit and has nothing to do with any turn. `PROMPT.tests.md:156` forbids
committing with a red gate, so the agent's only legal moves are `blocked` or disobedience. The runner
is fine — it gates after the commit; the prompt's ordering is what is wrong.

### B2. The rubric forbids what the flow documents require

`loop/rubrics/tests.md:116-118` — "**No seeded record is read or relied upon.**"
`F-02-owner-pet-lifecycle.md:24-26` — "Choosing the pet type is the same in all ACs of this flow:
`GET /pettypes` → take the first element."

§10.1's actual rule is narrower: never rely on the concrete **`id`s** of seeded records. The judge holds
both documents and an instruction to reject when uncertain, so it would reject 9 of the 10 F-02 ACs and
every pet/visit AC in F-03 for obeying their own precondition.

Compounding it: §10.9's real rule — AC-F01-04 and AC-F02-10 must create their **own** pet type, because
deleting one cascades into other owners' pets — has **no rubric item at all**. The §10 rule with the
widest blast radius is uncovered while its inverse is over-enforced.

### B3. A two-commit turn walks through the diff fence

Same one-commit assumption `loop/ralph.mjs:620-646` spends thirty lines rejecting for the judge's diff
base — and it stopped one caller short. `gateSteps` passes no base, so the fence uses `HEAD~1..HEAD`.

Measured: commit 1 rewrites `Support/ResourceTracker.cs`, commit 2 adds the feature file → **gate
green**, framework edit invisible. Design §6.4 says this fence exists "to catch an agent quietly
reworking the framework so its own scenario turns green" and that it is "never delegated to the judge".

The same bug makes the judge's `Excluding` inventory report `_None._` for a two-commit turn — the exact
lie its own comment at `check-tests.mjs:297-302` forbids ("must never quietly say nothing when it means
unknown"). Rubric item 5 is silently retired.

### B4. A failed turn leaves no note, so the next turn is fed stale findings

`loop/ralph.mjs:585-598` sends the failure text to `console.error` and nowhere else.
`loop/verdicts/<id>.md` is written only after a judge call, and `previousFindings` reads that file for
any `rework` row.

Measured end to end: judge call #2 returned REJECT with findings; two later turns failed the runner's
own "committed nothing" check; the 4th agent prompt then carried judge call #2's findings under "These
are the problems an independent judge found. Fix **all** of them" and **zero** mentions of the real
reason. Three such turns trip `K_FAILURES` and stop the run blaming the agent. Design §6.2 Step 3
requires `rework` "**with a note**".

### B5. The judge's step inventory contains the turn's own new steps

`loop/gates.mjs:49` regenerates `loop/STEPS.md` as the last gate step — after the turn —
and `loop/ralph.mjs:678` then feeds that file to the judge. `scripts/steps-inventory.mjs` reads the
working tree, so every new step appears as pre-existing with a non-zero use count.

The rubric calls that file "every step definition that **already exists**" and item 22 tells the judge
to check it for a reworded duplicate. Design §6.3 says step 5 regenerates it "**for the next
iteration**". The pre-turn snapshot the judge should get already exists at `ralph.mjs:479`.

### B6. An inherited `RALPH_JUDGE` silently switches the memory bridge off

`runJudge` sets `RALPH_JUDGE=1`; `runAgent` does `{ ...process.env, ...env }` and clears nothing.
Measured: with the variable exported in the operator's shell, the **agent** child receives
`RALPH_JUDGE=1 RALPH_STAGE=scaffold`, and the hook produces 0 bytes and exit 0 instead of 547
characters of facts and journal.

This is the plan's own named single point of failure — "fails closed and silent, no artifact anywhere
would have said so" — and the hook's docstring invites hand-testing with exactly these variables.

### B7. The reuse mechanism loses on its most likely input

`scripts/steps-inventory.mjs:45-48` keeps `been` in `STOP_WORDS` and leaves `has` out, so a reworded
step gains a token the original lacks. Measured:

| pair | score |
|---|---|
| `an owner is registered` / `an owner has been registered` | **0.33** |
| `the owner is deleted` / `the owner has been deleted` | **0.33** |

Hard fail is 0.90 and the judge's review band starts at 0.65, so the commonest rewording an LLM
produces is not merely allowed — it never reaches the judge as data. Treating `has`/`have` as stop
words scores both at 1.00. The stated reason for the exclusion (that these encode direction) is
measurably wrong: direction is separated by the bigram half, not the stop list.

### B8. A scoped step definition is invisible to both parsers

`ATTRIBUTE` at `steps-inventory.mjs:25-28` requires `)]`. Measured:
`[Given("a new owner is registered"), Scope(Tag = "F01")]` → `extractSteps` returns `[]`. `Scope` is a
first-class Reqnroll attribute; C# 11 raw strings are missed too. Such a file vanishes from
`loop/STEPS.md` *and* from the duplicate gate, while section 5 prints its unconditional green
`0 step(s) compared`.

### B9. The literal-id probe misses the spelling this codebase uses

`scripts/checks.mjs:115` is case-sensitive and `\b`-anchored. Measured: `new Pet { OwnerId = 1 }` → 0
hits, `PetId = 7` → 0, `_ownerId = 1` → 0. `scripts/manifest.scaffold.mjs:51-54` probes the models for
`/OwnerId/` and `/PetId/`, so PascalCase is the property spelling and object-initializer syntax is the
idiomatic way to write it.

### B10. `Data/*.json` is inside the fence and scanned by nothing

Section 4 reads only `StepDefinitions/**.cs`, section 2 only the feature file. Measured:
`{"AC-F01-01": {"path": "/owners/1"}}` → green. Rubric item 15 pushes all data **into** these files,
making the JSON the one writable surface inside the fence no literal-id check ever touches.

### B11. "Scenario count" counts tags, not scenarios

`check-tests.mjs:282-283` counts AC tags. Measured: a second `Scenario:` **without** a tag → green.
Spec §6.4 gives this check one job — "catches a turn that wrote two scenarios or none". `scenarioTitles`
is already imported into that file and counts real `Scenario:` lines.

---

## Crash and diagnosis defects

| | Where | Measured effect |
|---|---|---|
| C1 | `runJudge` has no `CMD_LIMIT` | Judge prompt floors at 26,195 (F-01) / 34,263 (F-02) chars **before** the diff. On win32 with a non-`claude` `JUDGE_CMD`: 26k → unactionable stop; 34k → `spawn ENAMETOOLONG` → unhandled rejection, raw stack, exit 1 |
| C2 | Neither spawn wrapper handles `child.stdin` `'error'` | A child that exits before draining stdin crashes the runner with `write EOF` above ~64 KB. The failure modes that make `claude` exit fast — auth, bad flag, rate limit — are exactly when it will not drain |
| C3 | `SPEC_UNCLEAR` → `blocked`, question never recorded | Operator is told to answer a question, then shown `_None._`. The stop never names `loop/verdicts/<id>.md`, where the text actually is |
| C4 | `headUnmoved` measures HEAD movement, not work | A turn that did nothing but commit its own tracker flip passed, was judged, and went `done` |
| C5 | `AGENT_CMD=""` accepted | `ERR_INVALID_ARG_VALUE` → unhandled rejection → exit 1, after the counter, journal, `.base` and inventory have run. `stop()` two functions above treats `''` as "use the fallback" |
| C6 | `branch()` is the fail-open `git()` | On an unborn HEAD `rev-parse --git-dir` exits 0 while `--abbrev-ref HEAD` exits 128, so `branch()` returns `''` — the one value that satisfies the `main`/`master` refusal. Detached HEAD is not refused at all |
| C7 | Exit code 3 is unreachable | Documented in `ralph.mjs:28` and design §7. `pickTarget` guarantees one of the three counts is ≥1 whenever it is evaluated |
| C8 | Two side-effecting gate steps graded by exit code alone | `sut.mjs` documents a live way to exit 0 having done nothing; `steps-inventory.mjs:266` uses the un-hardened form of the same check |

---

## The test suite reviewed by mutation

**116 mutations, 87 caught, 25 genuine coverage gaps. Kill rate 76%.** No result was a timing artefact
and no result depended on cross-file ordering.

### T1. The prompt and the rubric are pinned by keyword, not by content

The **entire** `loop/PROMPT.tests.md` (177 lines) was replaced with a 9-line bag of the tokens its tests
grep for, and the **entire** `loop/rubrics/tests.md` (209 lines) with a keyword skeleton of 26 numbered
stubs. **All 278 tests still passed.**

Every assertion in both files is `assert.match(text, /token/)`. They prove the vocabulary is present,
not that any instruction survives. These two documents have the most leverage over output quality in
the whole system and the least real coverage.

### T2. Three modules — 1,250 lines — are executed by no test at all

Syntax-destroying the first line of each left the suite green: `loop/ralph.mjs` (779 lines, the runner),
`scripts/check-tests.mjs` (353), `scripts/check-scaffold.mjs` (118). This includes the branch that
**applies** the 0.65 / 0.90 bands — `similarity()` is well tested, the code that uses it is not.

### T3. The path fence is only tested in the direction that fails closed

Deleting `if (!normalised.startsWith(PROJECT_PREFIX)) return true;` from `outsideFence` **survives**.
Controls confirm the asymmetry: mutating `PROJECT_PREFIX` in either direction *is* caught, because those
make the fence reject valid paths. Acceptance of bad paths is covered only for `..`, rename pairs and
null. Verified escape: `framework/src/PetClinic.OtherLib/Features/Foo.feature`.

### T4. Two assertions that cannot fail for the defect they name

- `pollUntilReady reports the reason for an unreachable host` — replacing the captured reason with the
  constant `'unavailable'` **survives**; the test asserts only `length > 0` and `!/abort/i`.
- `READY_URL appends the probe path exactly once` — deleting the trailing-slash strip **survives**; the
  expected value is derived with the same expression the code uses, and the case in the test's own name
  cannot be exercised because `BASE_URL` is fixed at module load.

### T5. The `MIN_ATTEMPT_MS` fix is guarded by a coin flip

Reverting commit `db8a500` is caught in **1 run in 15**. A revert would pass CI ~93% of the time.

### T6. Neither spawn wrapper's `'error'` handler is exercised

Making `runAgent`'s handler report `ok: true` survives; deleting it entirely survives. On win32
`shell: true` routes a missing binary through `cmd.exe` (exit 1, no `error` event). **On Linux and
macOS, where `shell` is false, a missing agent binary would be reported as a successful turn** — and the
three tests that probe this are `{ skip: !WIN }`.

### T7. Two defects hang `npm test` instead of failing it

Removing the win32 stdin path in `runAgent`, and removing the non-finite budget check in
`pollUntilReady`, both leave the run spinning with no summary. The suite has no per-test timeout.

### Smaller survivors

`malformedAcTags` without its `$` anchor (yields the exact misdiagnosis it exists to prevent);
`bigramOverlap` returning 1 instead of 0 for a single-token side (0.25 → 0.75, moving a pair into the
reportable band); the `STOP_WORDS` direction-word class; `runGate`'s stop-at-first-red (nothing imports
it); 38 of 39 manifest probes have no behavioural test and the `wave` field is unpinned; `setStatus`
against a title containing an apostrophe — which the real AC-F01-04 title has.

### What the suite does well

`tests/hook.test.mjs` caught all 6 mutations aimed at the hook, including both environment gates, the
git fail-open and the blocked-row report. `tracker.test.mjs` 18/18, `verdict.test.mjs` 6/6. The
wall-clock test is **not** flaky: 0 failures in 30 isolated runs and 0 across 110 full-suite runs under
load, and it correctly went red against the one mutation it exists to catch.

---

## Duplication still outstanding

`flows.mjs:25-27` says the project path is "spelled out here and nowhere else". Three more copies:
`steps-inventory.mjs:236`, `manifest.scaffold.mjs:10`, `checks.mjs:230`. The `steps-inventory` one is
load-bearing — it and `check-tests.mjs` are two parsers of one artifact with independent path
constants, and divergence yields an empty inventory and a green `0 step(s) compared`.

Also: `loop/verdicts/<id>.report.md` in both `gates.mjs:45` and `ralph.mjs:669` — drift there silently
costs the judge its machine report; `framework/ApiTests.sln` in three places; `loop/STEPS.md` in three.
