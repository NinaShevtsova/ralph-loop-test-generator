# Unresolved behavior — the question is written down instead of the criterion

**Behavior that could not be verified does not become a criterion.** That is the rule, and everything
below is either why it holds or how to write the question instead.

## The asymmetry, in the loop's own arithmetic

A criterion you did not write because nobody could answer the question costs **one conversation with a
human.** They answer it, an `extend` turn appends the criterion, and nothing that already passed changes.
The cost is bounded and it is paid once.

A criterion you wrote on a guess costs a test that fails for a **specification** reason, and that cost is
not bounded. It arrives by one of three routes, and none of them is cheap:

- **The API disagrees with the guess.** The agent transcribes the criterion faithfully and the test is
  red, so the runner's gate ends the turn before the judge is invoked at all and the row goes to rework.
  The agent is then asked to fix a test that cannot pass, because what is wrong is what it was told to
  assert, and it has no right to change that. The stall is not the worst of it: the agent is measured on a
  green suite, so the move available to it is to weaken the assertion until it passes — after which the
  criterion has a green test that asserts less than the criterion says, and nothing in the run says so.
- **The criterion admits two readings and the scenario picks one.** The judge returns the verdict that
  reports the specification as unclear, the row is blocked and a human is asked. That is the loop's
  designed exit and it works, and it costs exactly the conversation you were avoiding, several turns later.
- **The guess happens to match the API.** Green, accepted, and this is the expensive one. The test proves
  that nothing was checked; the guess now sits in the package looking exactly like the facts around it that
  were measured; and the next turn that extends the package builds on it. If it is the earliest accepted
  scenario it also becomes the exemplar every later scenario is copied from, so one wrong belief is
  propagated as approved style.

**No amount of rework can fix a test whose specification is wrong.** Rework is the only tool the loop has
for a red gate or a rejection, and it is pointed at the test.

**This is the same asymmetry the loop's judge runs on**, and it was written down there first: when
uncertain, return the rejection, because a wrongly rejected scenario costs one iteration while a wrongly
accepted one ships a lie into the deliverable and is copied by the iterations that follow. Your version
of that rule is this file.

## What becomes an entry

Three situations, and only three:

1. **Nothing could be measured** — there is no reachable instance, so everything the contract does not
   state is `unknown`. This is the common case and it is not a failure of the run: a package that says so
   is usable, and one that fills the silence with plausible behavior is not.
2. **The instance could not be brought to the state the question needs** — the precondition itself is not
   reachable, so the behavior at that state stays unobserved even though the service is up.
3. **Two sources contradict each other and neither settles it** — a measurement that disagrees with the
   contract is *not* this case; `measured` wins and `references/openapi-analysis.md` owns recording both.
   This case is documentation against documentation, or one measurement that could not be repeated.

**About the examples below.** They come from two unrelated domains on purpose — a vehicle-rental service
in one place, a wind-farm maintenance service in another — and they deliberately do not add up to one
package. What travels between projects is the six-part shape of an entry and the question each part
answers. The entities do not, and nothing in this file knows what an entity in your project is called.

**No check reads this file.** The gate does not require it and does not parse it, so a malformed entry
fails silently by simply never being answered. Every other format in the package is held up by a check;
this one is held up by you.

## The six parts of an entry

The heading carries an id and a one-line statement of what is unknown — `## UR-nn — <what is unknown>` —
because the id is what a criterion, a report and a reply can all name; without one the entry gets referred
to by paraphrase, and two people paraphrase the same question differently. Under that heading, six parts.
Each exists because a specific reader needs it, and each one left out has a specific cost.

1. **`Contract says:`** — what the contract states about this operation, and where it is silent. Silence
   named explicitly is information; silence left out looks like an omission in your reading, and the
   answerer starts by re-reading the contract you already read.
2. **`Documentation says:`** — the same for tickets, README and source. **"Nothing" is an answer worth
   writing.** It says the behavior is not written down anywhere and cannot be found by reading, which is
   what stops the question being sent back to you as a request to look harder.
3. **`Why this is needed:`** — which criterion this blocks, and what each possible answer would make that
   criterion assert. This is the part that makes the question urgent instead of interesting. An entry that
   does not name what it blocks is deferred indefinitely and correctly, because nothing depends on it that
   anyone can see.
