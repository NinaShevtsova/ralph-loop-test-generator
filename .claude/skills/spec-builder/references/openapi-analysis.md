# The contract — what to take, what to derive, and what never to believe

You read the contract exhaustively, once, in phase 0. The agent that will write the tests **never opens
it**. The generation prompt of the loop this Skill feeds carries a section headed "Do not read the
contract" that puts the file off limits outright: it is 53 KB, about 13 000 tokens a turn, and everything
that agent needs is already compiled into its flow's behavior table.

So contract analysis is **compilation**, not reference. The whole contract goes in and one small per-flow
table comes out: every request that flow makes, the codes it answers with, the shape it returns, and what
it does when a record is absent or a collection is empty. Whatever you leave out of that table does not
reach the agent at all.

**The rule this whole file serves follows from that: anything a flow's behavior table omits is a defect of
the specification, not of the agent.** A step whose expected code nobody wrote down is a step the agent
must guess at, and it will guess — plausibly, sometimes wrongly — after which the judge rejects a test
that was never given the material to be right. When a generated test expects `200` where the API answers
`404`, look for the missing row before you look at the agent.

**About the examples below.** They come from two unrelated domains on purpose — a parcel-delivery service
in one place, a payroll service in another — and they deliberately do not add up to one package. What
travels between projects is the *shape* of each question: what a contract settles, what it cannot, and
what to do where it is wrong. The entities do not travel. Nothing in this file knows what an entity in
your project is called.

**Formats are owned elsewhere.** `references/spec-layout.md` holds the behavior table's exact two-column
shape, the containment check that reads it, the conventions file the out-of-scope list belongs in, and the
anchor form test-data tables are linked by. Read it for the shapes; this file says what to put in them.

## Group 1 — take directly, and record as `contract`

These are what a contract is *for*. Take them as written and move on.

- **Paths and URL templates**, with each path parameter's name and type. The behavior table declares
  endpoints by shape, so the template is what you record, not one substituted example.
- **Request body schemas** — every field, its type, whether it is required, and every stated `maxLength`,
  `minimum`, `enum` and `pattern`. These become the constraint column of the test-data tables.
- **Declared response codes** per operation, as the *starting point* for the behavior table and no more
  than that — group 3 explains why a declared code is a claim rather than a measurement.
- **Schema names**, so a test-data table can cite the schema its constraints came from. A table with no
  citation cannot be re-checked against a contract that changed, and it will be wrong silently.
- **Read-only and write-only markers**, which tell you where to look for the asymmetry in group 2 — not
  what the service does with a read-only field it was sent, which is group 3.

Skipping this group does not produce a wrong package; it produces an expensive one. A value re-derived by
sending a request costs a probe where reading one line of the contract would have settled it.

## Group 2 — derive from the contract, and still record as `contract`

Three derivations, each cheap and each load-bearing for the flow decomposition.

- **Which operations exist per entity, and therefore the route asymmetry.** Compare the set of operations
  on each entity: created only through a nested route, deleted only through its own, readable through
  three. That asymmetry is the material an integration criterion is made of, and it is invisible until you
  tabulate the operations side by side.
- **Which fields are read-only** — present in a response schema and absent from the request schema for the
  same entity. Send one anyway and you learn something (group 3), but the asymmetry itself is derivable.
- **Which representations nest which others** — where an entity's response schema embeds another entity
  rather than referencing it by id. Every nesting is a candidate second representation: the nested copy
  and the nested entity's own route were built separately and can disagree.

Record all three as `contract`, not as `derived`. They follow from the document by inspection, so they
inherit the document's authority — and they lose it the moment a measurement disagrees, like everything
else in the `contract` tier.

## Group 3 — never take from the contract as fact

This is the longest list of the three, and that is the point: a contract describes the shape of a
conversation, not the behavior of the service behind it. Every entry below is `unknown` until a request
settles it, and `unknown` blocks a criterion — the question goes to `UNRESOLVED.md` with what the contract
says, which criterion it blocks and the requests that would answer it.

| What the contract seems to settle | Why it does not | What settles it |
|---|---|---|
| **Validation stricter than the schema** | a schema describes what the request parser accepts. A second check lives in the entity behind it, and nothing in the document describes that check. | submit the extreme the schema permits, and one value inside it. Both codes. |
| **Cascade behavior** | a `DELETE` declares its own response and says nothing about records that referenced the one deleted. Cascades live in database constraints or service code, neither of which the contract describes. | delete a parent that has children, then read each child through **every** route it has. |
| **Whether an error response carries a body** | error schemas are commonly declared once and applied by default to codes nobody tested. Whether the running service fills the body is a separate question from whether a schema exists for it. | provoke the error and look at the body. |
| **What an empty collection returns** | the contract declares an array, because that is what a populated collection is. `200` with an empty array and `404` with no body are both ordinary implementations of the same declaration. | read a collection you know is empty. |
| **Ordering guarantees** | array order comes from the query the service runs, and no schema keyword expresses it. Even an order someone documented changes when an index or a join changes. | read a collection you populated in a known order — and treat the answer as fragile. |
| **Whether a submitted read-only field is ignored or refused** | the marker says the field is not yours to set. It does not say what happens when you set it: silently dropped, `400`, or a `500` from a constraint deeper in are all common. | send it. |
| **Whether a submitted nested value is honoured or resolved** | where a request embeds another entity, the service may resolve it by `id` and ignore every other field you sent. The schema shows the whole nested object either way. | send a nested object with a wrong label and a right `id`, then read the record back. |
| **Uniqueness across records** | no schema keyword can say a value must be unique, and a column with a plain index and no unique constraint accepts duplicates. | create the same value twice. |

