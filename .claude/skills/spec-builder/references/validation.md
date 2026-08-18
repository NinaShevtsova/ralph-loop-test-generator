# Validation — deterministic first, judgement last

Two layers, and the boundary between them is what this phase is about. Layer 1 is a script: it passes or
it does not, and no reading of yours changes its answer. Layer 2 is judgement, and nothing but reading
produces it.

**Run them in that order and never the other way.** A semantic review of a package that fails a
structural check reviews text the loop cannot parse. The criterion you spent ten minutes weighing may
carry an id one character off its shape, in which case it is not a criterion at all: nothing demands a
test of it, nothing routes it to a flow, its parts are never read, and it looks exactly like one that
will become a test. Judgement spent on unparsable text is spent twice, because the structural fix moves
the text and the judgement has to be made again.

Every rule below carries what breaks when it is skipped. A rule without a consequence is advice, and
advice is the first thing dropped by a model that is nearly finished.

**About the examples below.** They come from two unrelated domains on purpose — a ferry sailing service
in one place, a fire-safety inspection service in another — and they deliberately do not add up to one
package. What travels between projects is the procedure: the order of the two layers, the questions of
the second one, and the shape of a coverage matrix. The entities do not travel, and nothing in this file
knows what an entity in your project is called.

**The checks are owned elsewhere and are not restated here.** `references/spec-layout.md` documents every
check by name, and `--list-checks` prints the gate's own inventory of them; `self-check.test.mjs`, which
ships in this Skill's folder, holds the two together, so that document cannot fall behind the gate. This file does not list the checks, and neither should
anything you write: a second statement of one check drifts from the first, and the copy that no test
compares against the gate is the one that goes stale while still being read as current. When a failure
names a check you do not recognise, look the name up in `spec-layout.md` rather than inferring what it
meant from the message.

## Layer 1 — run the gate, and read what it actually said

The gate travels with this Skill. Run it from wherever the folder was copied to, against the package you
just wrote:

    node <path-to-this-skill>/check-spec.mjs --spec <spec-dir>

`--quiet` prints only the failures, the warnings and the summary. `--list-checks` prints the inventory of
rules. In `extend` mode there is a third argument and two further checks; `references/mode-extend.md` owns
all three.

**Three exit codes, and one of them is a trap:**

- **0** — every check passed. Warnings may still have been printed, and they are yours to rule on.
- **1** — at least one check failed. The package is not ready to hand to the loop.
- **2** — the gate was invoked wrongly and **checked nothing**. It is not a pass, and it is not a
  failure of the package either.

**Never read exit 2 as a pass.** It is what the gate returns when `--spec` is missing, when the path is
not a directory, or when a flag was given without a value — which in practice means a mistyped path or a
relative path resolved from a directory you were not in. The output says so plainly, but nothing else
does: to anyone reading exit codes alone, a package that was never checked reports the same way as one
that passed every check. Read the summary line and not only the code — a run that checked anything ends by
naming how many checks it ran, and an exit 2 prints no such line at all.

### A failure is about the interface, not about tidiness

Every layer-1 check is about a shape a machine parses. Fix each failure by fixing the package, never by
rewording the report or by moving the construct somewhere the gate does not look. A criterion the gate
cannot read is a criterion the loop cannot generate a test from, so a failure left in place does not
degrade the package — it removes the part it names from the package entirely, silently, while the text is
still visible to a human reviewing it. That is the exact failure mode the gate exists to refuse.

### A warning goes to a human, and your ruling is written down

Warnings are printed and never fail the gate, because each one is a real smell that cannot be decided
mechanically. **Rule explicitly on every warning**, and put the ruling where the next reader will find
it: in the report for this run, and — where you are keeping the construct that was warned about — in the
package beside the construct itself.

A warned-about construct that is right is right for a reason, and the reason belongs in the text. In a
fire-safety inspection service, a criterion confirming that one submitted defect reaches both the
premises record and the inspector's own queue may legitimately name two reads under a shared `Then`,
which trips the one-request-per-`When` warning. Written as `**Step 4 — confirm both queues, deliberately
in one step: the point of the criterion is that the two agree**`, the warning is answered in the place
the generating agent and the judge both read. Left unanswered, it is indistinguishable from a warning
nobody read, and the next run either "fixes" it into two steps that no longer assert the agreement, or
copies the construct into criteria where it is genuinely a defect — because the package appears to permit
it generally.