4. **`Question:`** — one question, phrased so that an answer settles it. Not a list, and not a
   paragraph ending in a question mark. Two questions in one entry come back with one answer, and you
   cannot tell which one it settled.
5. **`To settle it:`** — the exact requests, in order, that would produce the answer. **This is the part
   that turns an investigation into minutes.** The person who knows the answer usually knows it as
   behavior rather than as a sentence, and the fastest route from their knowledge to a written fact is a
   sequence they can run. Without it the entry is a research task, and research tasks wait.
6. **`Status:`** — that it blocks a named criterion, and that the criterion is not written. A status line
   naming no criterion leaves nobody able to tell, later, whether the question was ever answered.

## A worked entry

In a vehicle-rental service, where returns and damage reports were built at different times:

```markdown
## UR-04 — returning a rental while a damage report on it is still open

**Contract says:** `POST /rentals/{rentalId}/return` → `200` with the closed agreement, `409` with no
body if the agreement is already closed. Damage reports live under
`/rentals/{rentalId}/damage-reports` with a `status` of `open` or `settled`. Nothing in either schema
mentions the other.
**Documentation says:** nothing. The ticket that asked for returns is older than the one that added
damage reports, and neither mentions the interaction.
**Why this is needed:** the next criterion of this flow would assert either `409` with the agreement
still open and the report untouched, or `200` with the agreement closed and the report still open — and
if it is the second, whether the report stays reachable at all. Those are opposite tests, and the
`Then` of each contradicts the other.
**Question:** may a rental be returned while one of its damage reports has `status: open`, and if it
may, does that report remain open and reachable afterwards?
**To settle it:** `POST /rentals` → `POST /rentals/{rentalId}/damage-reports` with `status: open` →
`POST /rentals/{rentalId}/return` → `GET /rentals/{rentalId}/damage-reports/{reportId}`.
**Status:** BLOCKS AC-F02-07 (not written).
```

Read what that entry gives its answerer: the two candidate readings, so they can recognise which one they
are describing; the sequence, so they can check rather than recall; and the criterion it blocks, so the
answer has a deadline.

## The id you name must not leave a hole

The gate requires criterion numbering to be **contiguous** from `01` within each flow, so the id in a
`Status:` line has to be the **next one after the last criterion actually written in that flow** — never
one reserved in the middle of the sequence.

Reserving an id mid-sequence turns the package red on a check that reads as a mistake rather than as a
deliberate hole, and a package that fails the gate cannot be handed to the loop at all — so a blocked
criterion would stop the criteria around it from ever being generated. Number what you wrote,
contiguously; name the first free id in the entry. **Several entries may be open in one flow at once** — the
trial run produced eight in a single flow — so allocate those ids as you write the entries, in order, rather
than assuming they will be answered in the order you wrote them. When the answer arrives, the `extend` turn appends the
criterion at that id and nothing renumbers, which is exactly the property `extend` needs.

## What is not an entry here

`UNRESOLVED.md` is read by a human who has to decide which questions to chase. Everything in it that does
not block a criterion makes the ones that do harder to find. In a wind-farm maintenance service:

| Not an entry | Where it goes instead |
|---|---|
| which turbine model a work order should name in test data | a free choice: pick one and put it in the test-data table |
| whether `POST /work-orders` really returns `201`, when the contract says so and no measurement disagrees | the criterion, tagged `contract`; a contract is authority for declared codes |
| whether the package should cover the technician-roster endpoints at all | the coverage matrix and a human ruling, per `references/validation.md` — that is a scope decision, not unknown behavior |
| whether the tests should assert on the work-order list or on the turbine's own history | a question about the tests, decided by the criterion you are writing |
| a field whose maximum length the contract states and a measurement contradicts | the package, carrying both readings and which one test data follows, per `references/openapi-analysis.md` |

One distinction decides all of them: an entry here is **behavior of the API that nobody can state**. A
free choice, a scope decision, and a contradiction one of the sources already wins are all yours to
resolve.

## The loop back: a `SPEC_UNCLEAR` verdict is a report about the spec

