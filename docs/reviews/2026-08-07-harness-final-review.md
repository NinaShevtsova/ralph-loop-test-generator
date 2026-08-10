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

## Addendum, 2026-08-07 — the first real iteration, and the question it settled

One iteration of stage 0 with the real actors: agent `claude -p --model sonnet`, judge
`claude -p --model opus --permission-mode plan`. `MAX_ITER=1`, deliberately, because three things had
never been exercised together and a fourteen-iteration run would have found that out expensively.

All three came back clean, and each was verified against the repository rather than against the agent's
own account of it:

- **the agent understood the prompt** — commit `3d13d7a` holds exactly the five wave-1 files, 85
  insertions, nothing outside the wave;
- **the judge returned a usable verdict** — first line exactly `VERDICT: PASS`, no fence, no preamble;
  `parseVerdict` → PASS, `isWellFormed` → true. This was the likeliest point of failure and the main
  reason for stopping at one iteration;
- **the runner, not the agent, wrote `done`**, and `check-scaffold --through-wave 1` passes 5/5.

**And it appeared to answer the standing open question.** `dotnet test` against a solution with no
tests exits 0 — item 1 on the "what would still surprise us" list, the case that would have made every
stage-0 pre-turn gate red for a reason unrelated to the work.

**That reading was wrong, and it stayed wrong for thirteen rows.** Corrected when S14 became the first
task with a test to run: S1's csproj never referenced `Microsoft.NET.Test.Sdk`, so `dotnet test` was
not tolerating zero tests, it was **not running at all**. Measured on the commit before the fix —
`dotnet test` restores the project and stops, with no test run and no discovery. Measured after —
`Passed! - Failed: 0, Passed: 3, Skipped: 0, Total: 3`.

The outcome I recorded was right and the reason was not, which is the more dangerous shape: one leg of
a three-legged gate was absent for thirteen accepted rows while the log said green. Nothing in the
harness could have caught it. `check-scaffold` verifies that files exist and match their probes,
`dotnet build` compiles, and the third leg was reporting success for not having run.

One operational fact worth stating because it recurs every run: the runner writes the tracker and never
commits it (`ralph.mjs` contains no `git commit`, by design), so the tree is dirty afterwards and the
**next** run refuses at the preflight with "working tree is dirty". Measured. The operator commits the
tracker between runs, and the message does not say that the dirt is the runner's own doing.

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

---

## Addendum, 2026-08-09 — C8 and T1 closed, and one prescription corrected

### C8, first half — the silent exit 0

**The defect is real, and `subst` is what still produced it.** Measured with `Z:` substituted to the
repository: `node Z:\scripts\sut.mjs bogus` printed **nothing** and exited **0**, while the same
command through the real path printed the usage error and exited 2. Through a *junction* the CLI
already ran — `realpathSync.native` resolves those — so the comment in `sut.mjs` named a case that
had since been fixed while the live one went unnamed.

**The obvious fix — compare `import.meta.url` against `realpathSync.native(argv[1])` and refuse when
they differ — is wrong in the other direction.** `import.meta.url` and `fs.realpathSync` both KEEP an
8.3 short name; only `realpathSync.native` expands it. `os.tmpdir()` here is
`C:\Users\N78A3~1.SHE\AppData\Local\Temp`, and `tests/ralph.test.mjs` builds its clone under it.
Measured with the one-sided form in place: a healthy `node scripts/steps-inventory.mjs` inside that
clone was called a broken invocation, its gate went red, and the SPEC_UNCLEAR test failed on a
question that never reached the tracker.

`lib.mjs:invocation` therefore reduces **both** sides and compares the results, and answers `broken`
only when `argv[1]` names this file and the two cannot be reconciled. Junction, `subst` and 8.3 short
path now all answer `cli` and run — measured. The refusal is the residual, and because the name check
needs no realpath at all, `node <anything>/sut.mjs` can no longer end in a silent 0 by any route: it
either does the work or exits non-zero. `steps-inventory.mjs`, the other half of C8, uses the same
guard; its own un-hardened form did not even realpath.

### C8, second half — proving the reset happened

`reset` proved only that `/pettypes` answers `200`, which an application that was never restarted
answers too. Two proofs replace it, and `reset` is the only command that takes them.

