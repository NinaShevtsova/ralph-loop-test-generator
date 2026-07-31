---
depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml"]
---

# Flow F-03 — Pet visit: recording the entry and the visit history

## What the flow verifies

A visit is the only entity that can be recorded in **two independent ways**: from the pet details (the
owner and the pet are given in the address) and in the clinic-wide visits log (the pet is given in the
request body). A recorded visit is visible in three places: in the pet's visit history, in the owner
details (inside their pet) and in the clinic's visits log. The flow verifies that both ways create
equivalent records and that the visit is displayed identically everywhere.

## Chain

`GET /pettypes` → `POST /owners` → `POST /owners/{ownerId}/pets` →
`POST /owners/{ownerId}/pets/{petId}/visits` → `GET /visits/{visitId}` + `GET /pets/{petId}` +
`GET /owners/{ownerId}` + `GET /visits` → `POST /visits` → `PUT /visits/{visitId}` →
`DELETE /visits/{visitId}` → repeated reads

## Common precondition (setup)

- The application is running and responding.
- No seeded `id`s are used: the owner, the pet, the pet type and the visit are taken from API responses.
- The owner is created according to the preconditions of flow [F-01](./F-01-owner-lifecycle.md), the pet
  — according to the preconditions of flow [F-02](./F-02-owner-pet-lifecycle.md).
- Teardown: delete the recorded visits (`DELETE /visits/{visitId}`), then the pet
  (`DELETE /pets/{petId}`), then the owner (`DELETE /owners/{ownerId}`).

## Test data — visit

| Field | Constraint | Example of a valid value |
|---|---|---|
| `description` | a non-empty string, from 1 to 255 characters; in tests — unique, so that the visit can be found in the log | `Rabies shot qwerty` |
| `date` | a date in `YYYY-MM-DD` format. **Required:** without it the request is rejected. A date in the future is allowed — a visit can be scheduled | `2026-07-01` |
| `petId` | only when recording in the clinic-wide log: the identifier of an existing pet from an API response | the value from the `POST /owners/{ownerId}/pets` response |
| `id` | **do not submit.** The identifier is assigned by the server. Note: in the `Visit` schema referenced by the body of `POST /visits` the `id` field is marked as required, but submitting `id` results in a `500` response — the request body must be built without it | — |

## API behavior used in this flow

| Request | Response |
|---|---|
| `POST /owners/{ownerId}/pets/{petId}/visits` | `201`, the body contains the visit with an assigned `id` and the fields `petId`, `date`, `description`; header `Location` = `/api/visits/{id}` |
| `POST /visits` (the clinic-wide log, `petId` in the body) | `201`, the body contains the visit with an assigned `id` and the same `petId` |
| `GET /visits/{visitId}` | `200`, the visit with its `petId`, `date`, `description`; `404` with no body if the visit does not exist |
| `GET /visits` | `200`, an array of all visits in the clinic; `404` with no body if there are no records |
| `GET /pets/{petId}` | `200`; the `visits` array contains all visits of this pet |
| `GET /owners/{ownerId}` | `200`; the pet inside the `pets` array carries the same `visits` array |
| `PUT /visits/{visitId}` | `204`, empty body. The request body must carry **both `date` and `description`**: without the date the request is rejected |
| `DELETE /visits/{visitId}` | `204`; deleting the same `id` again — `404` |

## Acceptance criteria

| AC | US | What is verified |
|---|---|---|
| AC-F03-01 | US-05, US-02 | A visit recorded from the pet details is immediately visible in the pet's history, in the owner details and in the visits log |
| AC-F03-02 | US-05, US-02 | A visit recorded in the clinic-wide log lands in the history of the same pet as one recorded from its details |
| AC-F03-03 | US-05 | A visit can be scheduled for a future date |
| AC-F03-04 | US-05, US-02 | A corrected visit description is immediately visible in the pet's visit history |
| AC-F03-05 | US-01, US-03 | A cancelled visit disappears from the pet's history and from the log, the pet and the owner are not affected, and cancelling again reports that the record does not exist |
| AC-F03-06 | US-05, US-02 | Editing one visit record does not affect the pet's remaining visits |

---