Each row is a rule rather than a caution, and each has the same consequence when it is ignored: a
criterion asserting an unmeasured behavior produces a test that is red for a specification reason, and
rework cannot fix a specification. The last two rows are the ones most often skipped, because both look
like details of the request rather than behavior of the service.

**A worked example of the empty-collection row.** In a parcel-delivery contract,
`GET /depots/{depotId}/consignments` declares `200` and an array of consignments. Measured against a depot
that holds nothing, the same route answers `404` with no body. A criterion written from the contract — "the
array is empty after the last consignment leaves" — is red on the first run and stays red, because the
behavior it asserts does not exist. The measured answer instead produces a usable criterion: the depot's
collection answers `404`, and the consignment is still reachable through its own route.

## Group 4 — record where the contract is wrong

Groups 1 to 3 are preparation. This is where a spec earns its keep.

**Where a measured behavior contradicts the contract, the package records both readings, plus which one
test data follows and the request that measured it.** Not the winner alone. Both.

Everything in groups 1 and 2 could be regenerated from the contract by any tool that can parse one. A
contradiction could not be regenerated by anything: it exists only because someone sent a request and
looked at the answer. **The most valuable content in a package is the part that contradicts the
contract** — it is the part with no other source, and it is the part holding the generated tests up.

A worked example, from a payroll service. The contract declares:

```yaml
Deduction:
  properties:
    code:
      type: string
      maxLength: 12
      pattern: '^[A-Za-z0-9]*$'
```

Measured: `POST /pay-runs/{payRunId}/deductions` accepts a six-character upper-case `code` and answers
`500` for anything longer. Seven to twelve characters pass schema validation and are refused on save,
which is why the failure is a `500` and not a `422` — the request was well formed and the entity behind it
was not satisfied. Recorded in the conventions file:

| What the contract declares | What a request measured | Which one test data follows |
|---|---|---|
| `Deduction.code`: `maxLength: 12`, `^[A-Za-z0-9]*$` | 7 to 12 characters pass schema validation and fail on save with `500`; exactly 6 upper-case characters are accepted (`POST /pay-runs/{payRunId}/deductions`) | the measurement — every `code` in test data is exactly 6 upper-case characters |

**Why both readings and not just the winner.** Record only the measurement and the test-data tables look
arbitrary: a reader who compares them with the contract finds six characters where twelve are permitted,
concludes the tables are over-cautious, widens them, and sends a green suite red for a reason the package
does not explain. Record only the contract and a criterion gets written for the twelve-character boundary,
which cannot pass. Both readings together are what make the narrower value obviously deliberate.

**Record it; do not adjudicate it.** The provenance ladder already settles which reading test data
follows — `measured` overrides `contract`. Whether the contract or the service is the defect is someone
else's decision, and a package that argues the point loses the reader who needed the fact.

Bringing the package's copy of the contract into line with the observed behavior is optional and often
worth doing. **The discrepancy stays recorded either way**, because the next reader needs to know the
original lied — a reconciled copy with no record of what it was reconciled from is a second contract
nobody can trust more than the first.

## Prose inside the contract is `documented`, not `contract`

A `description`, a `summary`, an endpoint's explanatory paragraph: these live in the contract file and are
**not** `contract` facts. Authority on this ladder follows **verifiability, not location**.

What makes a schema `contract` is that something checks it — the service is generated from it, or validated
against it, or both, so a declared `maxLength` is enforced somewhere. Nothing checks a `description`. It is
a comment that happens to be stored in a machine-readable file, and it can be stale, aspirational, or
copied from an endpoint that behaves differently. A `description` reading "returns `404` when the record
has been archived" is a sentence somebody typed; the service may answer `200` with a tombstone.

So a `description` may **never** be the sole support for an assertion. What it is genuinely good for is two
things, and both matter:

- **It is the best `documented` source you will get**, because it sits beside the thing it describes and is
  usually touched by whoever changed that thing. Use it for the `Why this matters` block and for candidate
  user stories, the same as a ticket.
- **It tells you what to probe.** A `description` describing a cascade, a computed field or a state
  transition is naming exactly the behavior that is `unknown` until measured. Treat it as a list of
  requests to make when an instance is available, and as a list of `UNRESOLVED` entries when one is not.

This was decided after a trial run in which the contract's descriptions were the only documentation
available, and several criteria turned on them while no rule said what they were worth.

## Scope — name the endpoints you are not covering