**The container's own start time.** Measured across `docker restart petclinic`:
`2026-08-09T17:51:55.794465458Z` → `2026-08-09T17:56:13.340830095Z`. Read before and after, and an
unmoved or unreadable value is a refusal — including a missing *baseline*, which is only legitimate
when the container did not exist and was created.

**The seed the restarted application serves.** Measured on a fresh container: `pettypes` 6, `owners`
10, `pets` 13, `visits` 4. It is kept alongside the start time rather than instead of it, because the
two prove different things and one live case separates them: with `PETCLINIC_CONTAINER` pointed at a
throwaway container while the probe still reached a `petclinic` holding one extra owner, the start
time moved and the gate would have gone green — the seed check refused with
`owners: 11, seed 10`, exit 1. Only the ABOVE-seed direction refuses; below-seed cannot be leftover
data and would stop the loop for an image change.

### T1 — the two documents that steer quality

The acceptance test was built and run. A nine-line bag of tokens for `loop/PROMPT.tests.md` and a
27-numbered-stub skeleton for `loop/rubrics/tests.md`, in a throwaway copy of the repository:

| | prompt + rubric tests |
|---|---|
| skeletons against the tests as they were | **40 / 40 green** |
| skeletons against the tests now | **17 red**, 42 green |

Two realistic single-rule mutations were measured too, since a merge garbling one rule is likelier
than a wholesale replacement: moving `npm run sut -- reset` to the end of the gate list, and trimming
item 17 to its headline. Both are caught.

What the new assertions pin is structural or cross-file rather than lexical: the block membership
(A 1-4, B 5-10, **C 11-17**, D 18-22, E 23-27), every `§` citation resolving in
`context-and-conventions.md`, the verdict contract parsing with `loop/verdict.mjs`'s own parser
**outside** any fence, a floor under every item and every prompt section, the five gate commands in
order inside the protocol section, the fence and the forbidden list as lists under their own
headings, and both worked examples — the Gherkin one holding exactly one tagged scenario with no
path, verb or status code in a step line, and the JSON one parsing to a single AC-keyed block.

One correction to the plan for this work: the rubric's block structure is **A 4 / B 6 / C 7 / D 5 /
E 5 = 27**, not the 26 the body of this review records. Item 17 is the §10.9 item added when B2 was
fixed, and it is in block C.

---

## Addendum, 2026-08-10 — the from-scratch rerun, measured

The loop was only ever built forward: an empty directory became the framework, then the twenty
tests. Nobody had since reset it and walked the same road again. Every individual piece had run; the
sequence **starting from a reset** had not, and no amount of reading settles that — the question is
whether reset, start and first turn link up at all.

One iteration answers it, and one iteration is cheap. Run from `46dba15`, with the gitignored state
(journal, step inventory, 120 verdicts) copied aside first, because `git reset --hard` cannot bring
those back.

| link | result |
|---|---|
| `npm run reset -- --yes` | 125 items removed; `.gitkeep` survived; it warned the tree was now dirty |
| start | 14 `todo`, target S1, no exemplar, `start: ready` |
| agent turn | 5 files, 95 lines, from an empty directory (`d5324d5`) |
| gates | `dotnet build` green, `check-scaffold --through-row S1` green, SUT reset ok, `dotnet test` correctly reported zero tests |
| judge | `PASS` |
| bookkeeping | tracker 0 → 1 `done`, journal written, verdict written |

No manual intervention anywhere along it. The agent, handed a prompt with nothing on disk, produced
`ApiTests.sln`, `Directory.Build.props`, `reqnroll.json`, the csproj with FluentAssertions pinned to
`[7.2.2]`, and `appsettings.json`.

Two things worth separating. The reset **warned about the consequence it creates** — the trackers are
committed files, so resetting them dirties the tree and the runner refuses to start on a dirty tree.
Without that line the operator meets a refusal pointing at a file the reset itself wrote. And the
partial mode is a different question entirely: `--stage tests` is refused, and that refusal is what
the same commit adds. The full reset works; the partial one never could.

Restored afterwards to `46dba15` with the state put back: journal at the same md5, 120 verdicts, 42
framework files, 14/14 and 20/20 `done`, 23 tests against the live PetClinic green, 430 harness tests
green, tree clean.

**What this does not establish:** that all 34 iterations run to completion unattended. That is still
taken on trust — but the trust now rests on two things rather than one: every iteration has run once
already, *and* the road from a reset to the first turn has been walked.
