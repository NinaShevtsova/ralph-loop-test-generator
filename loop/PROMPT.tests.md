# One turn of the blind loop — stage 1 (test generation)

You are writing **exactly one** BDD scenario for **exactly one** acceptance criterion. This is
**one turn**: you do not remember previous iterations and you will not remember this one. Everything
that must survive the turn lives **on disk** — git, `loop/trackers/tests.md`, `loop/STEPS.md`,
`loop/JOURNAL.md`. Read it, and take exactly one step forward.

The "Target of this run" section at the bottom was appended by the runner. It is the only part that
changes between turns. If your target is in state `rework`, that section also carries the judge's
findings from the previous round — those are the work of this turn.

## Read first, in this order

0. **State left by the previous iteration.** A SessionStart hook has already poured it into your
   context: first the facts it measured itself, then the journal. Nothing there means you are first.
1. **`loop/STEPS.md`** — every step definition that already exists, with its use count. **Mandatory
   reading before writing any step.** A sentence that is already there must be reused, not reworded:
   a near-duplicate fails the gate before the judge ever sees your work.
2. **The flow document named in the target section** — `docs/specs/petclinic/flows/F-0X-*.md`. Read
   the common precondition, the test-data tables, the "API behavior used in this flow" table, and
   your target AC in full.
3. **`docs/specs/petclinic/context-and-conventions.md`** — §10 for the mandatory rules and §11 for
   behaviour that is not in the contract.
4. **The existing step definitions** under `framework/src/PetClinic.ApiTests/StepDefinitions/` — the
   22 request steps stage 0 built. You call these; you do not rewrite them.
5. From the second scenario onward: **the already-accepted scenarios**. Match their shape.

### Do not read the contract

**`docs/specs/petclinic/contracts/openapi.yaml` is off limits in this stage.** It is 53 KB, and you
do not need any of it: the contract is already encoded in the services and the 22 request steps, and
the exact response codes for your flow are in that flow's "API behavior used in this flow" table.
Reading it costs about 13 000 tokens per turn and buys nothing.

## What one turn produces

Three things, and nothing else:

1. **One `Scenario`** appended to the flow's feature file. Tagged `@AC-Fxx-yy` and `@US-nn`. Its
   title must be **verbatim** the name from that flow's "Test plan" table, prefixed with the AC id —
   the gate compares them.
2. **The assertion steps it needs** — normally 2–3 new `Then` steps. Request steps already exist:
   find them in `loop/STEPS.md` and reuse them.
3. **One JSON block** in the flow's data file, keyed by the AC id, holding the scenario's input data.
   **Create that file if it does not exist yet.** Stage 0 builds only the smoke data file, so the first
   scenario of each flow creates `Data/<flow-slug>.json` itself. It is inside the fence, so this is
   your work and not grounds for `blocked`.

## Writing the scenario

Map the AC one to one. The ACs are already written in Given/When/Then, so this is transcription, not
invention:

- the AC's **Given** becomes `Given` steps;
- each AC step is one `When` (exactly one request) followed by its `Then`.

Keep the feature file in domain language: **no paths, no HTTP verbs, no status codes, no literal test
data**. Response codes are asserted inside the request steps via `EnsureStatus` — §3 of the spec says
a code is an auxiliary condition and never the only assertion of an AC.

```gherkin
  @AC-F02-01 @US-02
  Scenario: AC-F02-01 an added pet is visible in the owner details and in its own details with the same data
    Given an owner is registered
    When the pet types directory is requested
    Then the directory returns at least one pet type
    When a pet is added to the owner
    Then the created pet has an assigned id, the submitted values and a link to the owner
```

**No `Scenario Outline` and no `Examples`.** §10.8 forbids parameterising one test with several
cases: a skipped case would be invisible in the trace. One AC is one plain `Scenario`.

Data goes in JSON, keyed by your AC id, holding **base** values only — `UniqueData` adds the unique
suffix at runtime. Never put expected values, status codes or paths in JSON.

```json
{
  "AC-F02-01": {
    "owner": { "firstName": "Anna", "lastName": "Petliura",
               "address": "12 Shevchenka Street", "city": "Lviv", "telephone": "0501234567" },
    "pet":   { "name": "Pet", "birthDate": "2020-05-14" }
  }
}
```

## Protocol of the turn

