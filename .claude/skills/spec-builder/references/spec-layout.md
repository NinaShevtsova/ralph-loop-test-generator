# The spec package layout, and the formats a machine parses

A spec package is read by a machine before it is read by a human. Most of it is prose you may write as
you see fit. A small part of it is an **interface** — a handful of shapes that scripts parse with
regular expressions — and prose in those places breaks the generation loop rather than merely reading
oddly.

Run the gate on anything you produce, and read its output before calling the package done:

    node <path-to-this-skill>/check-spec.mjs --spec <spec-dir>

Add `--quiet` to print only the failures, the warnings and the summary. Some repositories wrap the same
command in a script — `npm run check:spec -- --spec <spec-dir>` in the one this Skill was written in —
but the command above works anywhere the folder has been copied, which is the point.

Exit 0 means every check passed; warnings may still be printed and are yours to judge. Exit 1 means at
least one check failed. Exit 2 means the gate was invoked wrongly and checked nothing — never read it
as a pass.

`--list-checks` prints the gate's inventory of rules. Every name it prints appears in this document,
and `self-check.test.mjs` — which ships in this Skill's folder alongside the gate — enforces that, so
this file cannot fall behind the gate wherever the folder has been copied to:

    node --test <path-to-this-skill>/self-check.test.mjs

**About the examples below.** They are drawn from two unrelated domains on purpose — an order service in
one place, a banking service in another — and they deliberately do not add up to one coherent package.
What carries from a package to a package is the *shape*: the column layout, the backticks, the id
format, the heading names. The entities do not. If the examples all came from one domain you would be
reading a template, and the entities in it would quietly become the ones you reached for.

Nothing in this document, and nothing in the gate, knows what an entity in your project is called.

## The files

    <spec-dir>/
      README.md                     reading order, the package table, the AC format, the traceability rule
      context-and-conventions.md    numbered sections — the shared foundation of every flow
      contracts/openapi.yaml        the contract, reconciled with observed behavior
      flows/F-01-<slug>.md          one flow = one independent generation unit
      flows/F-02-<slug>.md
      UNRESOLVED.md                 behavior that could not be verified, so it became a question

**package structure** requires `README.md` and `context-and-conventions.md` to exist, `contracts/` to
hold at least one `.yaml`, `.yml` or `.json`, and `flows/` to hold at least one `.md`. Each of those
must be a *file*, all four of them: a directory named `openapi.json` is not a contract, and a package
with no contract has no source of truth about request and response shapes.

`UNRESOLVED.md` is not required by the gate. Write it whenever behavior could not be observed — an
unverifiable claim belongs there and never inside an acceptance criterion.

**flow file names** are `F-NN-lower-case-slug.md`: two digits, then hyphen-separated lower-case
alphanumeric words. The loop rebuilds this path from its flow map, so a file named `overview.md` or
`F-1-Checkout.md` is a flow document nothing can open.

The rule applies to **every** `.md` in `flows/`, so that directory holds flow documents and nothing
else. A `flows/README.md` explaining the reading order fails the check — put that in the package
`README.md`, which is where the reading order belongs anyway.

## Fenced code blocks are invisible to every check

Anything inside a ```` ``` ```` fence is an example, not content — in every scan this gate performs.
A request in a fenced table is not a declaration; a `**When**` line in a fenced sample is not a step; a
heading in a fenced block neither opens a criterion nor answers an anchor; a Test plan row shown inside
a fence is not a row; a `**US-nn —**` inside one is not a declaration; a link inside one is not a link.

This matches how the file renders: GitHub shows a fenced line as text. Use fences freely for
illustrations, and never put a real declaration, step, row or heading inside one — it would be
invisible to the machine and to the reader alike.

**Only ```` ``` ```` fences count.** A four-space-indented block is a code block to a Markdown renderer
and ordinary text to this gate, so the two disagree about it in both directions. Use fences for anything
the gate must ignore, and never an indented block.

**Every declaration starts at the first column.** A heading, a `**US:**`, `**Why this matters:**`,
`**Given**`, `**When**` or `**Then**` marker, and a numbered conventions section are all matched at the
start of a line, so an indented one is not read at all — while a request in backticks, a user-story
declaration and a Test plan row *are* read wherever they sit. Indenting a construct therefore does not
move it out of the gate's way reliably; it drops some of them silently and keeps others.

## Encoding

Write the files as UTF-8. A byte-order mark and Windows line endings are both tolerated — the gate
strips them before parsing anything — but they are tolerated rather than expected, and both used to
defeat the frontmatter parser silently, leaving `depends_on` unchecked while the gate reported it as
absent. If you are generating these files from a Windows shell, prefer a writer that does not add a BOM.

## The conventions file

Sections are numbered `## 1.`, `## 2.`, … contiguous from 1. **conventions section numbering**
enforces it.

These numbers are an addressing scheme, not decoration: the judge rubric cites `§10.9` and the
generation prompt cites `§10` and `§11`. Renumbering the file, or leaving a hole, leaves those citations
pointing at the wrong section, and nothing else in the pipeline notices.

