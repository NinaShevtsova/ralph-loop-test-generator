# One turn of the blind loop — stage 0 (scaffold)

You are building a C# BDD API test framework from scratch. This is **one turn**: you do not
remember previous iterations and you will not remember this one. Everything that must survive the
turn lives **on disk** — git, `loop/trackers/scaffold.md`, `loop/JOURNAL.md`. Read it, and take
**exactly one step forward**.

The "Target of this run" section at the bottom was appended by the runner. It is the only part that
changes between turns. If your target is in state `rework`, that section also carries the **judge's
findings** from the previous round — fix all of them and start nothing else.

## Read first, in this order

0. **State left by the previous iteration.** A SessionStart hook has already poured it into your
   context: first the facts it measured itself, then the journal of previous turns. Nothing there
   means you are the first iteration.
1. **`docs/specs/2026-08-05-bdd-api-tests-ralph-loop-design.md` §4** — the authoritative statement of
   what every file is responsible for. This is your specification.
2. **`loop/trackers/scaffold.md`** — the task details section for your target wave: the exact file
   list and the DoD.
3. **`docs/specs/petclinic/context-and-conventions.md`** — §7 for the route table, §10 for the rules
   the framework must make unbreakable, §11 for behaviour that is not in the contract.
4. **`docs/specs/petclinic/contracts/openapi.yaml`** — you **may** read this. Stage 0 is the stage
   that encodes the contract; stage 1 is forbidden from reading it.
5. The target of this run (section at the bottom) and everything it references.

## Protocol of the turn

Take the wave named in the target section. Build **every task in that wave** — that is one
iteration's worth of work (design D-07).

1. Write the files listed in the task details for each task in the wave.
2. Run the gate yourself, in this order:
   - `node scripts/check-scaffold.mjs --through-wave <your wave number> --quiet` — are the files of
     your wave and every earlier wave present and non-trivial. **Pass your wave.** Without the flag the
     check covers all eight waves and is red until the last one, and the runner reads a red gate as a
     reason to stop;
   - `dotnet build framework/ApiTests.sln` — warnings are errors;
   - `npm run sut -- reset` then `dotnet test framework/ApiTests.sln` — the smoke suite.
   Before wave 8 exists there are no smoke tests yet, so `dotnet test` reporting zero tests is a
   pass, not a failure. What must be green is your wave's manifest check and `dotnet build`. The
   runner runs the same wave-scoped gate after your turn, so a red one costs an iteration.
3. On green, commit **once for the wave**, with a trailer naming the tasks:

   ```
   feat(framework): <what this wave built>

   Scaffold-Tasks: S2, S3
   ```

4. Set each task of the wave to `review` in `loop/trackers/scaffold.md`.

   **Write the bare word into the Status cell.** No backticks, no bold, no tick mark, no trailing
   note — `| S2 | wave-2 | … | review |`, exactly that. A status cell holding `` `review` `` or
   `**review**` makes the whole row invisible to the tracker parser, and the loop would then believe
   that task does not exist. The runner validates the file after your turn and stops if it cannot
   read a row, so this costs you an iteration rather than passing silently.
5. Append to `loop/JOURNAL.md` (see below).

## Statuses you may write

`review` — you finished and your gate was green. This is the normal end of a turn.

`blocked` — you hit a question you have no right to answer alone. Write the question into the
tracker's Open questions section, one sentence, pointing at where the answer is missing. End the
turn without committing.

**You may never write `done`.** `done` is written by the runner, on a `PASS` verdict from an
independent judge. That is deliberate: it is what keeps the loop's progress metric from being your
own opinion of yourself.

## Forbidden

- Building files that belong to a **later** wave. One wave per turn.
- Committing with a red gate — that includes your wave's manifest check, not only `dotnet build`.
- `git push`. The ceiling of this loop is a commit on a local branch.
- `git checkout`, `git switch`, any branch change. You are already on the right branch.
- Editing anything under `docs/specs/petclinic/`. It is read-only input.
- Editing `loop/rubrics/`, `loop/trackers/tests.md`, or any script under `scripts/`.
- Inventing a decision the design does not contain. If you do not know, do not guess — see below.
- Adding a NuGet package the design does not list.
- Guessing the FluentAssertions patch version. Resolve it from NuGet; it must be an exact version
  inside `7.x` in the bracket form `Version="[7.a.b]"`.

## If you are blocked

The design does not answer a question your wave depends on:

1. set the task to `blocked` in `loop/trackers/scaffold.md`;
2. write the **question** in the Open questions section — one sentence, with a pointer to where the
   answer is missing;
3. end the turn **without** a commit.

Do not guess. The runner stops as soon as the first unfinished row is `blocked`, prints your question
and exits — a human answers next, which is faster than unwinding a guess.

## Last step of the turn — record what happened

The next iteration will not remember this turn. It will read `loop/JOURNAL.md` and hear nothing else
from you. **Append** to the end of the file (never rewrite it):

```markdown
### Iteration <N> — wave <W> (<task ids>)
**Did:** one sentence about what is now green.
**Tripped on:** what broke and why. Empty only if genuinely nothing.
**For the next turn:** the warning you would want to read yourself.
```

The iteration number is in the target section below. Keep it short: this file is poured into the
context of **every** following iteration.

Write it even when the turn made **no progress**. Especially then: an iteration that silently did
nothing forces the next one to repeat the same mistake.

The journal is your **self-report**, and that is its weakness. Alongside it the hook shows facts
measured from git and the tracker. If they disagree, **trust the facts** and write about the
discrepancy.

The file is in `.gitignore`, so it never lands in a commit. No gate checks it — write freely.
