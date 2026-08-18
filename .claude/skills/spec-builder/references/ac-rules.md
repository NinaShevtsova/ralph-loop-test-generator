# Acceptance criteria — the rules that decide what the package is worth

Everything before this phase is analysis and everything after it is packaging. The criteria are the only
part a generating agent turns into tests, and they are the part a judge grades those tests against.

Write each criterion for the agent that will transcribe it. That agent reads one flow document, is
**forbidden** to open the contract, does not remember the previous scenario, and produces one test per
criterion. A criterion shaped as described below is transcribed mechanically. A criterion that leaves a
choice open is answered by invention, and the judge then rejects work that was never given the material
to succeed. Every rule here therefore comes with what breaks when it is ignored, because a rule without a
consequence is advice and advice is the first thing dropped under pressure.

Where a rule cannot be satisfied because the behavior is unknown, **the criterion is not written.** The
question goes to `UNRESOLVED.md` with what the contract says, what the documentation says, which
criterion it blocks and the requests that would settle it. A question costs one conversation; a guess
costs a test that is red for a specification reason, and rework cannot fix a specification.

**About the examples below.** They come from two unrelated domains on purpose — a training-catalogue
service in one place, a warehouse stock service in another — and they deliberately do not add up to one
package. What carries from project to project is the *shape*: the chain, the five parts, the granularity
of a claim, the absence assertion. The entities do not. If every example came from one domain you would
be reading a template, and its entities would quietly become the ones you reached for. Nothing in this
file knows what an entity in your project is called.

**Formats are owned elsewhere.** `references/spec-layout.md` holds the exact markers of a criterion's
parts, the id shape, the anchor form, the Test plan row and the behavior table — everything a machine
parses. This file says what to write *inside* those shapes. Read that file for the shapes themselves and
do not reconstruct them from the examples here, because two statements of one format drift.

## The selection filter: two tests, and a candidate passes both

A candidate becomes a criterion only if **both** hold:

1. **Chain** — at least two requests, where the result of one is the input of the next.
2. **Different representation** — at least one assertion on data read through a **different** route than
   the one that wrote it, or on the presence or absence of a record in a related collection.

**Both, not either.** A chain whose every assertion is on the responses of its own writes proves the API
echoed what you sent it. A single request inspected thoroughly proves the schema. Neither is worth an
iteration of the loop: the interesting failures live in the second representation, where a value was
written through one route and is read back through another that was built separately.

One request plus a status code and a schema check is a **contract test and is not taken.** Write the
reason for excluding contract tests into the package itself, in this project's own terms — what else
already covers schemas here, and what a single-endpoint check would add. Without that sentence, the next
run that is asked to raise coverage pads the package with them, and a padded package hides the criteria
that matter behind ones nobody needed.

**A status code inside a chain is auxiliary and never the only assertion.** A criterion whose every
`Then` names nothing but a code asserts that the endpoint answered, not that it answered correctly; the
gate warns on exactly that, and the test it produces stays green through any change to the data.

## The fixed shape

Every criterion carries these parts, in this order.

- **Title**, in domain language, saying exactly what is verified — not what is done. The title becomes
  the test's name through the flow's Test plan row, and a title naming an action ("update the record")
  gives the reader of a failed run no way to tell what was supposed to hold.
- **`US:`** — the ids of the user stories this serves, ids only, declared once in the conventions file.
  A criterion with no motivation behind it cannot be argued for when someone asks whether to keep it.
- **`Why this matters:`** — whose work breaks if this does not hold. This is the part most often dropped
  and the most expensive to lose: it is what lets a human review the criterion at all, and what lets a
  judge tell a real check from a formality that happens to be green.
- **`Given`** — the initial state and every value the steps use, each named, each **taken from an API
  response** or from the linked test-data table. Never a literal record id: a seeded database answers
  `GET /items/1` with `200` and the test then proves the seed data exists. The gate warns on a literal
  id, the judge rejects it, and the run stays green while measuring nothing.
