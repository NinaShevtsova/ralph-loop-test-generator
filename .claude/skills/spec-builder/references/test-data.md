# Test data — base values only, and the rule that is always learned the hard way

The tables you write in this phase are the only place the generating agent can get a base value from. It reads one
flow document, is forbidden to open the contract, and does not remember the previous flow. A field the tables
leave out is a value it invents, and an invented value that breaks a constraint nobody wrote down is refused
on the first request of the chain — so the criterion fails before a single assertion in it runs, and the
report names a field rather than the specification that omitted it.

Every rule below therefore carries what breaks when it is missing. A rule without a consequence is advice,
and advice is the first thing dropped by a model under pressure.

**About the examples below.** They come from two unrelated domains on purpose — an alpine lift-pass service
in one place, a brewery batch service in another — and they deliberately do not add up to one package. What
travels between projects is the shape of a table and the question each column answers. The values do not
travel, and neither do the constraints: a field named the same way in two projects has different limits, and
copying one is how a package acquires a rule nothing in it measured.

**Formats are owned elsewhere.** `references/spec-layout.md` holds the heading a table sits under, the anchor
that heading yields, and the check that every criterion's link into it resolves. Read it for the shape; this
file says what goes in the cells.

## One table per entity, citing the schema it came from

Three columns — `Field | Constraint | Example of a valid value` — under the entity's own anchored heading, so
a criterion's `Given` links to the table instead of restating its values.

**Cite the contract schema the constraints came from.** This is not bookkeeping: without the citation the
table cannot be re-checked against a contract that moved, and the way it goes wrong is silent. A value that
was valid last quarter still looks valid, still parses, and is refused by a service whose limits changed. A
table that names its schema is diffed against it in a minute; one that does not is rewritten from scratch or,
more often, trusted.

The constraint column carries everything that decides whether a request is accepted — required or optional,
type, length, minimum and maximum, enumerated values, pattern — and nothing that does not. Where a
measurement contradicted the contract, the **measured** constraint goes in the cell and says so;
`references/openapi-analysis.md` owns that rule, and this table is where its consequence lands.

Under the heading `## Test data — pass holder`, with constraints from the schema `PassHolder`, an alpine
lift-pass service's table reads:

| Field | Constraint | Example of a valid value |
|---|---|---|
| `familyName` | required, `maxLength: 30`, `pattern: ^[A-Za-z' -]+$`. Unique per run: **suffix of 6 letters, no digits**; the base value stays short enough to fit inside 30 with the suffix | `HalloranQKZTVM` |
| `givenName` | required, `maxLength: 30`, same pattern. No uniqueness needed — nothing reads by it | `Marta` |
| `dateOfBirth` | required, `date`, in the past. Not a date at the edge of the eligible range | `1991-04-17` |
| `email` | required, `maxLength: 80`. Unique per run: digits are permitted here, so a timestamp suffix is fine | `m.halloran+1755012@example.test` |
| `heightCm` | optional, integer, `minimum: 50`; the contract declares `maximum: 230`, but a request **measured** that anything above `210` passes schema validation and is refused on save with a `500`, so test data stays at or below `210` | `168` |

Two fields there need a unique value and the answer is different for each. That is the shape of the next
rule, and the reason it cannot be stated once for the whole package.

## For every field needing a unique value, state the character class the suffix may use

A field needs a unique value when a later step has to find exactly this run's record: a read that filters by
name, a collection that also holds earlier runs' records, an assertion that a submitted name came back
unchanged. For each such field the table states three things:

1. **that the value must be unique**, and which read depends on it;
2. **the character class the suffix may use**, taken from that field's own pattern;
3. **how the suffix fits** — where it is attached, how long it is, and that base plus suffix stays inside the
   field's maximum length.

**The character class is the part that gets left out, and it is the one that costs a run.** The obvious
unique suffix is a timestamp. A timestamp is digits. Name fields are frequently letters-only, so a family
name with a timestamp on the end is refused outright — and the reason is invisible from everywhere the
generating agent is looking. The constraint lives in a `pattern`, which is exactly what a hurried table
summarises as "letters, 30 max" before illustrating it with a value that carries no suffix at all. The answer
is a `400` whose body may name no field. Nothing in the criterion, nothing in the behavior table and nothing
in that summary says the digits are the problem, so the fix looks like a retry.