The generating loop's judge returns one of three verdicts, and the third one is about your work rather
than the agent's. `SPEC_UNCLEAR` is returned when the **criterion itself** admits two readings and the
judge would otherwise reject a scenario that is a defensible interpretation of it. The runner then marks
that row blocked and records the question, and the turn does **not** go back to the agent — deliberately,
because neither the agent nor the judge may answer an ambiguity in the specification.

So a `SPEC_UNCLEAR` is a measurement of this Skill's output: a criterion that shipped carrying two
readings, caught downstream at the only point where two readings become visible. It is **valid input to
`extend`**: the ambiguity is resolved in the spec, not worked around in the tests. Treat the verdict text
as the analysis it is — it names the two readings — then establish which one is real by the same rules as
any other unknown: measure it, or write an entry here and ask.

**One consequence about `extend` belongs here**, because it is the one case where two rules of this Skill
pull against each other. `extend` appends and never rewrites, and the gate's baseline comparison holds
every pre-existing criterion byte for byte. A criterion a `SPEC_UNCLEAR` names has **no accepted test** —
its row is blocked, nothing passed against it — so the wording that comparison is protecting is
protecting nothing. Amending exactly that criterion is legitimate; hiding the amendment is not. Run the
comparison anyway, expect exactly one reported difference, confirm it names that criterion and no other,
and report the amendment with the verdict that caused it. Skipping the comparison to avoid one expected
difference also stops it protecting the criteria that *do* have passing tests, which is the whole reason
it exists.

## Where these rules come from

Each rule traces to the design this Skill implements, the loop it feeds — its judge rubric and the runner
that acts on the verdicts — or the one reference package these rules were measured against. A rule whose
origin cannot be named is an opinion, and an opinion in a file a model reads as instruction is worse than
silence.

| Rule | Origin |
|---|---|
| Behavior that could not be verified does not become a criterion | Design section 14, stated as the Skill's one inviolable rule and repeated in `SKILL.md`. The reference package needed a whole numbered section of behavior established by request precisely because none of it followed from the contract. |
| The asymmetry: a question costs a conversation, a guess costs a red test rework cannot fix | The judge rubric's own asymmetry section — when uncertain, reject, because a wrong rejection costs one iteration and a wrong acceptance ships a lie and is copied by later iterations as approved style. The loop's turn protocol supplies the rest: a red gate after a turn sends the row to rework with the judge never invoked, and rework is handed back to the agent, which may rewrite only the test. |
| A wrongly accepted guess propagates as style | The loop's exemplar rule: the earliest accepted scenario is what every later scenario is graded and copied against, so a mistake in the first turn is inherited by every turn after it. |
| The six parts of an entry | Design section 14's worked entry, part for part. |
| `Nothing` is an answer worth writing under `Documentation says:` | The same entry, which records documentation silence explicitly rather than omitting the line. `references/doc-analysis.md` owns why documentation cannot establish behavior in the first place. |
| The requests that would settle it | Design section 14; and `references/openapi-analysis.md`, whose third group is the list of things only a request can establish — validation stricter than the schema, cascades, whether an error carries a body, what an empty collection returns, ordering. |
| The blocked criterion's id must not leave a hole | The gate's `AC numbering is contiguous` check, documented in `references/spec-layout.md`: a gap reads as a criterion someone forgot to write, and the package fails the gate rather than being handed to the loop. |
| Scope decisions and free choices are not entries | Design section 13 and `references/validation.md`: completeness is reported to a human as a matrix, and a missing criterion is a decision rather than a gap. Mixing those into the questions makes the blocking ones unfindable. |
| No check reads this file | `references/spec-layout.md`: `UNRESOLVED.md` is not required by the gate and nothing parses it. |
| `SPEC_UNCLEAR` routes to a human and is valid input to `extend` | Design section 14, and the judge rubric's output section, which defines the verdict as the criterion admitting two readings and states that neither the agent nor the judge may answer an ambiguity in the specification. The runner's status table completes it: that verdict moves the row to blocked and copies the question out, and only the runner may ever mark a row done. |
| The one amendment the baseline comparison tolerates | D-5, enforced by the gate's `baseline is unchanged` check, whose stated purpose in `references/spec-layout.md` is that rewording an accepted criterion changes what its existing test proves. A blocked criterion has no such test. `references/mode-extend.md` owns the invocation. |