- **Steps** — pairs of `When` naming **exactly one request**, then `Then` asserting on the result of
  *that* request and naming what is saved for the later steps.

**Why the shape is fixed.** The generation prompt tells the agent that mapping a criterion into a
scenario is transcription and not invention: the `Given` becomes `Given` steps, each step's single
request becomes one `When` followed by its `Then`. That sentence is only true if the criterion is already
shaped this way. Where it is not, the agent invents a structure, and two criteria of the same package
then produce differently shaped tests — after which the judge grades the second against an exemplar it no
longer resembles, and rejects it for a defect the specification introduced.

**One request per `When`.** A `When` carrying two requests has one `Then` between them, so the agent
chooses which response to assert on and the mapping stops being one to one. The exception is a step whose
whole point is two symmetric confirmations under a shared `Then`; keep it only when that is the point,
and say so in the step title. The gate warns rather than fails here, because the exception is real.

**Name what each step saves**, where it is saved: `Save id as sessionId`. Without it a later step has no
way to refer to the record an earlier step created, and the agent invents a lookup — usually by name,
usually over a collection that also holds other tests' records.

## Granularity: one named field is one claim

**One named field or property is one claim, and every claim needs its own assertion.** Count at that
granularity when you write the criterion, because that is the granularity the judge counts at when it
decides whether the test covered it.

A step of a finished criterion reads like this:

> code `200`; the `sessions` array contains exactly one element; it has `id` = `sessionId`, `title` and
> `startsAt` equal to the values submitted in step 2, and `room.id` equal to the room from step 1.

That is **six** claims — the code, the count, `id`, `title`, `startsAt`, `room.id` — and it needs six
assertions.

**Do not collapse two named fields into one claim because the sentence reads naturally that way.** That
collapse is exactly what lets a scenario assert `title`, ignore `startsAt`, and still look complete. The
same defect in its shorter form is a claim with no field list at all — "the entry matches the submitted
data" — which hands the agent the choice of which fields to compare, and it will compare the ones that
are easy.

**Say which collection a count is over, and whether it is exact or relative.** "Contains exactly one
element" over a collection that can also hold seeded or other tests' records is impossible to satisfy on
a second run without a restart; "grew by one" over a collection this test created itself is weaker than
the criterion needs and passes with a wrong record in it. Both readings are correct about different
collections, and nothing but the criterion can say which collection is meant.

## Explicit, derivable, never inferred

| | |
|---|---|
| **Must be explicit in the criterion** | the expected status code of each step · **every** field whose value is asserted, **by name** · which collection a count is over and whether it is exact or relative · where each value came from, by naming the earlier response or the test-data table · any deviation from the flow's common precondition, **with its reason** |
| **The agent may derive** | request body shape and field types · which fields are required · URL templates — all of it from the flow document's test-data tables and behavior table, which is all the agent is allowed to read |
| **Never inferred** | behavior the contract does not state — cascades, side effects, validation stricter than the schema · what happens on an error path · whether an error response carries a body · what an empty collection returns · ordering guarantees |

The bottom row is the one that produces unfixable tests. An inferred cascade that the API answers with a
refusal instead makes the criterion the opposite of the truth, and every iteration spent on it is spent
on a test that cannot pass. Measure it, or write the question.

The middle row is narrower than it looks: the generating agent may not open the contract, so anything it
is expected to derive has to be present in the flow document. If a step needs a status code, a response
shape or a behavior on empty that the behavior table does not carry, the table is incomplete — and that
is a defect of the specification, not of the agent.

## The six categories

