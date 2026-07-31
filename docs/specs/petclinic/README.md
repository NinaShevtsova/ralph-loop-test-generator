---
status: Draft (in review)
owner: "n.shevtsova"
reviewers: []
updated_at: "2026-08-05"
feature_size: "M"
target_system: "Spring PetClinic REST API (run locally, http://localhost:9966/petclinic/api)"
consumer: "AI SDET agent — generator of API integration tests"
---

# Spring PetClinic REST — specification for the Test Generation Agent (API integration tests)

The `docs/specs/petclinic/` folder **as a whole** is the specification of integration test coverage for a
locally running Spring PetClinic REST API. No single file inside it is "the whole spec": this `README.md`
only ties the files together and defines the reading order.

## Subject of coverage

What is covered are **chains of interaction between endpoints**, not individual endpoints. The unit of
coverage is a flow: a sequence of requests where the result of one step is the input of the next. The set
is **representative, not exhaustive**: the selected scenarios are the ones where an integration test is
worth writing (see [`context-and-conventions.md`](./context-and-conventions.md) §2–§3).

- **Not covered:** the contract of a single endpoint ("`POST /owners` returns `201` and an object with an
  `id`") — the schema is guaranteed by the fact that the application is generated from the contract
  ([`context-and-conventions.md`](./context-and-conventions.md) §3).
- **Covered:** "registered an owner → added a pet to them → the pet with the same values is visible both
  in the owner details and in its own details → deleted the pet → it is not returned by any route, and the
  owner is left with an empty pets list".

The response code is an auxiliary check. The target assertion is on **data values and the presence or
absence of a record in the related representations**.

## Package structure

| File | Responsible for | AC |
|---|---|---|
| [`context-and-conventions.md`](./context-and-conventions.md) | Environment, goals and non-goals, glossary, US-01…US-06, API conventions (routes, models, codes), test data strategy, verified relationship behavior | — |
| [`contracts/openapi.yaml`](./contracts/openapi.yaml) | The exact wire contract: endpoints, request and response schemas, codes | — |
| [`flows/F-01-owner-lifecycle.md`](./flows/F-01-owner-lifecycle.md) | Pet owner: registration, data change, deregistration, the cascade on deregistration | 4 |
| [`flows/F-02-owner-pet-lifecycle.md`](./flows/F-02-owner-pet-lifecycle.md) | Owner's pet: adding, changing through two routes, deleting, the cascade on visits | 10 |
| [`flows/F-03-pet-visit-flow.md`](./flows/F-03-pet-visit-flow.md) | Pet visit: two ways of recording, the visit history, cancellation, independence of records | 6 |

In total: **3 flows, 20 acceptance criteria**.

## Reading order for the generator

`context-and-conventions.md` → `contracts/openapi.yaml` → the required `flows/F-XX-*.md`. Each flow file is
an independent generation unit and can be handed to a separate subagent.

The dependency is one-way: the flows rely on the context and the contract (`depends_on` in their
frontmatter), there is no dependency back. The flows are independent of each other — each creates its own
data in setup; the links between flows exist only to avoid repeating the test data description.

## Acceptance criterion format

1. **Title** — in domain language: what exactly is being verified.
2. **`US`** — traceability to a user story.
3. **Why this matters** — whose workflow breaks if the check does not hold.
4. **Given** — the initial state and the data obtained **from API responses**, without literal `id`s.
5. **Steps** — a pair of `When` (exactly one request) and `Then` (an assertion on the result of **that
   very** request and whatever is saved for the next step). There are no "first all the requests, then all
   the assertions" blocks in the package.

Expected codes are stated explicitly in the steps; the per-flow summary is in its "API behavior used in
this flow" table. All values in those tables were verified by requests against the running application.

## Mandatory traceability rule

**One AC = one test.** The AC identifier (for example `AC-F02-03`) must be present in the name of the
generated test — this is the only mechanism to check that the agent has not skipped anything and to map
run results back to the requirements. Parameterizing one test with several cases is not used: every case is
a separate AC, otherwise a skipped case is invisible in the trace.

## About the contract

`contracts/openapi.yaml` is a copy of the application's contract, brought in line with its actual
behavior: `201` with a `Location` header for creating operations, `204` with no body for `PUT` and
`DELETE`, `404` with no body, and `404` for list `GET`s on an empty collection. The request schemas and
validation rules match the original — request bodies are built from them directly.

Two behaviors are not derivable from the contract and shape part of the ACs — both are described in
[`context-and-conventions.md`](./context-and-conventions.md) §11: the cascading deletion around the pet
type (because of it AC-F01-04 and AC-F02-10 create their own pet type) and the `id` field in the body of
`POST /visits`, submitting which results in a `500`.

Besides `/owners`, `/pets`, `/visits` and `/pettypes`, the contract also contains endpoints that are out of
scope (`/vets`, `/specialties`, `/users`, `/oops`, `/v2/*`) — no tests are generated for them.
