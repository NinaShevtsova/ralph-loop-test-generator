# Context and conventions — PetClinic API integration coverage

> This file is the shared foundation of the package: what is true for all flows at once. It knows
> nothing about individual flows and must be understandable without reading them. Chains, acceptance
> criteria and the test plan of each flow live in `flows/*.md` (see §5 and [`README.md`](./README.md)).

## 1. Context

The system under test is the **Spring PetClinic REST API**, an open-source project
([github.com/spring-petclinic/spring-petclinic-rest](https://github.com/spring-petclinic/spring-petclinic-rest)),
run **locally**. There are no external services or public APIs in the test perimeter.

- Start: `./mvnw spring-boot:run` (or `docker run -p 9966:9966 springcommunity/spring-petclinic-rest`).
- API base URL: **`http://localhost:9966/petclinic/api`**; the live spec is `/petclinic/v3/api-docs`
  (used as the readiness probe, §10.3).
- Database: **H2 in-memory**, profile `h2` is active by default. On every start the application runs
  `db/h2/schema.sql` and `db/h2/data.sql` (`spring.sql.init.mode=always`), so **restarting the
  application fully restores the initial data state**.
- Seeded data relevant to the tests: 10 owners, 13 pets (`Leo`, `Basil`, `Rosy`, `Jewel`, …), 4 visits,
  6 pet types. **The ids of seeded records are not fixed by the contract** — they are assigned by
  auto-increment (see §10.1).
- Authentication is **disabled** (`petclinic.security.enable=false` in `application.properties`) — a
  fixed assumption of this package, see §9.

The domain within the scope of coverage: an owner (`Owner`) owns pets (`Pet`); a pet has a type
(`PetType`) and visits (`Visit`). Vets and their specialties exist in the application but are out of
scope.

## 2. Goals

The package picks out **a few representative scenarios** where writing an integration test is actually
worthwhile, and describes them as ACs so that the generator agent can produce ready integration tests
from those ACs.

- **Select ACs with real integration between endpoints:** a chain of several requests where the output
  of one step is the input of the next, and the assertions are on data values in other representations.
  Selection criterion: an AC that is closed by a single request is not taken into the package.
- **Build on the asymmetry of the PetClinic routes** — that is what makes the integration meaningful: a
  pet can be **created only through the nested route** (`POST /owners/{ownerId}/pets`) and **deleted only
  directly** (`DELETE /pets/{petId}`); a pet can be changed, and a visit created, by two different
  routes; the same data is read both directly and inside the parent's details; deleting a parent
  cascades into child records.
- **Give the generator an unambiguous input:** every AC has explicit steps, codes and test data, and the
  "one AC = one test" traceability (see [`README.md`](./README.md)) gives the reviewing side an objective
  criterion rather than a matter of taste.
- **Guarantee a deterministic and repeatable run** — the package is meant for a loop in which the tests
  are executed many times (§10).

## 3. Non-goals

- **Completeness of coverage.** The package deliberately describes not every scenario of the
  application, but three flows with a few ACs each. A missing AC for some endpoint or case is a
  decision, not a gap: the package does not need to be extended "for completeness", the generator agent
  covers exactly the ACs listed here with integration tests.
- **Contract tests of a single endpoint.** "Send a request — check `201` or `400`", field-by-field
  validation of the response JSON schema, and separate tests for field types and requiredness are
  **not part of the package**.
- **Endpoints out of scope.** The contract also contains `/vets`, `/specialties`, `/users`, `/oops`,
  `/v2/*` — no tests are generated for them. A response code inside a chain is checked as an auxiliary
  condition, but is never the only assertion of an AC.

## 4. Glossary

| Term | Meaning |
|---|---|
| Application | The locally running instance of the PetClinic REST API |
| Flow | A group of related ACs with a common precondition, describing one kind of interaction between endpoints; one `flows/F-XX-*.md` file |
| Chain | The concrete sequence of requests inside a single AC; each next request uses data from the previous response |
| Side effect | A state change that should not have happened (for example, a record was created despite an error response) |
| Dangling reference | A record returned by the API that points at a parent which no longer exists (for example, a `Pet` of a deleted owner) |
| Directory | `PetType` — the entity that pets refer to; a change in the directory must be visible in the related records |

AC titles are written in domain language, but every AC step names the method and the path explicitly.
The full list of endpoints in use is in §7.

## 5. Flows

- [F-01](./flows/F-01-owner-lifecycle.md) — pet owner: registration, data change, deregistration.
- [F-02](./flows/F-02-owner-pet-lifecycle.md) — owner's pet: adding, changing, deleting.
- [F-03](./flows/F-03-pet-visit-flow.md) — pet visit: recording the entry and the visit history.

The AC count per flow and the reading order are in [`README.md`](./README.md).

## 6. User stories

Common to all flows — the ACs in `flows/*.md` reference these US by id instead of repeating the text.

**US-01 — Full lifecycle of an entity through the API.** As an API client I want to create an entity,
read it, change it and delete it, getting the current state at every step, so that I can manage the data
through the API without going to the database directly.

**US-02 — Data consistency across access routes.** As an API client I want a record created or changed
through one route to be readable through all the other routes with the same values, so that the nested
and the direct representations do not diverge into two independent sets of data.

**US-03 — Referential integrity between entities.** As an API client I want the API to stop returning
child records pointing at a non-existent parent once that parent is deleted, so that my code does not
receive broken references.

**US-04 — Consistency of collections and items.** As an API client I want a created record to appear in
the lists immediately and a deleted one to disappear from them, so that the list and the item always
describe the same state.

**US-05 — Keeping the service history of a client.** As a clinic administrator I want to keep the visit
history of every pet and see it both in the pet details and in the owner details, so that at the
client's next appointment I can rely on the full picture rather than on scattered records.

**US-06 — No side effects from failed requests.** As an API client I want a request that ended with an
error to leave the system state unchanged, so that no partially created data remains after the error.

## 7. API conventions

The exact schema (paths, types, field requiredness) is in
[`contracts/openapi.yaml`](./contracts/openapi.yaml). Here — only the conventions common to all
endpoints.

**Base URL:** `http://localhost:9966/petclinic/api`.
**Authentication:** none (§9). **Content-Type:** `application/json`.

### Routes and their asymmetry (the key to the integration scenarios)

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| `Owner` | `POST /owners` | `GET /owners`, `GET /owners/{ownerId}` | `PUT /owners/{ownerId}` | `DELETE /owners/{ownerId}` |
| `Pet` | **only** `POST /owners/{ownerId}/pets` | `GET /pets`, `GET /pets/{petId}`, `GET /owners/{ownerId}/pets/{petId}`, nested in `GET /owners/{ownerId}` | `PUT /pets/{petId}` and `PUT /owners/{ownerId}/pets/{petId}` | **only** `DELETE /pets/{petId}` |
| `Visit` | `POST /owners/{ownerId}/pets/{petId}/visits` **and** `POST /visits` | `GET /visits`, `GET /visits/{visitId}`, nested in `Pet.visits` | `PUT /visits/{visitId}` | `DELETE /visits/{visitId}` |
| `PetType` | `POST /pettypes` | `GET /pettypes`, `GET /pettypes/{petTypeId}` | — (not used in the ACs) | `DELETE /pettypes/{petTypeId}` |

### Data models (abridged; in full — in the contract)

| Entity | Request fields | Additional response fields | Constraints |
|---|---|---|---|
| `Owner` | `firstName`, `lastName`, `address`, `city`, `telephone` — all required | `id` (read-only), `pets[]` (read-only) | names: 1–30 characters, letters only, up to three words separated by a space, hyphen or apostrophe (a trailing period is allowed in the last name); `telephone`: **exactly 10 digits** (the schema allows up to 20 — the actual rule is stricter, see §11); `address` ≤255; `city` ≤80 |
| `Pet` | `name` (≤30), `birthDate` (`YYYY-MM-DD`), `type` (a `PetType` object with `id` and `name`) — all required | `id`, `ownerId`, `visits[]` (read-only) | `birthDate` is subject to a domain rule: not in the future and not earlier than 50 years ago (see §11); the type is resolved by `type.id` only |
| `Visit` | `description` (1–255) and `date` (`YYYY-MM-DD`) are required; `petId` — only when creating through `POST /visits` | `id` | do not submit `id` in the body: it results in a `500` (see §11) |
| `PetType` | `name` (1–80) | `id` | — |

### Response codes

The values were verified by requests against the running application and match the copy of the contract
in `contracts/openapi.yaml`.

| Operation | Code |
|---|---|
| All creating `POST`s (`/owners`, `/owners/{id}/pets`, `.../visits`, `/visits`, `/pettypes`) | `201`, the body contains the created record with an assigned `id`; a `Location` header pointing at it |
| All `PUT`s | `204`, **the response body is empty** — the result of the change is verified by a subsequent `GET` |
| All `DELETE`s | `204`; deleting the same record again — `404` |
| `GET` of an item | `200`; `404` **with no body** if the record does not exist |
| `GET` of a collection | `200` and an array; `404` **with no body** if the collection is empty |

Consequences for the tests: `404` responses carry no body — there are no fields to assert on; after a
`PUT` the state is verified by a separate `GET`; the id of a new record is taken **from the body** of
the `201` response, not from the `Location` header.

## 8. Non-functional requirements

| Aspect | Requirement | Covered by |
|---|---|---|
| Determinism and repeatability | A repeated run gives an identical result, including without restarting the application | §10, rules 1, 3–6 |
| Test independence | Every test is self-sufficient: it creates its own data and does not depend on the execution order | §10, rules 2, 7, 9 |
| Isolation from external systems | All dependencies are local; there are no network calls outside `localhost` | §1 |

## 9. Access assumptions

- Authentication in the application is **disabled** (`petclinic.security.enable=false`). This is a fixed
  assumption of the package: all ACs are written for anonymous access and contain no `401`/`403` checks.
  Enabling authorization changes the coverage perimeter (separate ACs for access would be needed) and is
  out of the current scope.
- The data is synthetic. Real personal data must not be used despite the environment being local.

## 10. Test data and environment strategy

The application is a local instance with H2 in-memory; the initial state is restored by restarting it.
Mandatory rules for the generated tests:

1. **Never rely on the concrete `id`s of seeded records.** The database contains 10 owners and 13 pets,
   so `GET /owners/1` will formally return `200` — and the test will be "green" without having verified
   anything. Every test must create the records it needs itself and work with the `id`s from the
   responses. Using literal `id`s (`/owners/1`, `/pets/3`) in the generated code counts as a generation
   defect, even if the test passes.
2. **Self-sufficient setup.** The test creates the whole parent chain it needs by itself (an owner — for
   a pet; an owner and a pet — for a visit). Reusing data created by another test is forbidden.
3. **A clean start as the reference point.** A loop iteration begins with restarting the application
   (`docker restart <container>` or another `spring-boot:run`), after which the tests wait for the
   application to become ready by polling `GET /v3/api-docs` (or `GET /pettypes`) until it responds
   successfully.
4. **Relative, not absolute, expectations about counts.** Assert "the list has grown by one record
   compared to before the creation", not "the list has 13 records". Absolute numbers tie the test to the
   seeded data and break on a repeated run without a restart.
5. **Uniqueness of the created data.** Owner last names, pet names and pet type names are generated with
   a unique suffix (a timestamp or part of a uuid) so that repeated runs do not collide with the seeded
   records or with records created earlier. The suffix must satisfy the format constraints: for last
   names — **letters only**, up to 30 characters (digits are rejected with a `400`); for pet type names
   there are no character constraints, the length is up to 80. The application does not require
   uniqueness (see §11) — this is a requirement of the tests.
6. **Clean up after yourself.** A test that created data deletes it in teardown, in the order visits →
   pets → owner → its own pet type; a `404` on records already removed by a cascade is ignored. The
   order is mandatory: an owner with two pets of the same type cannot be deleted (§11). On a clean start
   the cleanup is formally redundant, but without it a run without a restart stops being repeatable.
7. **Sequential execution.** The tests of one run share a single database and are not isolated by
   transactions. Parallel execution is not supported: assertions on the number of records in a
   collection would become non-deterministic.
8. **One AC = one test**, with the AC identifier in the test name (see [`README.md`](./README.md)).
   Parameterizing one test with several cases is not used: every case is a separate AC, otherwise a
   skipped case is invisible in the trace.
9. **An own pet type in the tests that delete an owner or assert on the directory.** Deleting a pet type
   deletes all pets of that type, and deleting an owner deletes the pet type of that owner's pet (see
   §11), therefore AC-F01-04 and AC-F02-10 must create their own type via `POST /pettypes` and use it
   only for their own pets. The remaining ACs take an existing type as the first element of the
   `GET /pettypes` response.

## 11. Verified relationship behavior

Behavior that cannot be derived from the contract was verified by requests against the running
application. The results are recorded in the flows; here is the summary that matters for all tests.

### How deletions are related

| Operation | What happens |
|---|---|
| `DELETE /visits/{id}` | only the visit is deleted; the pet and the owner are preserved |
| `DELETE /pets/{id}` | the pet **and all its visits** are deleted; the owner and the pet type are preserved |
| `DELETE /owners/{id}` — one pet | the owner, the pet and its visits are deleted, **as well as the pet type of that pet** |
| `DELETE /owners/{id}` — two pets of the **same** type | `404`, **nothing is deleted** — hence the teardown order in §10.6 |
| `DELETE /pettypes/{id}` — the type is in use | `204`; **all pets of that type and their visits** are deleted, including those belonging to other owners — hence rule §10.9 |

The cause of the cascades around the pet type is in the DB schema:
`FOREIGN KEY (type_id) REFERENCES types(id) ON DELETE CASCADE`.

### Other verified specifics

- **The application does not enforce uniqueness of values:** in the DB schema `types.name`,
  `owners.last_name` and `pets.name` only have indexes, without a `UNIQUE` constraint. Two records with
  the same name are created successfully. Uniqueness is needed by the tests themselves, not by the
  application (see §10.5).
- **The pet type is resolved by `type.id` only:** a submitted `type.name` is ignored, and the response
  carries the real name from the directory.
- **Pet birth date:** a date in the future and a date earlier than 50 years ago are rejected
  (`Birth date cannot be older than 50 years`). Today's date and exactly 50 years ago are allowed.
- **A visit date** may be in the future: a visit can be scheduled.
- **The `id` field in the body of a visit creation request** results in a `500` — the body must be built
  without `id`, even though the field is marked as required in the `Visit` schema.
- **An owner's telephone is exactly 10 digits.** The request schema allows up to 20 digits (`^[0-9]*$`,
  `maxLength: 20`), but the entity requires `^[0-9]{10}$`: a value of 11–20 digits passes schema
  validation and is rejected on save with a `500`. In all test data the telephone is strictly 10 digits.