| Category | The rule |
|---|---|
| **Positive** | a chain of create → read through another route → modify → re-read. Assertions on values; codes never carry the step alone. |
| **Negative** | the error code is **half** the criterion. The other half is mandatory: an explicit assertion that the side effect did **not** occur. |
| **Edge case** | taken only if the boundary was **measured**. Never use a boundary value where an ordinary one proves the same thing. |
| **State transition** | each transition is its own step, followed by a re-read. The state is confirmed by **reading it back**, never by the transition's own status code. A repeated transition out of a terminal state is its own step too. |
| **Relationship between entities** | delete the parent, then confirm the child is unreachable through **every** route: its own, the nested one, and the collection-wide one. Three reads, because they break independently. The deleted record's **own** route may be asserted from a declared delete plus a declared `404`; a *child* record may not, because that is a cascade and stays unknown until measured. |
| **Consistency across endpoints** | write through route A, read through B and C, assert the values are identical. Where writing is possible through two routes, a separate criterion that both produce equivalent records. |

Every row is a rule rather than a shape to imitate, and each one has a failure behind it. A positive
criterion whose assertions are codes proves the endpoints answered. A transition confirmed by its own code
proves the request was accepted, not that the state changed — and where an update returns an empty body
there is nothing else to go on. A child confirmed unreachable through one route leaves the other two
still handing out a record whose parent is gone. A consistency criterion that reads back through the route
that wrote the data compares the API with itself and passes however far the two representations diverge.

Two of these six need more than a row.

### Negative criteria: the code is half, and the other half is the one that gets skipped

The status code is the easy half. The half that carries the criterion is the explicit assertion that the
state did not change — and it is the half most likely to be skipped, which is why the judge has a
dedicated item for it. Write it into the criterion as its own step, so skipping it is visible.

**Assert the absence through a route that would show the record if it existed.** Re-reading the route
that just returned the error proves nothing: it answers with the same error either way.

```markdown
**Step 1 — submit an adjustment larger than the quantity on hand**
**When** `POST /warehouses/{warehouseId}/adjustments` with `sku`, the unique `reference` from Given and
`delta` = `-(quantityBefore + 1)`
**Then** code `409`; the response body is empty per the flow's behavior table — assert nothing on it.

**Step 2 — confirm the stock did not move**
**When** `GET /items/{sku}/stock`
**Then** code `200`; `quantityOnHand` equals `quantityBefore`; `warehouseId` equals the warehouse from
Given.

**Step 3 — confirm nothing was appended to the ledger**
**When** `GET /warehouses/{warehouseId}/ledger`
**Then** code `200`; no entry has `reference` equal to the unique `reference` from Given.
```

**Where the behavior table says an error carries no body, the `Then` says so and asserts nothing else.**
A field assertion on a bodyless error is either dead code or false coverage, and it reads as thorough.

### Edge cases: only a boundary you measured

A value one step past a limit that was **measured** is a criterion. A value at the exact limit that
nobody probed is a question. And a boundary chosen for its own sake — the extreme end of a permitted
range, a date at the edge of a period — makes the test fail on a timezone difference or a date rollover
rather than on the behavior, which costs an iteration and teaches nothing.

## Non-duplication

**Two criteria are duplicates when the chain, the set of asserted fields, the expected codes and the
polarity of the assertions all coincide.** Codes and polarity are in the key because the trial run found
the shorter version reporting a false duplicate on every positive-and-negative pair over one route: the
same requests in the same order over the same fields, one expecting success and one a rejection, are two
criteria and not one. Differing
motivation does not make them different: a second criterion with the same requests and the same assertions
proves nothing new, consumes an iteration and an exemplar slot, and makes coverage look bigger than it is.
In an `extend` run, check every candidate against **every** existing criterion by that whole key,
never by title similarity — the titles are written in domain language and two of them can differ
completely while the tests underneath are the same.

The mirror image is just as damaging: **a criterion verifies exactly its own claim and picks up no checks
belonging to another.** Extra coverage folded into a neighbour sounds generous and makes a genuinely
skipped criterion invisible in the trace, because one criterion is one test and the trace has nothing
else to go on.