1. Write the scenario, the new assertion steps, and the JSON block.
2. Run the gate yourself, in this order:
   - `npm run sut -- reset` — restart PetClinic and wait for it. Do this **first**. The runner's own
     gate does, because §10.3 requires a clean start and only then does a red test mean "the test is
     bad" rather than "the previous turn left rubbish in the database". Skip it and you will see reds
     the runner does not, on count assertions the spec tells you not to weaken;
   - `dotnet build framework/ApiTests.sln`
   - `dotnet test framework/ApiTests.sln --filter "TestCategory=AC-Fxx-yy"` — your scenario alone,
     to see it green in isolation;
   - `dotnet test framework/ApiTests.sln` — **the whole suite, every scenario**. This is the step
     that catches a change to a shared step which broke an already-accepted scenario;
   - `node scripts/check-tests.mjs --ac AC-Fxx-yy` — **before the commit, not after.** Its fence
     reads the union of your working tree and everything committed since `--base`, and `--base`
     defaults to `HEAD`. Uncommitted, that union is exactly the files you touched. Run the same
     command *after* committing and it answers `the turn changed nothing since HEAD`, because your
     work is then behind `HEAD` and the working tree is clean — that is not a verdict on your
     scenario. The runner asks the same question from the other side, with
     `--base <the commit your turn started from>`.
3. On green, commit **once**, with the AC trailer:

   ```
   test(F-02): AC-F02-01 an added pet is visible in both details

   AC: AC-F02-01
   ```

4. Set your row to `review` in `loop/trackers/tests.md`.

   **Write the bare word into the Status cell.** No backticks, no bold, no tick mark, no trailing
   note — `| AC-F02-01 | F-02 | … | review |`, exactly that. A status cell holding `` `review` `` or
   `**review**` makes the whole row invisible to the tracker parser, and the loop would then believe
   your acceptance criterion does not exist. The runner validates the file after your turn and stops
   if it cannot read a row, so this costs you an iteration rather than passing silently.
5. Append to `loop/JOURNAL.md` (see below).

## The fence

A stage-1 turn may create or modify files **only** under:

- `framework/src/PetClinic.ApiTests/Features/`
- `framework/src/PetClinic.ApiTests/StepDefinitions/`
- `framework/src/PetClinic.ApiTests/Data/`

Everything else in the framework — `Config/`, `Http/`, `Models/`, `Services/`, `Support/`,
`TestData/`, `Hooks/`, `Tests/Smoke/`, the csproj — belongs to stage 0 and the gate will fail on it.

If your AC genuinely needs a framework change — a service method stage 0 missed — **do not make it**.
Set the row to `blocked`, write the question, end the turn. That escalation is the correct move, not
a failure.

## Statuses you may write

`review` — you finished and your gate was green. The normal end of a turn.

`blocked` — you hit a question you have no right to answer: an ambiguous AC, or a missing framework
capability. Write the question in the tracker's Open questions section and end the turn without
committing.

**You may never write `done`.** `done` is written by the runner on a `PASS` verdict from an
independent judge. This is what keeps the progress metric out of your hands.

## Forbidden

- More than one scenario per turn. The gate counts them.
- Weakening an assertion so a scenario turns green. If a scenario will not pass and you believe the
  code is right, escalate — the acceptance criterion may be wrong. Never make the check softer.
- Changing an existing step definition in a way that alters what already-accepted scenarios assert.
- Rewording an existing step instead of reusing it.
- `Thread.Sleep`, `Task.Delay`, a retry wrapper, or a hand-rolled polling loop. The only legitimate
  wait is `ReadinessProbe` at start-up.
- `[Ignore]`, `Assert.Ignore`, `Assert.Pass`.
- Literal record ids — `/owners/1`, `GetById(3)`. Every id comes from an API response (§10.1).
- Absolute count assertions. "grew by one", never "the list has 13" (§10.4).
- Committing with a red gate.
- `git push`; `git checkout` / `git switch`; editing `docs/specs/petclinic/`, `loop/rubrics/` or
  `scripts/`.

## Last step of the turn — record what happened

The next iteration will not remember this turn. **Append** to `loop/JOURNAL.md` (never rewrite it):

```markdown
### Iteration <N> — <AC id>
**Did:** one sentence about what is now green.
**Tripped on:** what broke and why. Empty only if genuinely nothing.
**Steps added:** the new step sentences, verbatim — so the next turn can reuse them.
**For the next turn:** the warning you would want to read yourself.
```

Write it even when the turn made **no progress**. Especially then.

The journal is your **self-report**, and that is its weakness. The hook shows facts measured from git
and the tracker alongside it. If they disagree, **trust the facts** and write about the discrepancy.

The file is in `.gitignore`. No gate checks it — write freely.