**The class is per field, not per package.** In the table above one field takes letters only and another
accepts digits, both need uniqueness, and a single rule for both is wrong whichever way it is written. State
it in the cell, beside the constraint that causes it.

**Length is part of the same rule.** A suffix that satisfies the pattern and pushes the value past
`maxLength` is refused exactly as certainly, and a base value chosen without leaving room is the version of
this defect that survives a first pass because it is intermittent — it appears only for the longer base
values.

**Where uniqueness is the tests' requirement rather than the service's, say so.** A column with an index and
no unique constraint accepts duplicates, per `references/openapi-analysis.md`, so the suffix exists to keep
this run's records findable and not because the API demands it. That matters twice: it stops a reader
deleting the suffix as pointless, and it stops a criterion claiming a second identical value is refused —
which is a criterion only where a request measured it.

## Base values only

A table carries the values a request submits. **Never an expected value, a status code or a path.**

- expected values belong in the criterion's `Then`, which is where the claim is;
- status codes belong in the flow's behavior table;
- paths belong in the steps.

A value written in both a table and a `Then` is one claim declared twice, and the copy in the table is the
one nobody updates when the criterion changes — after which the agent submits from the table, asserts from
the criterion, and the test contradicts itself. A status code in a data table is worse than duplicated: the
gate's containment check reads the behavior table, so a code that lives only here is invisible to the gate,
to the agent, and to the reader looking for it in the one place it is supposed to be.

## Never rely on the ids of seeded records

Every test creates the records it acts on and takes each id from a response. A populated environment answers
a literal-id read with `200`, so the test proves the seed data exists; and the seed differs between one
machine and the next, so the same test proves something different in each.

For the tables this has one consequence: **a test-data table never carries the id of an existing record.**
Where a criterion needs an id, it names the step whose response produced it. `references/ac-rules.md` holds
the criterion-side rule, and the gate warns on a literal id in a path.

## Setup is self-sufficient

Each test creates its whole parent chain — every ancestor the record needs — and **never reuses another
test's data.** Shared data makes execution order load-bearing, and the loop generates and runs flows
independently: the test that borrowed is green in a full run and red on its own, which is the failure that
gets rerun rather than diagnosed.

The one thing a test does not create is an entry in a shared directory that the flow's precondition declares
read-only. That decision, and every exception to it, belongs to the precondition rather than here — see
`references/flow-decomposition.md`.

## Counts: relative over shared collections, exact over collections the test created

Both readings are correct. They are about different collections, and **a package that states either one
absolutely collides with its own criteria.**

- A collection that can hold records this test did not create — a top-level list, anything an earlier run
  left behind, anything seeded: **relative**. "The list grew by one, and the new element is the one this test
  created, matched by its saved id."
- A collection this test created and nothing else writes to — the children of a parent created in this run:
  **exact**. "Contains exactly one element", and that exactness is the assertion the criterion is making.

The question that decides it: **could a record another test created legitimately appear in this collection?**
Yes, relative. No, exact.

What the tables owe here is that answer, per collection, so a criterion has something to look up instead of a
judgement to make. In a brewery batch service:

| Collection | Can hold records this test did not create | Counts |
|---|---|---|
| `GET /batches` | yes — every batch the service holds, from any run | relative only |
| `GET /batches/{batchId}/readings` | no, where the batch was created by this test | exact |

**What a rule stated absolutely costs, in both directions.** "Counts are always relative" makes a criterion
saying the readings array contains exactly one element look like a violation, so somebody weakens it to "at
least one" — and it then passes with the wrong reading in it. "Counts are exact" produces an assertion that
the batch list holds fourteen entries, which passes once and never again without a restart. Scope the rule to
the collections it is about; never let it stand as a slogan.

## Teardown runs in reverse dependency order, and the order carries its reason

Delete in the reverse of the order the records were created: the last created is the first removed, and a
shared-directory entry a criterion created for itself is removed last of all.

**Why that order and no other**, written in the package beside the order itself:

- a parent's deletion may be **refused** while its children exist, and whether it is refused is measured
  behavior rather than a certainty — so children go first, and the flow's behavior table says what the
  refusal looks like;
- a child that a cascade already removed answers not-found, which teardown **ignores** — but it ignores that
  one code and nothing else. A blanket catch around teardown turns a genuine failure into silence and leaves
  records behind while reporting success;
- a refusal during teardown is a finding, not noise: it means the dependency order in the package does not
  match the service's.

