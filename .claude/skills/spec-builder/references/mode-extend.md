# `extend` — three obligations, and the comparison that proves you kept them

**Entry condition:** the spec directory holds flow documents with acceptance criteria in them. Assume those
criteria already have generated, accepted, passing tests — every rule below follows from that one fact.

**This file is short on purpose.** `extend` is `create` with a stronger precondition, so the rules the two
modes share live in the files both read: `references/openapi-analysis.md`, `references/doc-analysis.md`,
`references/flow-decomposition.md`, `references/ac-rules.md`, `references/test-data.md`,
`references/unresolved.md`, `references/validation.md`, and `references/spec-layout.md` for the formats a
machine parses. Read them; nothing about them is relaxed here. What is different is three obligations at
the front and one comparison at the back.

**Before you edit anything, take a pristine copy of the package.** It is what the comparison below runs
against, and a copy taken after the first edit certifies that edit instead of catching it.

**The one example below** comes from a domain unrelated to every other example in these files, and
deliberately does not combine with them into a package.

## 1. Inherit the conventions; do not improve them

Read `context-and-conventions.md` and every existing flow document before writing anything. Then keep what
you find: the section numbering, the heading names, the step wording, the id format, the way the response
codes are tabulated, the data strategy. Do not restyle, renumber, reword or tidy.

An improvement to a convention is a change to a package whose criteria already have accepted tests.
Rewording a criterion silently changes what its existing test proves, while the test stays green.
Renumbering the conventions leaves the judge rubric's and the generation prompt's citations pointing at the
wrong section, and nothing compares the two. If a convention is genuinely wrong, that is a finding for the
report and a decision for a human — not an edit you make on the way past.

## 2. Do not duplicate — compare by chain and field set, never by title

Check every candidate against **every** existing criterion in the package, not only against the ones in the
flow you expect to touch. The comparison is a two-part key: the ordered list of the criterion's requests as
method plus path *shape*, and the set of field names its `Then`s assert on. Titles differ freely and
motivations differ freely; neither makes two criteria different.

In a radio-spectrum licensing service, `a transmitter registered under a licence appears in the licence's
transmitter list` and `the spectrum officer sees a newly registered transmitter in the transmitter list`
are one criterion: the same three requests, and the same asserted fields — `transmitterId`, `licenceId`,
`registeredOn`, `active`. Written as two, the loop generates two tests, the second consumes an agent turn
and a judge turn, and its verdict is then read as information about coverage that it does not carry.

## 3. Say which flow the coverage belongs to, and why

Decide between an existing flow whose precondition already fits and a new flow, and write the decision and
its reason into the package. The test is the one `references/flow-decomposition.md` states: does the
candidate need everything that flow's precondition builds, and nothing the precondition does not build?

Dropping a criterion into a flow whose precondition nearly fits is what forces an exception, and an
exception is the most expensive thing in a package to get wrong — it has to carry its reason and its blast
radius, or the next reader tidies it away and the damage surfaces as an unrelated test failing later.

## Then: append, never rewrite, and prove it

Numbering continues from the last id in each flow, contiguous, with no gaps. Files are appended to.
Existing criteria, their Test plan rows and the conventions keep every byte they had.

Prove it rather than asserting it — the same invocation as any other run, with the pristine copy added:

    node <path-to-this-skill>/check-spec.mjs --spec <spec-dir> --baseline <pristine-copy>

That argument adds two of the gate's checks: the comparison itself, and a guard that refuses a baseline
with no criteria in it, because a comparison against nothing would otherwise report an append-only change
it never verified. `references/spec-layout.md` names both.

**What that comparison catches that nothing else does:** a renamed Test plan entry. The row is still there,
still exactly one per criterion, still matched to a criterion body, and the ids are still contiguous — so
every other check stays green. But the Test plan row carries the exact name of the generated test, and the
downstream test gate reads that name and compares it to the scenario's title, so the rename demands a
scenario title that no existing test has. **An already-passing test goes red, and nothing in the package
looks any different.** The same comparison catches the two neighbouring damages: rewording a criterion's
body changes what its accepted test proves while the test stays green, and removing a criterion orphans a
test that already passed.

There is exactly one amendment this comparison legitimately reports, and the rule for it — a criterion a
judge verdict reported as admitting two readings, which therefore has no accepted test — is in
`references/unresolved.md`. Every other reported difference is a defect in this turn.

## What `extend` outputs

The new criteria, and for each one **which coverage gap it closes** — named against the operation coverage
matrix from `references/validation.md`, so a reader can see the package moved rather than grew. Plus the
gate's result including the comparison, any convention you believe is wrong and did not change, and every
question that went to `UNRESOLVED.md` instead of becoming a criterion.

## Where these rules come from

| Rule | Origin |
|---|---|
| Assume the existing criteria have accepted tests | Design section 17: `extend`'s entry condition is a package with criteria, and the loop marks a criterion done only when its test has passed the judge. |
| Inherit the conventions, do not restyle | Design section 17 and decision D-5, which makes append-only a property the validator enforces rather than a promise. `SKILL.md` states the consequence: rewording a criterion silently changes what its already-accepted test proves. |
| Take the pristine copy first | The gate's `--baseline` argument compares against a directory you supply; `references/spec-layout.md` also records `the baseline holds criteria`, which refuses a baseline that is not a spec package, because a comparison against nothing would report an append-only change it never verified. |
| Dedup by chain and asserted field set, across the whole package | Design section 8F, carried into `references/ac-rules.md`: two criteria are duplicates when the chain and the set of asserted fields coincide, and differing motivation does not make them different. Judge item 16 grades the other end of it — a scenario verifies exactly its own criterion. |
| Decide the flow by whether the precondition fits | Design sections 7 and 9, in `references/flow-decomposition.md`: one flow is bounded by a single shared precondition, read in both directions. |
| An exception carries its reason and its blast radius | The same file, from the reference package's own precondition, whose exception exists to prevent a shared-directory entry being deleted by a test that only read it. |
| Numbering continues without gaps; append only | Design section 17, and the gate's `AC numbering is contiguous`, `AC ids are unique` and `baseline is unchanged` checks. |
| A renamed Test plan entry is the damage only this comparison sees | `references/spec-layout.md`: the Test plan row carries the exact test name and a regular expression downstream reads it out and compares it to the generated scenario title. Renaming it turns a passing test red while every other check stays green. |
| Output the new criteria and the gap each closes | Design section 17's output row for `extend`, and design section 13's coverage matrix, which is what a gap is named against. |