## A criterion that is ready to hand over

```markdown
### AC-F02-04 — a session added to a course appears in the course schedule and in the session's own
                details with the same data

**US:** US-02, US-05
**Why this matters:** the scheduler adds a session from the course page, while the trainer opens the
session's own page on the day it runs. Both must show one record with the same room and the same start
time. Two independent copies mean one of them is wrong and nobody can tell which.

**Given** a course is created (`courseId` from the creation response) and session data is prepared per
the [«Test data — session»](#test-data--session) table

**Step 1 — take a room from the directory**
**When** `GET /rooms`
**Then** code `200`; the array is not empty. Take the first element as a whole as the `room` object, per
the common precondition, and remember its `id` and `name`.

**Step 2 — add the session to the course**
**When** `POST /courses/{courseId}/sessions` with `title`, `startsAt`, `capacity` and `room` from step 1
**Then** code `201`; the body carries an assigned `id`; `title`, `startsAt` and `capacity` equal the
submitted values; `room.id` equals the room from step 1; `courseId` equals the course from Given. Save
`id` as `sessionId`.

**Step 3 — open the course schedule**
**When** `GET /courses/{courseId}`
**Then** code `200`; the `sessions` array contains exactly one element — this course was created by this
test and holds nothing else; it has `id` = `sessionId`, `title` and `startsAt` equal to the values
submitted in step 2, and `room.id` equal to the room from step 1.

**Step 4 — open the session's own details**
**When** `GET /sessions/{sessionId}`
**Then** code `200`; `title`, `startsAt` and `capacity` match the response of step 2 field for field;
`room.id` equals the room from step 1 and `room.name` equals that room's name from step 1, not any
submitted name — the service resolves the room by `id` and ignores a submitted name (`measured`);
`courseId` equals the course from Given.
```

Why it holds up: four requests, each using the previous one's output; two of the three reads go through
routes that did not write the data; every asserted field is named; every expected value traces back to an
earlier response or to the linked table; the exact count is over a collection this test created itself;
a code appears in every `Then` and is the only assertion in none; one request per `When`; what is saved is
named where it is saved; and the one assertion that would otherwise look arbitrary carries the provenance
that explains it.

## Candidates that are not criteria yet

| Candidate | Defect |
|---|---|
| `POST /adjustments returns 201 and a body with an id` | Contract test: one request, assertion on the schema. |
| `the stock level is updated correctly` | Ambiguous: "correctly" leaves the agent to invent the assertion. |
| `after the adjustment the ledger is not empty` | Cannot fail: passes on any entry, including a seeded one. |
| `a refused adjustment returns 409` | Half a negative criterion: nothing asserts the stock did not move. |
| `deleting a warehouse removes its stock records` | Inferred, not measured: it belongs in `UNRESOLVED.md`. |
| `the ledger returns the newest entry first` | Ordering guarantee: a question until it is measured. |
| `the ledger entry matches the submitted adjustment` | Field list implied: the agent picks what to compare. |
| `the ledger holds 14 entries after the adjustment` | Absolute count over a shared collection: breaks on the second run. |
| `GET /items/1/stock returns the stock` | Literal id: green about the seed data. |
| `an adjustment reaches the ledger and the item total is recalculated and the audit trail records the operator` | Three criteria in one: a skipped third is invisible in the trace. |

## Where these rules come from

None of this was reasoned out. Each rule traces to one of three measured sources: the **judge rubric** of
the loop this Skill feeds, whose items are numbered and graded against every generated test; the
**generation prompt** of that loop, which is what a criterion is transcribed by; and the **one reference
package** these rules were measured against, whose numbered conventions the rubric itself cites. A rule
whose origin cannot be named is an opinion, and an opinion in a file a model reads as instruction is
worse than silence.