Without the reason in the package the order reads arbitrary and gets re-sorted into creation order by the
next person, after which teardown leaves records behind — and surviving records are what make the next run's
relative counts drift and its unique values collide, two failures that point nowhere near teardown.

**Teardown removes what the test created and nothing else.** A shared directory entry the test merely read is
not the test's to delete, and deleting one is precisely the damage the precondition's exception list exists to
prevent.

## Sequential execution where tests share one database

Where every test runs against one database with no isolation between them, the suite runs **sequentially**,
and the package says so with the reason: two tests writing into one collection in parallel make every
relative count wrong at random, because "grew by one" is then measured around another test's insert. The
result is an intermittently red suite, and an intermittent failure is rerun rather than diagnosed, so the
defect survives every run it does not appear in.

Where the environment gives each test its own database, or restores state between tests, write that instead,
and write what performs the restore. Either statement is usable. Silence is what leaves the next person
reading the parallel setting as available and turning it on.

## Where these rules come from

Each rule traces to the design this Skill implements, the loop it feeds — its judge rubric and the rubric
that grades the harness those tests run in — or the one reference package these rules were measured against.
A rule whose origin cannot be named is an opinion, and an opinion in a file a model reads as instruction is
worse than silence.

| Rule | Origin |
|---|---|
| One table per entity, anchored, with three columns | Design section 10 and the reference's own test-data tables. `references/spec-layout.md` owns the heading and the anchor it yields, and the gate fails a criterion whose link into it does not resolve. |
| Cite the contract schema the constraints came from | The reference's data-model section is explicitly abridged and points at the contract for the rest; `references/openapi-analysis.md` makes the citation what lets a table be re-checked when the contract moves. |
| Base values only — no expected values, codes or paths | Design section 10: expected values belong in a `Then` and codes in the behavior table, which is also the only table the gate's endpoint-containment check reads. |
| State the character class every unique suffix may use | The reference conventions' §10.5, which had to state it **per field**: letters only and up to 30 characters for one field, no character constraint and up to 80 for another. Judge item 13 and check 5 of the harness rubric both enforce it, and both name the same failure — a name assembled with a timestamp contains digits and is refused with `400`. |
| The suffix must also fit inside the maximum length | The same §10.5, which carries the character class and the length limit for one field in one sentence: both apply at once, so a suffix that satisfies the pattern and overflows the length is refused just as certainly. |
| Uniqueness may be the tests' requirement rather than the service's | Measured in the reference: the columns carry indexes with no unique constraint, duplicates are stored successfully, and §10.5 says in as many words that uniqueness is needed by the tests and not by the application. |
| Never rely on the ids of seeded records | The reference conventions' §10.1 — a populated database answers a literal-id read with `200`, so the test proves the seed. Judge item 11 and the gate's "no literal record ids" warning repeat it. |
| Setup is self-sufficient | The reference conventions' §10.2, which requires each test to create its whole parent chain and forbids reusing data another test created. |
| Counts relative or exact, scoped to the collection rather than declared globally | The reference conventions' §10.4 and judge item 12, whose own reconciliation with items 2 and 6 is this rule: an exact count over a collection the test created is the assertion the criterion demands, and rejecting it under the relative rule would leave fifteen steps of the reference impossible to pass by any route. |
| Teardown in reverse dependency order, ignoring not-found and nothing else | The reference conventions' §10.6, which states the order and its cause: a parent with two children of one kind cannot be deleted, so children go first and a `404` from a cascade is ignored. Check 4 of the harness rubric requires that one code to be swallowed specifically, because a blanket catch turns a failing teardown into silence. Judge item 14: an unregistered record survives teardown and poisons later scenarios. |
| A shared directory entry is not teardown's to delete | Judge item 17 and §10.9 — only the criteria that created their own entry remove one, and the rubric calls this the rule with the widest blast radius. `references/flow-decomposition.md` owns the decision it comes from. |
| Sequential execution where one database is shared | The reference conventions' §10.7: the tests of a run share one database and are not isolated by transactions, so assertions on the number of records in a collection would become non-deterministic under parallel execution. |
| No boundary value unless the boundary was measured | Judge item 20 and `references/ac-rules.md`: a value at the edge of a permitted range fails on a timezone difference or a date rollover rather than on the behavior, which costs an iteration and teaches nothing. |
