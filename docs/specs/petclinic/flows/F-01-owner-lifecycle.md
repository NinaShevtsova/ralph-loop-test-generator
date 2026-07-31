---
depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml", "./F-02-owner-pet-lifecycle.md", "./F-03-pet-visit-flow.md"]
---

# Flow F-01 — Pet owner: registration, data change, deregistration

## What the flow verifies

The full path of a single owner: registration, appearance in the owners list, change of contact
details, deregistration. Deregistration is also checked for what it takes with it: the owner's pet and
that pet's visits must not outlive their owner as records pointing at someone who no longer exists.

## Chain

`POST /owners` → `GET /owners/{ownerId}` → `GET /owners` → `PUT /owners/{ownerId}` →
`GET /owners/{ownerId}` → `DELETE /owners/{ownerId}` → `GET /owners/{ownerId}` (404) → `GET /owners`

Cascade branch (AC-F01-04): `POST /pettypes` → `POST /owners` → `POST /owners/{ownerId}/pets` →
`POST /owners/{ownerId}/pets/{petId}/visits` → `DELETE /owners/{ownerId}` →
`GET /owners/{ownerId}` + `GET /pets/{petId}` + `GET /visits/{visitId}` + `GET /pets` + `GET /visits`

## Common precondition (setup)

