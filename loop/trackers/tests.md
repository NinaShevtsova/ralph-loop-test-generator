# Tracker — stage 1 (tests)

> One row per acceptance criterion, 20 rows. **One AC is one iteration** (design D-06): the judge
> verdict stays atomic and rework is routed per AC.
>
> States: `todo` · `review` · `rework` · `blocked` · `done`.
> `done` is written by the **runner** only, on a `PASS` verdict from the judge (design D-11).
> That is what keeps the progress metric out of the model's hands.
>
> Order is deliberate: **F-01 → F-02 → F-03**. F-01 touches only owners, F-02 adds pets, F-03 adds
> visits, so complexity grows and each flow reuses the shape the previous one established.
> Do not reorder.
>
> **The first row to be accepted becomes the judge's exemplar** (design §6.1). In the default run
> order that is AC-F01-01, and the judge grades it most strictly, because whatever the agent writes
> there is copied by the following iterations.
>
> Titles are verbatim from the "Test plan" tables of `docs/specs/petclinic/flows/*.md`, and
> `scripts/check-tests.mjs` compares the generated scenario title against those rows. Do not
> paraphrase them.
>
> Everything else is derived: the feature file from the group (`F-02` →
> `Features/F02-owner-pet-lifecycle.feature`), the scenario tag from the id (`@AC-F02-01`).

| ID | Group | Title | Status |
|---|---|---|---|
| AC-F01-01 | F-01 | a registered owner is visible with the submitted values both in the owner details and in the owners list, and the list has no duplicate | done |
| AC-F01-02 | F-01 | updated owner contacts are visible in the owner details and the owners list without a duplicate | done |
| AC-F01-03 | F-01 | a deregistered owner is gone from the owner details and the owners list, and deregistering again gives 404 | done |
| AC-F01-04 | F-01 | deregistering an owner removes their pet and that pet's visits | done |
| AC-F02-01 | F-02 | an added pet is visible in the owner details and in its own details with the same data | done |
| AC-F02-02 | F-02 | an added pet appears in the clinic-wide pets list | done |
| AC-F02-03 | F-02 | a rename in the pet details is visible in the owner details | done |
| AC-F02-04 | F-02 | a rename through the owner details is visible in the pet details | review |
| AC-F02-05 | F-02 | editing a pet's data does not wipe the visit history | todo |
| AC-F02-06 | F-02 | deleting one pet does not affect the owner's second pet | todo |
| AC-F02-07 | F-02 | a deleted pet cannot be opened in its own details or from the owner details | todo |
| AC-F02-08 | F-02 | a pet cannot be opened through another owner's details | todo |
| AC-F02-09 | F-02 | a pet cannot be added to a non-existent owner | todo |
| AC-F02-10 | F-02 | deleting a pet removes the visits but preserves the owner and the pet types directory | todo |
| AC-F03-01 | F-03 | a visit from the pet details is visible in the pet's history, in the owner details and in the log | todo |
| AC-F03-02 | F-03 | a visit from the clinic-wide log lands in the history of the same pet | todo |
| AC-F03-03 | F-03 | a visit can be scheduled for a future date | todo |
| AC-F03-04 | F-03 | a corrected visit description is visible in the pet's history | todo |
| AC-F03-05 | F-03 | a cancelled visit disappears from the history and the log, and cancelling again gives 404 | todo |
| AC-F03-06 | F-03 | editing one visit does not affect the pet's remaining visits | todo |

**Total:** 20 acceptance criteria — 4 in F-01, 10 in F-02, 6 in F-03.

---

## Open questions

Rows moved to `blocked` record their question here, with the AC id and one sentence. Populated at
runtime by the agent or by the runner on a `SPEC_UNCLEAR` verdict. Empty means nothing is blocked.

_None._
