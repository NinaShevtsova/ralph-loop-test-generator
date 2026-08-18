# `create` — the mode that establishes the conventions

**Entry condition:** the spec directory holds no flow document with acceptance criteria in it. If it holds
one, you are in `extend` and must read `references/mode-extend.md` instead. Running `create` over a package
whose criteria already have generated, accepted, passing tests is the one mistake in this Skill that no
later edit undoes, so state the mode and the evidence you read it from before you write a file.

**This file is short on purpose.** `extend` is `create` with a stronger precondition, so every rule the two
share lives in the files both of them read — `references/openapi-analysis.md`, `references/doc-analysis.md`,
`references/flow-decomposition.md`, `references/ac-rules.md`, `references/test-data.md`,
`references/unresolved.md`, `references/validation.md`, and `references/spec-layout.md` for every format a
machine parses. A rule copied into two mode files drifts, and the copy that nobody happens to be reading
is the one that stays wrong.

**The one example below** comes from a domain unrelated to every other example in these files, and
deliberately does not combine with them into a package. Nothing here knows what an entity in your project
is called.

## What `create` does that `extend` does not

1. **It establishes the conventions the package will keep** — the numbered sections, the user-story list,
   the response-code table, the data strategy. Every later turn inherits these rather than choosing them,
   so a convention you settle carelessly is one the package carries for its whole life.
2. **It defines the flow decomposition from nothing**, rather than deciding whether a candidate fits an
   existing flow. `references/flow-decomposition.md` owns the boundary.
3. **It numbers criteria from `01`** in each flow, contiguous, with no reserved gaps. A gap reads as a
   criterion someone forgot to write and the gate fails on it, so the package cannot be handed to the loop
   at all; `references/unresolved.md` owns the case where the criterion that would have filled one is
   blocked by a question.

## The conventions file's numbered sections are settled before any criterion is written

The section numbers are an **addressing scheme**, not decoration. The loop's judge rubric cites a
subsection by number when it rejects a scenario; the generation prompt sends the agent to numbered
sections for the data and traceability rules; criteria and test-data tables cite them for the rule behind a
constraint. So the sections are named, numbered and contiguous from 1 **before the first criterion exists**.

Renumbering them afterwards is the failure this ordering prevents, and it is silent in the worst way: a
citation to a section that has moved still resolves to *a* section, so it still reads as authoritative
while pointing at the wrong rule. Nothing in the pipeline compares the two. The rule the citation was
enforcing is then enforced from memory, or not at all, and the first sign of it is a scenario rejected for
a rule its author could not find.

## The order of creation, and what each position is for

For a vending-machine restocking service the order runs: the contract, then the conventions, then
`F-01` for machines, `F-02` for the product slots that exist only inside a machine, `F-03` for restock
runs across them — dependency depth, per `references/flow-decomposition.md`.

1. **`contracts/`** — the contract, reconciled with everything phase 0 measured. It is the thing every
   other file describes, so nothing can be written against it while it is still outside the package.
2. **`context-and-conventions.md`** — numbered sections contiguous from 1, and each user story declared
   once. Settled here, for the reason above.
3. **`flows/F-NN-<slug>.md`**, in dependency order, and inside each document the API behavior table and
   the test-data tables **before** the criteria: a criterion cites both, and a criterion written first
   cites values and codes that are then written to match it rather than to match the API.
4. **`UNRESOLVED.md`**, as the questions arise and never at the end. A question written from memory when
   the package is otherwise finished has lost the part that makes it cheap to answer — the exact requests
   that would settle it.
5. **`README.md`** last. It is an index of what exists; written first, it indexes what was intended, and
   the difference is invisible to everyone who trusts it.
6. **The gate**, then the semantic pass — `references/validation.md`.

## Where these rules come from

| Rule | Origin |
|---|---|
| The entry condition, and announcing the mode with its evidence | Design section 17's entry conditions, and `SKILL.md`, which requires the mode and its evidence before any file is written. |
| Shared rules stay in the shared files | Design section 18, which chose one Skill with mode-specific instructions loaded on demand over two Skills, precisely so the shared rules exist once. |
| The conventions' numbering is an addressing scheme, settled first | `references/spec-layout.md`, which records that the judge rubric and the generation prompt both cite these sections by number, and that renumbering leaves the citations pointing at the wrong section with nothing else noticing. The gate's `conventions section numbering` check enforces contiguity. |
| Numbering from `01`, contiguous, no reserved gaps | Design section 17, and the gate's `AC numbering is contiguous` check; `references/unresolved.md` owns the case of a criterion that was blocked and not written. |
| Behavior tables and test data before the criteria that cite them | The gate's `endpoint containment` and `anchor links resolve` checks, which fail a criterion naming a request or a table that is not there — and the generation prompt, which forbids the agent from opening the contract, making the table the only source of a code. |
| `README.md` last, `UNRESOLVED.md` as you go | Design section 11's file list, in which the README is the reading order and the package index; and design section 14, whose entry format depends on recording the settling requests while they are still in front of you. |