- The application is running and responding.
- No seeded `id`s are used: all identifiers are taken from API responses.
- Field values in all ACs of this flow are taken from the "Test data — owner" table below. AC-F01-04
  additionally needs a pet and a visit: their fields are taken from
  ["Test data — pet"](./F-02-owner-pet-lifecycle.md#test-data--pet) in F-02 and
  ["Test data — visit"](./F-03-pet-visit-flow.md#test-data--visit) in F-03.
- **AC-F01-04 creates its own pet type** (`POST /pettypes` with a unique name) and uses it only for its
  own pet. Deleting an owner also deletes the pet type of that owner's pet, so a shared directory entry
  would make the result depend on other tests' data. Teardown for that AC: delete whatever survived the
  checks in the order visits → pets → owners → pet types, ignoring `404` on records already removed by
  the cascade.

## Test data — owner

All five fields are required. Constraints come from `contracts/openapi.yaml`, schema `OwnerFields`.

| Field | Constraint | Example of a valid value |
|---|---|---|
| `firstName` | 1–30 characters, **letters only**; a space, hyphen or apostrophe is allowed between words, up to three words in total (pattern `^[\p{L}]+([ '-][\p{L}]+){0,2}$`) | `Anna` |
| `lastName` | same as `firstName`, plus a trailing period is allowed. For tests: a base word + a **letter-based** unique suffix (digits are not allowed in the last name) | `Testownerqwe` |
| `address` | a non-empty string, up to 255 characters | `110 W. Liberty St.` |
| `city` | a non-empty string, up to 80 characters | `Madison` |
| `telephone` | **exactly 10 digits**, no other characters allowed | `6085551023` |

A unique `lastName` is needed so that repeated runs against the same application do not pile up
indistinguishable owners. The owner is located in the owners list by `id`, not by the last name.

## API behavior used in this flow

| Request | Response |
|---|---|
| `POST /owners` | `201`, the body contains the created owner with an assigned `id` |
| `GET /owners` | `200` and an array of owners; `404` with no body if no owner is found |
| `GET /owners/{ownerId}` | `200` and the owner together with the `pets` array; `404` with no body if the owner does not exist |
| `PUT /owners/{ownerId}` | `204`, **empty body**; `404` if the owner does not exist |
| `DELETE /owners/{ownerId}` | `204`; deleting the same `id` again — `404` |
| `DELETE /owners/{ownerId}` — the owner has one pet with visits | `204`; the pet and its visits become unavailable (`404`) |
| `POST /pettypes` | `201`, the body contains the created pet type with an assigned `id` |
| `POST /owners/{ownerId}/pets` | `201`, the body contains the pet with an assigned `id` and an `ownerId` |
| `POST /owners/{ownerId}/pets/{petId}/visits` | `201`, the body contains the visit with an assigned `id` and a `petId` |
| `GET /pets/{petId}` | `200` and the pet with its `type` and `visits`; `404` with no body if the pet does not exist |
| `GET /visits/{visitId}` | `200` and the visit with its `petId`; `404` with no body if the visit does not exist |
| `GET /pets` | `200` and an array of all pets in the clinic |
| `GET /visits` | `200` and an array of all visits in the clinic |

Since `PUT` does not return a body, the result of the change is verified by a subsequent `GET`. `404`
responses contain no body — there are no fields to assert on.

## Acceptance criteria

| AC | US | What is verified |
|---|---|---|
| AC-F01-01 | US-01, US-02, US-04 | a registered owner is visible with the submitted values both in the owner details and in the owners list, and the list has no duplicate |
| AC-F01-02 | US-01, US-02 | Updated owner contacts are visible in both the owner details and the owners list, and no duplicate owner appears |
| AC-F01-03 | US-01, US-03, US-04 | A deregistered owner is gone from both the owner details and the owners list, and deregistering again reports that no such owner exists |
| AC-F01-04 | US-01, US-03 | Deregistering an owner also removes their pet and that pet's visits, leaving no records pointing at the removed owner |

---

### AC-F01-01 — a registered owner is visible with the submitted values both in the owner details and in the owners list, and the list has no duplicate

**US:** US-01, US-02, US-04
**Why this matters:** the administrator registers an owner on one screen but works with them on two
others: opens the owner details by a direct link and finds the entry in the owners list. If the owner
details return something other than what was saved, the administrator works with incorrect contact
details; if the owner does not appear in the list, the administrator registers them again and creates a
duplicate.

**Given** a valid owner with a unique last name — values per the
["Test data — owner"](#test-data--owner) table

**Step 1 — register the owner**
**When** `POST /owners` with the body from Given
**Then** code `201`; the body contains the assigned `id` and all five submitted fields with the values
that were sent; the `pets` field is present and is an empty array (there are no pets yet). Save `id` as
`ownerId`.

**Step 2 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; `id` equals `ownerId`; `firstName`, `lastName`, `address`, `city`, `telephone`
equal the values from Given; `pets` — an empty array; the body fully matches the response body of
step 1 — registration did not save any state other than what it returned.

**Step 3 — find the owner in the owners list**
**When** `GET /owners`
**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — registration did
not create a duplicate; its `firstName`, `lastName`, `address`, `city`, `telephone` match the response
body of step 1.

---

### AC-F01-02 — updated owner contacts are visible in both the owner details and the owners list, and no duplicate owner appears

**US:** US-01, US-02
**Why this matters:** the owner reported a new address and phone number. The change must be visible in
all the places where the administrator looks at the owner, and must not spawn a second owner for the
same person.

**Given** a valid owner is registered (`ownerId` from the registration response); new `city` and
`telephone` are prepared per the ["Test data — owner"](#test-data--owner) table

**Step 1 — change the owner's data**
**When** `PUT /owners/{ownerId}` with a body where `city` and `telephone` are new, and `firstName`,
`lastName`, `address` are the previous ones
**Then** code `204`; the response body is empty.

**Step 2 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; `city` and `telephone` — the new values; `firstName`, `lastName`, `address` — the
previous ones; `id` equals `ownerId`; `pets` — an empty array: changing contacts does not affect the
set of pets.

**Step 3 — view the owners list**
**When** `GET /owners`
**Then** code `200`; the list contains **exactly one** entry with `id == ownerId` — no second owner
for the same person appeared; it contains the new `city` and `telephone`; there is no entry in the
list with the previous `city` and `telephone` from Given.

---

### AC-F01-03 — a deregistered owner is gone from both the owner details and the owners list, and deregistering again reports that no such owner exists

**US:** US-01, US-03, US-04
**Why this matters:** after deregistration the administrator must not see the owner either in the list
or by a direct link, and a repeated attempt must report honestly that the owner no longer exists
instead of pretending the operation succeeded.

**Given** a valid owner without pets is registered (`ownerId` from the registration response)

**Step 1 — deregister the owner**
**When** `DELETE /owners/{ownerId}`
**Then** code `204`; the response body is empty.

**Step 2 — attempt to open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `404`; the response body is empty.

**Step 3 — view the owners list**
**When** `GET /owners`
**Then** code `200`; there is no entry with `id == ownerId` in the list; at the same time other owners
are present in the list — deregistering one client did not clear the owners list.

**Step 4 — deregister the same owner again**
**When** `DELETE /owners/{ownerId}`
**Then** code `404` — the system reports that no such owner exists.

---

### AC-F01-04 — deregistering an owner also removes their pet and that pet's visits

**US:** US-01, US-03
**Why this matters:** when a client stops being served by the clinic, their record goes away together
with their animals' data. If the pets or the visits survive, they point at an owner who no longer
exists: the administrator sees an animal whose owner cannot be opened.

**Given** a pet type is created (`petTypeId`, a unique name, used by this test only); an owner is
registered (`ownerId`); the owner has one pet (`petId`) of that type; the pet has one visit (`visitId`)

**Step 1 — confirm the initial state**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the `pets` array contains one element with `id == petId`; its `visits` array
contains an entry with `id == visitId`.

**Step 2 — deregister the owner**
**When** `DELETE /owners/{ownerId}`
**Then** code `204`.

**Step 3 — attempt to open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `404`; the response body is empty.

**Step 4 — attempt to open the pet**
**When** `GET /pets/{petId}`
**Then** code `404`; the response body is empty — the pet was removed together with its owner.

**Step 5 — attempt to open that pet's visit**
**When** `GET /visits/{visitId}`
**Then** code `404`; the response body is empty.

**Step 6 — view the clinic-wide pets list and visits list**
**When** `GET /pets`, then `GET /visits`
**Then** both requests return code `200`; there is no entry with `id == petId` in the pets list; there
is no entry with `id == visitId` in the visits list.

## Test plan

The level is **integration** everywhere (real HTTP requests to the locally running application). Each
test creates its own data in setup and deletes it in teardown. One AC — one test; parameterization is
not used so that a skipped case is visible in the trace.

| AC | Test | Level | Expected run result |
|---|---|---|---|
| AC-F01-01 | `AC-F01-01: a registered owner is visible with the submitted values both in the owner details and in the owners list, and the list has no duplicate` | integration | green |
| AC-F01-02 | `AC-F01-02: updated owner contacts are visible in the owner details and the owners list without a duplicate` | integration | green |
| AC-F01-03 | `AC-F01-03: a deregistered owner is gone from the owner details and the owners list, and deregistering again gives 404` | integration | green |
| AC-F01-04 | `AC-F01-04: deregistering an owner removes their pet and that pet's visits` | integration | green |