### A green gate is not a good package

Layer 1 measures shape. It cannot tell a criterion that asserts something from one that asserts nothing,
a chain from two unrelated requests, or a measured fact from an invented one. Everything that decides
whether the package is worth generating from is in layer 2, and a run that stops at a green gate has
verified that the loop can read the package and nothing about whether it should.

## Layer 2 — the five questions no gate can answer

Answer all five **by reading**, and write the answers into the report. Each is a question with a
procedure, not an impression: the answer comes out of a list you can actually write down — of requests, of
claims, of asserted fields — and an answer that rests on how the package feels is not an answer to these
questions.

**1 — Is every criterion genuinely an integration criterion: a chain, plus a different representation?**
List the criterion's requests in order and mark, for each, which earlier response its input came from. A
request whose inputs are all constants starts a new chain rather than continuing one. Then find the one
assertion made on data read through a route that did **not** write it. If no such assertion exists, this
is a contract test that satisfied the gate by having two steps, and it will consume an agent turn and a
judge turn to prove that the API echoed its own writes. `references/ac-rules.md` owns the filter; this is
where you check that it was actually applied.

**2 — Is every `Then` claim tied to a named field?** Read each `Then` and count its claims. Every claim
either names a field, names a collection and says exact or relative, or asserts an absence explicitly.
The words that fail this question are the ones that read fluently: `correctly`, `as expected`, `matches
the request`, `is updated`. A claim with no field named is answered by the generating agent choosing the
fields, and the judge then grades the test against the fields *it* would have chosen — so the rejection
names the test, the rework rewrites the test, and the criterion that caused it is never touched.

**3 — Is any behavior asserted that is `derived` rather than `measured`?** For every assertion about an
error path, a cascade or a side effect, name the request that established it. "It follows from the
schema" and "the parent is gone, so the child must be" are derivations, and a derivation in those three
places is a guess wearing a provenance label — they are precisely where an API departs from what seems
logical. An assertion that cannot name its measurement is removed from the criterion and becomes an entry
in `UNRESOLVED.md`; `references/unresolved.md` owns the format and the reason.

**4 — Are any two criteria duplicates by chain and asserted field set?** Build a two-part key for each
criterion: the ordered list of its requests as method plus path *shape*, and the set of field names its
`Then`s assert on. Compare keys, never titles and never motivations. Two criteria in a ferry sailing
service, one titled for the passenger who books a crossing and one for the operator who reconciles the
manifest, can carry the same key — the same three requests and the same four asserted fields — and they
are one criterion with two motivations. Both stated separately, the loop generates two tests, and the
second one's verdict is then read as information about coverage that it does not carry.

**5 — Is the decomposition honest: one precondition per flow?** For each flow, read its precondition and
ask two questions of every criterion in it. Does this criterion need everything the precondition builds?
Does it need something the precondition does not build? A precondition that is the union of several
setups makes every scenario in the flow create data it never touches, and its exception list becomes the
real specification — at which point the flow boundary has stopped meaning anything and the shared setup
it was drawn around has to be rediscovered per criterion. `references/flow-decomposition.md` owns the
boundary rule; this question is whether the flows you wrote obey it.

Where the answer to any of the five is no, **the fix is in the package.** Amending the report to explain
why a criterion is acceptable as written is the one response that leaves the defect in the artefact the
loop reads and the correction in an artefact it never opens.

## Completeness is reported, never enforced

Coverage is a decision for a human, and it is the one part of this phase you report rather than settle.
Print an operation coverage matrix: every operation the contract declares, and against each one either
the criteria that touch it, or that nothing does, or that it is out of scope with the reason. For a ferry
sailing service the matrix reads:

```markdown
| Operation | Covered by | Note |
|---|---|---|
| `POST /sailings` | AC-F01-01, AC-F01-03 | |
| `GET /sailings/{sailingId}` | AC-F01-01, AC-F01-02, AC-F02-01 | |
| `POST /sailings/{sailingId}/reservations` | AC-F02-01, AC-F02-02 | |
| `DELETE /reservations/{reservationId}` | — | **not covered** — no measurement of what it does to the berth allocation |
| `GET /vessels` | every precondition; no criterion's `Then` | read-only directory — the package states that nothing asserts on it, and why |
| `POST /crew-rosters` | — | **out of scope** — a separate service's perimeter, per the package's scope section |
```

