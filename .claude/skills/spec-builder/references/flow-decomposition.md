# Flows — the entity questions, the boundary, and the precondition that carries its exceptions

Two phases work from this file. Phase 1 finds the entities and the asymmetries between them; phase 2 cuts
them into flows. Both run **once**, before any criterion is written, and the result is written to disk.
Rediscovered per flow, the same API yields flows that contradict each other about it — two flows both
claiming one entity's lifecycle, two different answers about what a deletion removes — and nothing in the
package says which answer the tests were generated from.

A flow is the unit of generation. One flow document is everything the generating agent reads for a whole
turn: it may not open the contract, it does not remember the previous flow, and whatever the document omits
it invents. The decomposition is therefore not an organising convenience. It decides how much material each
turn has, and a flow drawn wrongly is drawn wrongly for every criterion inside it at once — which is why
every rule below states what breaks when it is ignored.

**About the examples below.** They come from two unrelated domains on purpose — an insurance-claims service
in one place, a museum-loan service in another — and they deliberately do not add up to one package. What
travels between projects is the shape of each question and the boundary rule that answers it. The entities
do not travel. Nothing in this file knows what an entity in your project is called.

**Formats are owned elsewhere.** `references/spec-layout.md` holds the flow file's name, the order of its
parts, the frontmatter form, the behavior table's columns, the criterion id and the anchors criteria link
by. Read it for the shapes; this file decides what goes in them. What belongs in the behavior table's cells
is `references/openapi-analysis.md`.

## Entity discovery — five fixed questions whose answers are all local

Entities come out of the contract's schemas and paths, never out of the domain's vocabulary: that vocabulary
belongs to a product team rather than to the API and drifts from it, per `references/doc-analysis.md`.

Then ask these five, in this order. The questions never change. Every answer is this project's, and not one
of them can be carried from another project or guessed from the shape of the words.

1. **Which entities can exist independently?** Each is the root of a flow — the record a chain can start by
   creating with nothing else in place. Get this wrong and the flow's setup tries to create its root through
   a route that needs a parent: every criterion in that flow fails inside `Given`, before a single assertion
   runs, and the run reads as an API defect rather than as a decomposition defect.
2. **Which exist only inside a parent?** Each becomes a later flow, whose setup includes creating the whole
   parent chain. A child mistaken for a root produces a flow that cannot be set up at all; a child whose
   parent chain is left out of its setup produces criteria that pass only when some other flow ran first.
3. **Which are shared directories that other entities reference?** Two outputs, not one: criteria about the
   directory itself, **and** a decision — recorded in each flow's common precondition — about whether
   criteria may use existing entries or must create their own. That decision is the subject of the last
   section of this file, and it is the most expensive one in the package.
4. **Where is the route surface asymmetric?** This is the integration material. The next section is about
   this question alone.
5. **What does deleting each entity take with it?** `measured`, never assumed, for every entity — one real
   deletion of a record created for the purpose, then a read of everything that referenced it. Assumed, it
   becomes an inferred cascade, and a criterion asserting a cascade that the API answers with a refusal
   instead is the opposite of the truth: no rework fixes it, because the specification is what is wrong.
   The answer is also what teardown order depends on, per `references/test-data.md`.

Write the five answers into the conventions file, where every flow cites them rather than re-deriving them.
A flow that answers question 5 for itself is a second reading of one API, and the two readings disagree.

## Asymmetry is the material

**A symmetric CRUD surface yields contract tests, and the package refuses those** — one request plus a code
and a schema check fails the selection filter in `references/ac-rules.md`. What makes an integration
criterion possible at all is a place where the surface is *not* symmetric. There are four, and you find them
by tabulating the operations per entity rather than by reading the paths one at a time:

- **create and delete use different routes** — a chain then has to change route mid-way, and the two routes
  were built separately;
- **the same data is readable through more than one route** — a value written once can be compared across
  representations that can disagree;
- **deleting a parent reaches its children** — absence becomes assertable, through every route the child
  had;
- **a shared directory exists** — one record is referenced by many, and what happens to the referrers when
  it changes is behavior no schema states.

In an insurance-claims contract the tabulation comes out like this:

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| policy | `POST /policies` | `GET /policies`, `GET /policies/{policyId}` | `PUT /policies/{policyId}` | none |
| claim | `POST /policies/{policyId}/claims` only | `GET /claims/{claimId}`, `GET /policies/{policyId}/claims`, and nested inside `GET /policies/{policyId}` | `PUT /claims/{claimId}` | `DELETE /claims/{claimId}` only |
| loss cause | `POST /loss-causes` | `GET /loss-causes` | none | `DELETE /loss-causes/{lossCauseId}` |

Four things that table settles, none of them visible until the operations sit side by side. A claim is created
through its policy and deleted through its own route, so one chain has to cross both. A claim is readable
three ways, so a value submitted once can be read back through two routes that did not write it. A policy
cannot be deleted at all, so the "deleting a parent" asymmetry is unavailable at that level and question 5's
answer for a policy is *not possible* — a finding to record rather than a blank to leave, and a redirection:
the cascade material in this contract has to come from the directory's deletion instead. And a loss cause has
no update, so the directory's own criteria are limited to creation, reading and deletion.