User stories live here, declared once each as `**US-nn — Title.**`, and are referenced from criteria by
id alone. The shape is exact: **two digits** and an **em dash**. `US-1` or `US-01 - Title` is not a
declaration, and the two traceability checks below would then compare empty sets.

**user stories are declared** is the guard against precisely that — a conventions file where nothing
matches the shape fails here rather than passing two checks about nothing.

## The flow document

Each flow document is one independent generation unit. Its parts:

    ---
    depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml"]
    ---

    # Flow F-02 — <what this flow covers>

    ## What the flow verifies
    ## Chain
    ## Common precondition (setup)
    ## Test data — <entity>          one table per entity, linked to by anchor
    ## API behavior used in this flow
    ## Acceptance criteria
    ### AC-F02-01 — <one-line statement>
    ### AC-F02-02 — …
    ## Test plan                     the index table, last

A `## ` section runs to the next `## ` heading or to the next criterion heading, whichever comes first.
So a long behavior table or precondition may carry `### ` subheadings of its own and nothing below them
is lost — while a document that goes straight from the behavior table to `### AC-F01-01`, with no
`## Acceptance criteria` heading between them, still ends the table where the criteria begin.

### Frontmatter: `depends_on`

Only the one-line form is understood:

    depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml"]

**depends_on paths exist** requires every entry to resolve, relative to the flow document, to a file
that exists. The dependency is one-way by design — a flow relies on the conventions and the contract,
never the reverse — and a stale entry is a promise the package cannot keep.

**depends_on is readable** refuses a `depends_on:` key written any other way, a YAML block sequence
above all. The gate cannot parse it, and reporting "declares no depends_on" over an entry it simply
could not read would state a falsehood rather than merely stay silent. Omitting the key entirely is
allowed; writing it in a form nothing can read is not.

### `## API behavior used in this flow`

A two-column table: the request in backticks, then its status codes and response shape.

```markdown
| Request | Response |
|---|---|
| `POST /customers/{customerId}/orders` | `201`, the body contains the order with an assigned `id` and an empty `items` array |
| `GET /orders/{orderId}` | `200`, the order with its `customerId`, `status` and `items`; `404` with no body if it does not exist |
```

**endpoint containment** requires every endpoint named in a criterion's steps to appear in this table.
The generating agent is **forbidden** from opening the contract — this table is what stands in for it —
so an endpoint missing from it reaches a step that knows neither the status code nor the response shape.

Placeholders are compared by shape, so `/customers/{customerId}/orders` and `/customers/{id}/orders`
are the same endpoint. The reverse direction is deliberately not checked: a table may legitimately declare endpoints
no `**When**` uses, because they are used in a `**Given**`.

**criteria name at least one request** guards the empty case. A flow whose criteria name no endpoint at
all describes no chain, and would satisfy containment by having nothing to compare.

### Anchors onto the test-data tables