Then **ask a human to confirm each uncovered operation is a decision.** That is a request for a ruling
per row, not for approval of the package: the answer for one row may be "correct, nobody uses it", for
the next "that is the whole reason this work was commissioned". The reference package this Skill's rules
were measured against makes completeness an explicit non-goal in as many words — a missing criterion for
some endpoint or case is a decision rather than a gap — and the matrix is what turns that from an excuse
into something a person can check.

**Do not pad coverage.** Criteria written to fill rows in this matrix are criteria nobody asked for, and
they are almost always contract tests, because the chains worth writing were already taken and a
single-request check is what remains. Each one costs an agent turn, a judge turn and a place in the
suite, and each one makes the criteria that matter harder to find in a document a reviewer reads
top to bottom. A row saying `not covered` with a reason is worth more than a criterion covering it
badly, because the row can be ruled on in a sentence and the criterion cannot be removed once a test
passes against it.

**Read the columns as well as the rows**, because the matrix catches the opposite defect too. An operation
whose covering criteria all carry the same chain is one criterion written several times under different
titles, and question 4 above is what settles which of them survives. A setup request appearing against
almost every criterion is *not* that defect — it is what a shared precondition looks like — so say so in
the note, or the next reader spends the afternoon establishing it.

## Where these rules come from

Each rule traces to the design this Skill implements, the loop it feeds — the judge rubric that grades
every generated test and the runner that acts on its verdicts — or the one reference package these rules
were measured against. A rule whose origin cannot be named is an opinion, and an opinion in a file a
model reads as instruction is worse than silence.

| Rule | Origin |
|---|---|
| Two layers, deterministic before semantic | Design section 13, which splits validation exactly here: what a script settles, and what only reading settles. |
| Do not restate the checks | Design section 13 and the parity test that ties `--list-checks` to `references/spec-layout.md`. The rule was measured rather than reasoned: `spec-layout.md` is pinned to the gate by a test, and a second prose copy of a check would be pinned to nothing. |
| Exit 2 is never a pass | The gate's own invocation handling — a missing `--spec`, a path that is not a directory, or a flag without a value ends the run before a single check executes. `spec-layout.md` records the three codes; this file says what to do with the third. |
| A failure removes the part it names from the package | The gate's `AC ids are well formed` check exists because a heading one character off its shape was invisible to everything at once: no Test plan row was demanded of it, its five parts were never read, the numbering did not notice the hole, and its text folded into the criterion above. It never became a test, and nothing said so. |
| Rule on every warning, in the package as well as the report | `spec-layout.md`'s warnings section: each warning is a smell that cannot be decided mechanically. The one-request-per-`When` warning is the measured case — the reference package breaks that norm once, for two symmetric confirmations under a shared `Then`, and the scenario generated from it was accepted by the judge, which is why the gate warns instead of failing. |
| The five layer-2 questions | Design section 13's layer-2 list, unchanged in substance. Each is graded downstream by the judge rubric: chain and cross-representation by the package's own selection filter, a claim per named field by rubric item 2, duplicates by item 16 (a scenario verifies exactly its own criterion), and one shared precondition per flow by item 27, which measures the cost — ten scenarios of one flow share a precondition, and ten copies of it drift. |
| Assertions must name the measurement behind an error path, a cascade or a side effect | The reference package needed a whole numbered section of behavior established by request, because none of it followed from the contract: validation stricter than the schema, a submitted read-only field answered with a `500`, and three cascades that each behaved differently. `references/openapi-analysis.md` owns the list of what a contract never settles. |
| Duplicates are decided by chain and field set, not by title | Design section 8F, carried into `references/ac-rules.md`: differing motivation does not make two criteria different. |
| Completeness is reported, never enforced | The reference package's non-goals section, which states that a missing criterion for an endpoint or case is a decision and not a gap, and that the package does not need extending for completeness. Design section 13 turns that into the matrix and the human ruling. |
| Out-of-scope operations are named, not silently absent | The reference package names the endpoints outside its perimeter explicitly; `references/openapi-analysis.md` owns the rule that a contract routinely holds more than the package covers. |
| Padded coverage is contract tests | The reference's non-goals exclude single-endpoint checks and schema validation by name, and `references/ac-rules.md` requires the package to record why — without that sentence, the next run asked to raise coverage adds exactly those. |
| The matrix goes into the report, with the questions | `SKILL.md`'s phase 7, which reports what was built, the coverage matrix, the behavior that became a question, and the harness edits still required. |