**Where the tabulation finds no asymmetry, write that in the package.** A surface where nothing is readable
through a second route yields few criteria or none, and the honest output is that sentence plus the coverage
matrix — not a package padded with contract tests so that it looks complete.

## The flow boundary: one shared precondition, read both ways

**One flow is one entity's lifecycle in its context** — that entity, its immediate parent and its immediate
children. Not the whole graph: an entity two levels away belongs to its own flow, whose setup creates what
it needs for itself.

**One shared precondition is what draws the boundary, and it draws it in both directions:**

- criteria that need **materially different setups** are **two flows**;
- two flows with the **same setup** are **one flow**.

Materially different means a different parent chain, a different directory decision, or a different starting
entity **graph** — not merely a different point in one entity's lifecycle, which is what a create criterion and
a modify criterion always are. Read the looser way, this rule splits every lifecycle it exists to hold
together, and the trial run hit exactly that reading. It does not mean a different field value: field values vary freely inside one precondition, and that
is what the test-data tables are for.

**What a flow with two preconditions costs.** Every criterion then carries a deviation, and a deviation is
how a reader tells the exceptional from the ordinary. Where most criteria deviate, the precondition
describes nothing — and the generating agent, handed one precondition plus a list of exceptions to
reconcile, resolves the conflict by choosing, silently and differently per criterion. The tests then set
themselves up in ways that differ for no reason the package records.

**What splitting one precondition across two flows costs.** The setup is written twice and the two copies
drift, because each is updated by whoever is working in that document. Each flow is also generated in its
own turn against its own exemplar, so one setup performed two ways becomes something a reader of a failed
run has to reconcile before they can even look at the failure.

## Order flows by dependency depth, and record the reason

Shallowest first: a root entity's flow before the flow of a child that needs it, and a shared directory's flow
before the flows whose criteria use its entries.

**The reason goes into the package**, because the order looks arbitrary without it and the next person to
touch the package sorts the flows by name:

- complexity grows with depth, so the shortest chain comes first and the reader meets the conventions on
  the simplest example of them;
- each flow reuses the shape the previous one established, which is what makes a package read as one thing
  rather than as several;
- **the exemplar mechanism depends on it.** The loop hands the first accepted scenario to every later
  iteration as the shape to copy. Whatever the first flow's first criterion produces therefore sets the
  house style for the whole suite — so a flow placed first because it was the interesting one puts the most
  complicated scenario in the exemplar slot, and every later scenario imitates it.

## Flows are independent at run time

**Each flow creates all the data it uses**, so any flow can run alone, in any order, and a failure in one
does not travel to another. The loop generates and runs flows independently: a flow that needs another to
have run first is green in a full run and red on its own, which is the failure shape that gets rerun instead
of diagnosed.

**Dependencies are one-way and declared in frontmatter** — a flow depends on the conventions file and the
contract, never on another flow. `references/spec-layout.md` owns the form, and the gate checks that every
declared path resolves.

**Cross-links between flows exist for exactly one reason: to avoid repeating a test-data description.** A
criterion may link a table in another flow document by anchor. That is a documentation link and never a
run-time order — the linked flow need not have run, and nothing the linking criterion uses may exist only
because it did.

## The behavior table is a compiler output

The generating agent is **forbidden** to open the contract, so the flow's behavior table is what stands in
for it. It carries every request the flow's criteria and setup make, the codes each answers with, the
response shape naming the fields criteria assert on, and what each does when the record is absent or the
collection is empty.

Then apply the only test that settles it: **could someone write every step of this flow's criteria from this
document alone, with no access to the contract?** If a step would need a code, a response shape or a
behavior on empty that no row declares, the table is incomplete — **and that is a defect of the
specification, not of the agent.** The agent fills the hole by guessing, plausibly and sometimes wrongly,
after which the judge rejects a test that was never given the material to be right. When a generated test
expects one code and the API answers another, look for the missing row before you look at the agent.

The gate's endpoint-containment check catches the crudest form of this — a request named in a step and
declared in no row. It cannot catch a row that names the request and omits what the step needed to know
about it. That one is yours.

## The common precondition, and the exceptions it must name

The precondition is the setup every criterion in the flow starts from, written once. It states three things:

1. **what is created**, in what order, and where each id comes from;
2. **what is taken from a shared directory** rather than created, and whether it may be modified;
3. **every exception to the above**: which criteria deviate, what they do instead, **why**, and **what the
   deviation prevents**.

The third is the most expensive thing in a package to get wrong, and the failure has only two forms: the
rule is written and its exception is not, or the exception is written and its cost is not.

**A worked example.** A museum-loan service, flow over loan requests, eleven criteria. Couriers are a shared
directory: entries are referenced by loan requests across the whole package, and one measurement decides
everything about how they may be used — `DELETE /couriers/{courierId}` answers `204` and removes **every**
loan request assigned to that courier, including loan requests belonging to other exhibitions. Nine criteria
take the first entry of `GET /couriers` and never modify it. Two are about what becomes of a loan request
when its courier is withdrawn, and those two cannot use a shared entry. The precondition says exactly that:

> Every criterion takes the first element of `GET /couriers` as a whole and submits it unchanged; none
> modifies or deletes a directory entry. **Exception — AC-F03-07 and AC-F03-08 create their own courier
> entry, use it only for their own loan requests, and delete it last in teardown**, because both assert what
> becomes of a loan request whose courier has been withdrawn, which an entry they are forbidden to delete
> cannot show. Deleting the shared entry instead would remove every loan request assigned to it across the
> package — including those of criteria whose tests are already generated, accepted and passing. Those tests
> go red on a later run, in another flow, for a reason nothing in their own document mentions.

Four parts, each load-bearing:

- **the rule** — directory entries are taken as they are and never modified;
- **the exception** — these two criteria, named by id, create their own entry and remove it last;
- **the reason** — they assert a withdrawal, which the rule forbids them to perform;
- **the blast radius** — what the exception prevents: records belonging to other criteria destroyed, tests
  that already pass turning red, in a different flow, later.

**Why the blast radius is not optional.** Without it the exception is an inconsistency with no stated cost,
and an inconsistency with no stated cost gets simplified away — by a person tidying the precondition, or by
a model asked to make the flow consistent. The rule then applies to all eleven criteria, and nothing fails
where the change was made: the two criteria that now delete a shared entry still pass. Something else fails,
later, in another document, on a run that changed nothing near it. There is no trail from the red test back
to the deletion, and that missing trail is what makes this the most expensive shape of damage a package can
carry.

**The deviation is repeated inside the criterion that deviates, with its reason.** The criterion is what the
agent reads first, and `references/ac-rules.md` lists a deviation from the common precondition among the
things a criterion must state explicitly. The precondition holds the whole exception list; each criterion
holds its own.

**Where a flow has no exceptions, write one line saying so.** "No criterion deviates from this precondition"
is a claim a reviewer can check against the criteria. Silence is not, and silence reads the same whether the
exceptions were considered or forgotten.

## Where these rules come from

Each rule traces to the design this Skill implements, the loop it feeds — its generation prompt and its
judge rubric — or the one reference package these rules were measured against. A rule whose origin cannot be
named is an opinion, and an opinion in a file a model reads as instruction is worse than silence.

| Rule | Origin |
|---|---|
| Entities come from the contract's schemas and paths | Design section 7 and phase 1 of `SKILL.md`: read out of schemas and paths rather than out of the domain's vocabulary. |
| The five questions are fixed and every answer is local | Design section 7, which states them as fixed questions whose answers are per project. |
| What deleting an entity takes with it is `measured` | The reference's verified-behavior section: three deletions with three different cascades, one refusing the deletion and removing nothing, one reaching records that belong to unrelated parents. None of it is in the contract. |
| Route asymmetry is the material, and tabulating operations per entity is how it is found | The reference conventions' route table, which its own scaffold rubric cites in a check about the asymmetric routes: one entity creatable only through its parent and deletable only directly, another with two write routes. |
| A symmetric surface yields contract tests, which the package refuses | The reference's non-goals, which exclude single-endpoint and schema checks by name, plus the selection filter in `references/ac-rules.md`. |
| One flow is one entity's lifecycle in its context | Design section 9. |
| The boundary is one shared precondition, in both directions | Design section 9. The reference's flows are exactly this cut — one per entity, each with a single setup. |
| Order by dependency depth, with the reason recorded in the package | Design section 9, plus the loop's exemplar mechanism: the first accepted scenario is handed to every later iteration as the shape to copy, so the first flow decides the house style. |
| Flows are independent at run time, with one-way dependencies in frontmatter | Design section 9, and the gate's `depends_on paths exist` check — `references/spec-layout.md` states that the dependency runs from a flow to the conventions and the contract and never back. |
| Cross-links exist only to avoid repeating a test-data description | Design section 9. The gate's anchor check accepts a cross-document anchor, which is what a shared table is linked by. |
| The behavior table is a compiler output | The generation prompt's "Do not read the contract" section: 53 KB, about 13 000 tokens a turn, and the flow's table already carries what that flow needs. |
| An incomplete table is a defect of the spec, not of the agent | The same section read as a constraint rather than a saving, recorded in the design as a correction to its section 8D. The gate's endpoint-containment check covers only the crudest case of it. |
| The precondition names every exception, with its reason and its blast radius | Judge item 17 and the reference conventions' §10.9. All but two criteria of the package take the shared directory entry; two must create their own, because a deletion there removes records belonging to unrelated parents. The rubric calls it the rule with the widest blast radius, and states the damage in the same terms used here: a criterion that took the shared entry destroys data belonging to criteria that are already accepted, and it shows up as an unrelated test failing later. |
| A deviation is repeated in the criterion, with its reason | Design section 8D's list of what must be explicit in a criterion, carried into `references/ac-rules.md`. |
| Having no exceptions is stated rather than left silent | The same rubric item, read the other way: it enforces *both* halves — the two criteria that create their own entry and every other criterion that must not — and calls the two halves not interchangeable. A precondition that says nothing supports neither half. |