A heading `## Test data — order` yields the anchor `#test-data--order`: lower case, every non-word character
dropped, whitespace turned into hyphens — so the em dash disappears and leaves **two** hyphens. Link to
it from a criterion's `**Given**`, in the same document or another one:

    [«Test data — order»](#test-data--order)
    [«Test data — item»](./F-03-order-item-flow.md#test-data--item)

**anchor links resolve** checks every fragment against the headings of the document it points into. A
dead anchor leaves the generator with no route to the values it must submit. It fails the other way too:
a fragment matching **more than one** heading is ambiguous, because a reader following it reaches the
first of them and the rest are unreachable. Repeating a subsection heading across criteria is fine on
its own — it becomes a defect only when something links to it.

Headings outside ASCII are supported and slugged the way a renderer slugs them: letters and digits of
any script are kept, everything else that is not whitespace, an underscore or a hyphen is dropped. So a
table heading in your project's own language yields a working anchor, and two headings that differ only
in accents or script stay two anchors rather than collapsing into one.

**link targets exist** covers the other half: a link to another document with no `#fragment` still has
to name a file that exists.

## The acceptance criterion

### The id

Exactly `AC-F<two digits>-<two digits>`. The loop derives the flow from characters 4 and 5 of that
string without validating them, so a malformed id routes work to a flow that does not exist, silently.

**AC ids are well formed** enforces the shape on every `### AC…` heading. Without it a heading one
character off — `### AC-F03-7 —` — was invisible to everything else at once: no Test plan row was
demanded of it, its five parts were never read, the numbering did not notice the hole, and its text
folded into the previous criterion. It simply never became a test, and nothing said so.

**a well-formed heading opens a body** is the check behind that one. The gate reads a criterion heading
twice — once loosely, to notice a heading that means to be a criterion and is malformed, and once
strictly, to open the body — and this compares the two answers. It fails when a heading passes the shape
and yet no body was parsed from it, which is the same invisibility one layer deeper: every check below
reads nothing, and nothing says so. Write the heading as `### AC-Fnn-nn — …`, at the start of the line,
with a single space after the hashes.

**AC ids are unique** across the whole package: one criterion is one test, and the id is the only link
between them. **AC prefix matches its flow file** — `AC-F02-…` lives only in `F-02-*.md`, or the turn is
routed to a different document. **AC numbering is contiguous** from `01` within each flow; a gap reads
as a criterion someone forgot to write.

**a flow declares acceptance criteria** refuses a flow document with none. It describes no coverage, and
it would pass every id and completeness check below by having nothing to check.

### The five parts

**AC carries its five parts**: `**US:**`, `**Why this matters:**`, `**Given**`, and at least one
`**When**` and one `**Then**`. Each marker is bold and starts its own line.

```markdown
### AC-F02-03 — a transfer between own accounts is visible in both statements

**US:** US-02, US-04
**Why this matters:** the client moves money between their own accounts and then opens each
statement separately. If the transfer lands in only one of them, the client sees money that vanished.

**Given** two accounts are opened (`accountFromId`, `accountToId`) and the opening balances are
remembered, per the [«Test data — transfer»](#test-data--transfer) table

**Step 1 — submit the transfer**
**When** `POST /accounts/{accountFromId}/transfers` with `toAccountId` and `amount`
**Then** code `201`; the body carries an assigned `id` and `amount` equal to the submitted value.
Save `id` as `transferId`.

**Step 2 — open the receiving account's statement**
**When** `GET /accounts/{accountToId}/statement`
**Then** code `200`; the statement contains the entry with `id` = `transferId` and the same `amount`.
```

`**Why this matters:**` is the part most often dropped and the most expensive to lose: it is what lets a
human review the criterion and a judge tell a real check from a formality.

A criterion's body runs from its `### AC-…` heading to the next `### AC-…` or to any `## ` heading. A
`### Teardown` subsection therefore stays *inside* the criterion it belongs to, and its endpoints are
attributed to that criterion — declare them in the behavior table like any others.

### User stories, referenced by id

**user story references resolve** — every `US-nn` on a `**US:**` line must be declared in
`context-and-conventions.md`, or the criterion points at a motivation nobody wrote.

**every user story is referenced** — every declared story must be named by at least one criterion. An
unreferenced story is either missing coverage or a leftover, and the package cannot say which.

## The Test plan table

The last table of every flow document. It is an **index**, not a summary: it carries the exact name of
each generated test, in backticks, and a regular expression reads that name out and compares it to the
generated scenario title.

```markdown
| AC | Test | Level | Expected run result |
|---|---|---|---|
| AC-F02-01 | `AC-F02-01: a submitted order appears in the customer's history and in the order log` | integration | green |
```

Rows are read from the `## Test plan` section only. Do not quote a row in prose elsewhere in the
document even so: this gate ignores it, but the test gate downstream scans the whole file and takes the
**first** match, so a quoted older wording becomes the scenario title it demands — and the two gates
then disagree about what the test is called, with this one silent.

**AC body has a Test plan row** — a `### AC-…` heading with no row is a criterion that does not exist as
far as the machine is concerned: nothing knows what its test should be called, so it can never go green.

**Test plan row has an AC body** — a row naming an id no heading defines is a test with no criterion
behind it.

**exactly one Test plan row per AC** — two rows for one criterion give it two names, and the consumers
disagree about which is real: the test gate takes the first, the baseline comparison pins the last.

## Warnings

These are printed and never fail the gate. Each is a real smell that cannot be decided mechanically, so
the machine reports and you rule.

- **one request per When** — a `**When**` naming more than one request. One request per `**When**` is
  the norm; a criterion may confirm two collections under a shared `**Then**` when that is the point of
  the step. Say so in the step title if you keep it.
- **a chain of at least two requests** — a criterion with a single `**When**` is the signature of a
  contract test rather than a flow. Either extend the chain or move the check where single-request
  checks belong.
- **no literal record ids** — a path like `/customers/1` makes the test green about the seed data
  instead of about the behavior. Every id comes from an API response; use `{customerId}` and save it
  from the step that created it.
- **a Then asserts a data value** — a criterion whose every `**Then**` mentions nothing but a status
  code asserts that the endpoint answered, not that it answered correctly. A criterion asserting an
  absence in prose trips this legitimately, which is why it warns instead of failing.

## Appending to an existing package

An `extend` turn adds criteria to a package whose earlier criteria may already have generated, accepted,
passing tests. Pass an untouched copy of the package as a baseline and the gate proves you only added:

    node <path-to-this-skill>/check-spec.mjs --spec <spec-dir> --baseline <pristine-copy>

**baseline is unchanged** compares every pre-existing criterion's body and Test plan name character for
character, after line endings and any byte-order mark have been normalised on both sides — so
re-saving a file in a different editor is not mistaken for a rewrite.
Rewording an accepted criterion silently changes what its existing test proves; renaming its Test plan
entry turns a passing test red, and nothing else in the package looks any different; removing one
orphans a test that already passed.

**the baseline holds criteria** guards the comparison itself — a `--baseline` directory with no
criteria in it means the path points at something that is not a spec package, and a comparison against
nothing would otherwise report an append-only change it never verified.