### AC-F03-01 — a visit recorded from the pet details is immediately visible in the pet's history, in the owner details and in the visits log

**US:** US-05, US-02
**Why this matters:** the visit is recorded by the administrator from the pet details, the vet then opens
that pet's history, and the manager looks at the clinic's visits log. All three must see one and the same
record with the correct link to the animal.

**Given** an owner is registered (`ownerId`) with a pet added (`petId`); visit data is prepared per the
[«Test data — visit»](#test-data--visit) table, with a unique description

**Step 1 — record a visit from the pet details**
**When** `POST /owners/{ownerId}/pets/{petId}/visits` with a body of `date` and `description`
**Then** code `201`; the body contains the assigned `id`; `petId` equals the pet's `petId`; `date` and
`description` equal the submitted values. Save `id` as `visitId`.

**Step 2 — open the visit record**
**When** `GET /visits/{visitId}`
**Then** code `200`; `petId`, `date`, `description` match the response of step 1.

**Step 3 — open the pet details**
**When** `GET /pets/{petId}`
**Then** code `200`; the `visits` array contains exactly one record with `id` = `visitId`, its `date` and
`description` match the values submitted in step 1.

**Step 4 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the pet with `id` = `petId` inside the `pets` array carries the same `visits` array
with the `visitId` record — the visit is visible through two levels of nesting.

**Step 5 — view the clinic's visits log**
**When** `GET /visits`
**Then** code `200`; the log contains exactly one record with `id` = `visitId` and the pet's `petId`.

---

### AC-F03-02 — a visit recorded in the clinic-wide log lands in the history of the same pet as one recorded from its details

**US:** US-05, US-02
**Why this matters:** the system has two different ways to record a visit. If they land in different
places, part of the animal's history will be invisible to the vet, who only looks at the pet details.

**Given** an owner is registered (`ownerId`) with a pet (`petId`); data for two visits with different
unique descriptions and different dates is prepared

**Step 1 — record the first visit from the pet details**
**When** `POST /owners/{ownerId}/pets/{petId}/visits` with the data of the first visit
**Then** code `201`; `petId` in the body equals the pet's `petId`. Save `id` as `visitId1`.

**Step 2 — record the second visit in the clinic-wide log**
**When** `POST /visits` with a body of `petId` (the pet from Given), and the `date` and `description` of
the second visit, **without the `id` field**
**Then** code `201`; `petId` in the body equals the pet's `petId`; the assigned `id` differs from
`visitId1`. Save it as `visitId2`.

**Step 3 — open the pet's visit history**
**When** `GET /pets/{petId}`
**Then** code `200`; the `visits` array contains **both** records — `visitId1` and `visitId2` — with
their descriptions and dates; both have `petId` equal to the pet's `petId`.

**Step 4 — view the clinic's visits log**
**When** `GET /visits`
**Then** code `200`; both records are present in the log.

---

### AC-F03-03 — a visit can be scheduled for a future date

**US:** US-05
**Why this matters:** booking a visit is planning: the administrator schedules an appointment for a
future date. If the system rejects a future date, booking an animal for a visit becomes impossible.

**Given** an owner is registered (`ownerId`) with a pet (`petId`); the visit description is unique,
`date` — a date one month ahead of the current one

**Step 1 — record a visit for a future date**
**When** `POST /owners/{ownerId}/pets/{petId}/visits` with the body from Given
**Then** code `201`; `date` in the response equals the submitted future date. Save `id` as `visitId`.

**Step 2 — open the visit record**
**When** `GET /visits/{visitId}`
**Then** code `200`; `date` — the same future date; `petId` equals the pet's `petId`.

**Step 3 — open the pet's visit history**
**When** `GET /pets/{petId}`
**Then** code `200`; the `visits` array contains the `visitId` record with the future date.

---

### AC-F03-04 — a corrected visit description is immediately visible in the pet's visit history

**US:** US-05, US-02
**Why this matters:** the vet refines the visit record after the examination. The correction must be
visible both in the record itself and in the pet's history — otherwise the vet and the administrator read
different versions of the same visit.

**Given** an owner is registered (`ownerId`) with a pet (`petId`) and a recorded visit (`visitId`); the
visit date is remembered; a new unique description is prepared

**Step 1 — change the visit description**
**When** `PUT /visits/{visitId}` with a body where `description` is the new one and `date` is the
previous one (submitting both fields is mandatory)
**Then** code `204`; the response body is empty.

**Step 2 — open the visit record**
**When** `GET /visits/{visitId}`
**Then** code `200`; `description` — the new value; `date` has not changed; `petId` equals the pet's
`petId`.

**Step 3 — open the pet's visit history**
**When** `GET /pets/{petId}`
**Then** code `200`; the `visits` array contains exactly one record with `id` = `visitId` and the **new**
description.

---

### AC-F03-05 — a cancelled visit disappears from the pet's history and from the log, and cancelling again reports that the record does not exist

**US:** US-01, US-03
**Why this matters:** a cancelled visit must not remain either in the animal's history or in the clinic's
log — otherwise the vet prepares for an appointment that will not happen. At the same time neither the
pet nor the owner must be harmed.

**Given** an owner is registered (`ownerId`) with a pet (`petId`) and a recorded visit (`visitId`)

**Step 1 — cancel the visit**
**When** `DELETE /visits/{visitId}`
**Then** code `204`.

**Step 2 — attempt to open the visit record**
**When** `GET /visits/{visitId}`
**Then** code `404`; the response body is empty.

**Step 3 — open the pet details**
**When** `GET /pets/{petId}`
**Then** code `200`; the pet exists, its `name`, `birthDate`, `type.id` have not changed; the `visits`
array is empty.

**Step 4 — view the clinic's visits log**
**When** `GET /visits`
**Then** code `200`; there is no record with `id` = `visitId` in the log.

**Step 5 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the owner exists; their pet is in place, and the pet's visit history is empty.

**Step 6 — cancel the same visit again**
**When** `DELETE /visits/{visitId}`
**Then** code `404` — the system reports that the record does not exist.

---

### AC-F03-06 — editing one visit record does not affect the pet's remaining visits

**US:** US-05, US-02
**Why this matters:** the vet refines the description of one visit after the examination. The rest of the
history must stay unchanged: if the edit overwrites or deletes the neighbouring records, the clinic loses
treatment data.

**Given** a client is registered (`ownerId`) with a pet (`petId`) that has two visits in its history
(`visitId1`, `visitId2`); the dates and descriptions of both are remembered; a new unique description is
prepared for the first visit

**Step 1 — change the description of the first visit**
**When** `PUT /visits/{visitId1}` with a body where `description` is the new one and `date` is the
previous date of the first visit
**Then** code `204`; the response body is empty.

**Step 2 — open the first visit**
**When** `GET /visits/{visitId1}`
**Then** code `200`; `description` — the new value; `date` has not changed; `petId` equals the pet's
`petId`.

**Step 3 — open the second visit**
**When** `GET /visits/{visitId2}`
**Then** code `200`; `description` and `date` fully match the ones remembered in Given — the second visit
is not affected.

**Step 4 — open the pet's visit history**
**When** `GET /pets/{petId}`
**Then** code `200`; the `visits` array contains exactly two records — the corrected one and the
untouched one; both have `petId` equal to the pet's `petId`.

## Test plan

The level is **integration** everywhere. Setup of every test: a pet type from `GET /pettypes`, an owner,
a pet, and a visit where needed. Teardown: visits → pet → owner. One AC — one test.

| AC | Test | Level | Expected run result |
|---|---|---|---|
| AC-F03-01 | `AC-F03-01: a visit from the pet details is visible in the pet's history, in the owner details and in the log` | integration | green |
| AC-F03-02 | `AC-F03-02: a visit from the clinic-wide log lands in the history of the same pet` | integration | green |
| AC-F03-03 | `AC-F03-03: a visit can be scheduled for a future date` | integration | green |
| AC-F03-04 | `AC-F03-04: a corrected visit description is visible in the pet's history` | integration | green |
| AC-F03-05 | `AC-F03-05: a cancelled visit disappears from the history and the log, and cancelling again gives 404` | integration | green |
| AC-F03-06 | `AC-F03-06: editing one visit does not affect the pet's remaining visits` | integration | green |