| Rule | Origin |
|---|---|
| Chain plus a different representation, both mandatory | The reference package's goals: a criterion closed by a single request is not taken into the package. The gate warns on a criterion with one `When` — the contract-test signature. |
| Contract tests excluded, with the reason recorded in the package | The reference package's non-goals section, which excludes single-endpoint checks and schema validation by name, and calls a missing criterion a decision rather than a gap. |
| A status code is auxiliary and never the only assertion | The reference conventions' §3, quoted by the generation prompt and by judge item 3. The gate's "a Then asserts a data value" warning measures the same thing. |
| The five parts, in order | The gate's "AC carries its five parts" check; `references/spec-layout.md` owns the markers. |
| `Why this matters` is not optional | The rubric's whole question is whether a scenario is green about nothing; without the motivation neither judge nor human can answer it. `spec-layout.md` records it as the part most often dropped. |
| A title in domain language | The reference conventions' glossary section: titles are domain language while every step names its method and path. The Test plan row turns the title into the test's name verbatim. |
| `Given` values come from responses, never literal ids | The reference conventions' §10.1 — the seeded database answers a literal-id read with `200`, so the test proves the seed data. Judge item 11, the generation prompt's forbidden list and the gate's "no literal record ids" warning all repeat it. |
| Transcription, not invention — hence the fixed shape | The generation prompt's own sentence about mapping a criterion one to one, and the exemplar rule that grades every later scenario against the first accepted one. |
| One request per `When`, with a stated exception | The generation prompt requires one request per `When`; the reference itself breaks it once, for two symmetric confirmations under a shared `Then`, and that scenario was accepted — which is why the gate warns instead of failing. |
| Name what each step saves | Judge item 7: where a criterion says a body matches an earlier response, the comparison must be against the **saved** response and not a constant re-declared in the test. |
| One named field is one claim | Judge item 2, including its worked example of a single step holding six claims, and its instruction not to collapse two fields written in one breath. |
| Name the collection a count is over, and say exact or relative | Judge item 12 and the reconciliation it carries with items 2 and 6: a relative count over a shared collection and an exact count over a collection the test created are both mandatory, about different collections. The reference conventions' §10.4 is the underlying rule. |
| Explicit: the expected code of every step | The generation prompt forbids the agent from opening the contract, so the flow document is the only place a code can come from. |
| Never inferred: cascades, side effects, stricter validation, error paths, ordering | The reference package needed a whole numbered section of behavior verified by request, because none of it followed from the contract: a field rule stricter than the schema's, a submitted read-only field answered with `500`, and three different cascades that each behave differently. |
| Negative criteria carry the absence assertion | Judge item 26, which names the error code as the easy half and the assertion that the record was not created as the point of the criterion and the half most likely to be skipped. |
| Assert nothing on a bodyless error | Judge item 9 and the reference conventions' response-code table: those responses carry no body, so a field assertion there is dead code or false coverage. |
| Edge cases only where the boundary was measured, and no gratuitous boundaries | Judge item 20: a boundary value fails on a timezone or a date rollover rather than on the behavior. The reference measured its own boundaries before writing them into criteria. |
| A state transition is confirmed by reading, not by its own code | The reference conventions' response-code table: the update operations return an empty body, so the result of a change is only observable through a following read. |
| A deleted child is confirmed unreachable through all three routes | The reference's relationship criteria read the record's own route, the nested route and the collection-wide list separately, because the three were measured to break independently. |
| Consistency across endpoints as its own category | The reference's user story on consistency across access routes, plus its route-asymmetry table, where one record is written through a single route and readable through several built separately. |
| Duplicates are decided by chain and field set | One criterion is one test, and the id is the only link between them — the gate enforces uniqueness and contiguity on that id. A duplicate therefore spends an iteration and doubles a claim while the coverage table looks fuller. |
| A criterion picks up no checks belonging to another | Judge item 16, on §10.8 of the reference conventions: extra coverage makes a genuinely skipped criterion invisible in the trace. |