A contract routinely carries endpoints outside the coverage perimeter: an administrative surface, a health
probe, a partner-facing set another team owns, an earlier version of the API still served under its own
prefix, an endpoint kept deliberately broken for demonstrations. **Name each of them out of scope in the
conventions file, in one list, each with its reason.**

**An out-of-scope endpoint that is not named out of scope is indistinguishable from a gap.** The next run
asked to raise coverage writes tests for the health probe, reports that coverage went up, and spends
iterations of the loop on endpoints nobody wanted tested — while the criteria that mattered wait behind
them.

The reason matters as much as the path. "Not covered" without one gets reversed by the next reader, who
cannot tell a decision from an oversight. In the parcel-delivery contract, `/internal/metrics` is out of
scope because it is not part of the product surface; `/carriers/*` because the team that owns the carrier
integration tests it separately; `/v1/*` because it is superseded and scheduled for removal. Three
different reasons, and each one survives a review that "out of scope" alone would not.

## Compiling the result into per-flow behavior tables

The output of everything above is one behavior table per flow — not one shared appendix, because the
generating agent reads a single flow document and nothing else. A row belongs in the table of every flow
that uses the request.

Each row carries four things: the request as a template, the codes it answers with, the response shape
naming the fields criteria assert on, and what it does when the record is absent or the collection empty.
Where a measurement contradicts the contract, the row carries the measured behavior and says so.

Then check the table the way the loop will: **could someone write every step of this flow's criteria from
this document alone, with no access to the contract?** If a step would need a code, a response shape or a
behavior on empty that no row declares, the table is incomplete — and that is a defect of the
specification, to be fixed here rather than explained to the agent later. The gate's endpoint-containment
check catches the crudest form of this, an endpoint used in a step and declared nowhere; it cannot catch a
row that declares an endpoint and omits what the step needs to know about it.

## Where these rules come from

Each rule below traces to something already measured: the generation prompt of the loop this Skill feeds,
the gate that travels with this Skill, or the one reference package these rules were measured against —
whose conventions carry a numbered section of behavior that had to be verified by request because the
contract did not settle it. A rule whose origin cannot be named is an opinion, and an opinion in a file a
model reads as instruction is worse than silence.

| Rule | Origin |
|---|---|
| Contract analysis is compilation, and the agent never opens the contract | The generation prompt's own "Do not read the contract" section: 53 KB, about 13 000 tokens a turn, and the flow's behavior table already carries the codes for that flow. |
| Anything the behavior table omits is a defect of the spec, not of the agent | The same section, read as a constraint rather than a saving: the table is the agent's only source of codes and shapes, so a gap in it is a gap in the specification. Recorded as a correction to the design's section 8D, which had said the agent may derive from the contract. |
| Take paths, schemas, constraints, codes and schema names directly | The reference conventions' section on what the contract states, which is exactly this list, kept separate from the section on what was measured. |
| Cite the schema a test-data constraint came from | The reference's data-model section is explicitly abridged and points at the contract for the rest; without the citation a table cannot be re-checked when the contract changes. |
| Route asymmetry is derived by tabulating operations per entity | The reference conventions carry a route-asymmetry table and call it the key to its integration scenarios: one record creatable only through a nested route, readable through several built separately. |
| Nesting marks a candidate second representation | The reference's consistency criteria read one record through its own route, a nested route and a collection-wide one, because the three were measured to disagree independently. |
| Validation stricter than the schema is `unknown` | Measured in the reference: a field whose request schema permits up to twenty characters is refused on save above ten, with a `500` — schema validation passes and the entity refuses. |
| Cascade behavior is `unknown` | Measured in the reference: three deletions with three different cascades, one of which refuses the delete outright and removes nothing, and one of which reaches records belonging to unrelated parents. None of it is in the contract. |
| Whether an error carries a body is `unknown` | The reference conventions' response-code table records which responses carry no body, verified by request — and the judge rejects an assertion on the body of one. |
| What an empty collection returns is `unknown` | Measured in the reference, where a collection read with nothing in it answers `404` with no body rather than an empty array. A criterion written from the contract's declaration would be unfixable. |
| A submitted read-only field may be ignored, refused, or answered with `500` | Measured in the reference: a field marked required in the request schema causes a `500` when it is sent, so the body has to be built without it. |
| A submitted nested value may be resolved by `id` and otherwise ignored | Measured in the reference: a nested entity is resolved by `id` alone and the label submitted with it is discarded, so the response carries the directory's own value. |
| Uniqueness is `unknown`, and its absence is informative | Measured in the reference: the columns carry indexes with no unique constraint, duplicates are accepted, and uniqueness in test data therefore exists for the tests rather than for the service. |
| Record both readings where a measurement contradicts the contract | The provenance ladder's rule that `measured` overrides `contract` **and** the disagreement is recorded with which one test data follows. The reference does exactly this for the field length above. |
| Name out-of-scope endpoints, each with its reason | The reference conventions' non-goals section names the endpoint groups outside the perimeter explicitly, alongside its statement that a missing criterion is a decision and not a gap. |
| One behavior table per flow, containing every request its criteria make | The gate's endpoint-containment check, which fails a flow naming a request its table does not declare. `references/spec-layout.md` owns the table's shape. |
