---
depends_on: ["../context-and-conventions.md", "../contracts/openapi.yaml", "./F-03-pet-visit-flow.md"]
---

# Flow F-02 — Owner's pet: adding, changing, deleting

## What the flow verifies

A pet can be added **only through the owner details**, while it can be viewed in three places: inside
the owner details, in its own pet details, and by opening the pet from the owner details. A pet can be
changed by two different requests, but deleted only directly. The flow verifies that all these places
show one and the same record rather than independent copies, and that deleting a pet does not affect
the owner.

## Chain

`GET /pettypes` → `POST /owners` → `POST /owners/{ownerId}/pets` →
`GET /owners/{ownerId}` + `GET /pets/{petId}` + `GET /owners/{ownerId}/pets/{petId}` + `GET /pets` →
`PUT /pets/{petId}` / `PUT /owners/{ownerId}/pets/{petId}` → `DELETE /pets/{petId}` → repeated reads

## Common precondition (setup)

- The application is running and responding.
- No seeded `id`s are used: the owner, the pet and the pet type are taken from API responses.
- **Choosing the pet type is the same in all ACs of this flow:** `GET /pettypes` → take the **first
  element of the array as a whole** and put it into the `type` field as is, without rebuilding the
  object. No separate step is written for this in the ACs — it is done in setup.
- The exception is **AC-F02-10**: it checks that the pet type stayed in the directory, so it uses its
  own type rather than the shared one — it creates it via `POST /pettypes` with a unique name and
  deletes it in teardown. A shared type is not suitable: another test may delete it, and the step would
  then fail for a reason other than the one the AC verifies.
- The owner is created by the test according to the preconditions of flow
  [F-01](./F-01-owner-lifecycle.md), section «Test data — owner»: the last name is letters only with a
  unique letter-based suffix, the telephone is exactly 10 digits.
- Teardown: delete everything the test created, in the order visits (`DELETE /visits/{visitId}`) → pets
  (`DELETE /pets/{petId}`) → owner (`DELETE /owners/{ownerId}`) → the test's own pet type
  (`DELETE /pettypes/{petTypeId}`), if the test created one. `404` on records already removed by a
  cascade is ignored.

## Test data — pet

All three fields are required. Constraints come from `contracts/openapi.yaml`, schema `PetFields`.

| Field | Constraint | Example of a valid value |
|---|---|---|
| `name` | a non-empty string, unique within the test: a base word + a unique suffix (a timestamp or part of a uuid), **no longer than 30 characters in total**. The name must not coincide with the seeded ones (`Leo`, `Basil`, `Rosy`, `Jewel`, …) | `Pet` + a unique suffix generated at runtime, for example `Pet` + `1754...` |
| `birthDate` | a date in `YYYY-MM-DD` format; not in the future and not earlier than 50 years ago. Today's date and exactly 50 years ago are both allowed | `2020-05-14` |
| `type` | the pet type object from `GET /pettypes` as a whole: `{"id": …, "name": …}`, without rebuilding it | `petTypes[0]` — the object from the API response as is; literal `id`s are not allowed (§10.1) |

The pet type is resolved **by `type.id` only**: a submitted `type.name` is ignored, and the response
always returns the real type name from the directory. That is why assertions compare `type.id`, while
`type.name` is checked against the type name from `GET /pettypes` and not against the submitted value.

## API behavior used in this flow

| Request | Response |
|---|---|
| `POST /owners/{ownerId}/pets` | `201`, the body contains the pet with an assigned `id`, an `ownerId` field and an empty `visits` array; header `Location` = `/api/pets/{id}` |
| `GET /pets/{petId}` | `200`, the pet with its `ownerId`, `type` object and `visits` array; `404` with no body if the pet does not exist |
| `GET /owners/{ownerId}` | `200`, the owner with a `pets` array; each pet comes with its `type` and `visits` |
| `GET /owners/{ownerId}/pets/{petId}` | `200` if the pet belongs to this owner; `404` with no body if the pet does not exist or belongs to another owner |
| `GET /pets` | `200`, an array of all pets in the clinic; `404` with no body if there are no records |
| `PUT /pets/{petId}` | `204`, empty body; accepts a body both with and without the `id`/`visits` fields; the visit history is not affected |
| `PUT /owners/{ownerId}/pets/{petId}` | `204`, empty body |
| `DELETE /pets/{petId}` | `204`; cascades to this pet's visits; the pet type and the owner are preserved |
| `POST /owners/{ownerId}/pets/{petId}/visits` | `201`, the body contains the visit with an assigned `id` and a `petId` field |
| `GET /visits/{visitId}` | `200`, the visit with its `petId`, `date`, `description`; `404` with no body if the visit does not exist |
| `GET /visits` | `200`, an array of all visits in the clinic |
| `POST /pettypes` | `201`, the body contains the pet type with an assigned `id` |
| `GET /pettypes/{petTypeId}` | `200`, the pet type with its `id` and `name`; `404` with no body if the type does not exist |
| `POST /owners/{ownerId}/pets` with a non-existent `ownerId` | `404` **with no body** |

## Acceptance criteria

| AC | US | What is verified |
|---|---|---|
| AC-F02-01 | US-02 | A pet added to an owner is immediately visible both in the owner details and in the pet details |
| AC-F02-02 | US-04 | An added pet immediately appears in the clinic-wide pets list |
| AC-F02-03 | US-02 | Renaming a pet in the pet details is immediately visible in the owner details |
| AC-F02-04 | US-02 | Renaming a pet through the owner details gives the same result as editing it in the pet details |
| AC-F02-05 | US-02, US-05 | Changing a pet's data does not wipe its visit history |
| AC-F02-06 | US-02, US-04 | Two pets of the same owner are independent: deleting one does not affect the other |
| AC-F02-07 | US-01, US-03, US-04 | A deleted pet cannot be opened in its own details or from the owner details, and the owner is left with an empty pets list |
| AC-F02-08 | US-03 | A pet cannot be opened through another owner's details |
| AC-F02-09 | US-06 | A pet cannot be added to a non-existent owner |
| AC-F02-10 | US-03 | Deleting a pet removes its visits but affects neither the owner nor the pet types directory |

---

### AC-F02-01 — a pet added to an owner is immediately visible both in the owner details and in the pet details

**US:** US-02
**Why this matters:** the administrator adds a pet from the owner details, while the vet at the
appointment opens the pet's own details. Both must see one and the same record with identical data and
the correct link to the owner, not two independent records.

**Given** an owner is registered (`ownerId` from the registration response) and pet data is prepared per
the [«Test data — pet»](#test-data--pet) table

**Step 1 — get a pet type from the directory**
**When** `GET /pettypes`
**Then** code `200`; the array is not empty. Take the pet type by the rule from the common precondition
— the first element as a whole as the `type` object — and remember its `id` and `name`.

**Step 2 — add a pet to the owner**
**When** `POST /owners/{ownerId}/pets` with the body: `name`, `birthDate`, `type` from step 1
**Then** code `201`; the body contains the assigned `id`; `name` and `birthDate` equal the submitted
values; `type.id` equals the type from step 1; `ownerId` equals the owner's `ownerId`. Save `id` as
`petId`.

**Step 3 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the `pets` array contains exactly one element; it has `id` = `petId`, `name` and
`birthDate` equal to the values submitted in step 2, `type.id` equal to the type from step 1.

**Step 4 — open the pet details**
**When** `GET /pets/{petId}`
**Then** code `200`; `name` and `birthDate` match the response of step 2; `type.id` and `type.name`
equal the type and its name from step 1; `ownerId` equals the owner's `ownerId`.

**Step 5 — open the pet from the owner details**
**When** `GET /owners/{ownerId}/pets/{petId}`
**Then** code `200`; the body matches the response of step 4 in every field — this is one and the same
record, not two different representations.

---

### AC-F02-02 — an added pet immediately appears in the clinic-wide pets list

**US:** US-04
**Why this matters:** the clinic keeps a clinic-wide list of pets independently of the owner details. A
pet added through the owner details must not get «lost» in that list.

**Given** an owner is registered (`ownerId`), a pet type is obtained from `GET /pettypes`, pet data with
a unique name is prepared

**Step 1 — add a pet to the owner**
**When** `POST /owners/{ownerId}/pets` with the body from Given
**Then** code `201`; save `id` as `petId`.

**Step 2 — view the clinic-wide pets list after the addition**
**When** `GET /pets`
**Then** code `200`; the list contains exactly one record with `id` = `petId`, its `ownerId` equals the
owner from Given, `name` and `type.id` match the submitted values.

---

### AC-F02-03 — renaming a pet in the pet details is immediately visible in the owner details

**US:** US-02
**Why this matters:** the name is corrected in the pet details, while the administrator sees the owner
together with the list of their animals. If the owner details return the old name, two screens show
different data about the same animal.

**Given** an owner is registered (`ownerId`) with a pet added (`petId`); a new unique name is prepared

**Step 1 — change the name in the pet details**
**When** `PUT /pets/{petId}` with a body where `name` is the new name, and `birthDate` and `type` are
the previous ones
**Then** code `204`; the response body is empty.

**Step 2 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the `pets` array contains exactly one element with `id` = `petId` and the **new**
name.

**Step 3 — open the pet from the owner details**
**When** `GET /owners/{ownerId}/pets/{petId}`
**Then** code `200`; `name` — the new name.

---

### AC-F02-04 — renaming a pet through the owner details gives the same result as editing it in the pet details

**US:** US-02
**Why this matters:** one and the same pet is changed by two different requests. If they behave
differently, the outcome of the administrator's work depends on which screen they opened the animal
from.

**Given** an owner is registered (`ownerId`) with a pet added (`petId`); a new unique name is prepared

**Step 1 — change the name through the owner details**
**When** `PUT /owners/{ownerId}/pets/{petId}` with a body where `name` is the new name, and `birthDate`
and `type` are the previous ones
**Then** code `204`; the response body is empty.

**Step 2 — open the pet details**
**When** `GET /pets/{petId}`
**Then** code `200`; `name` — the new name; `ownerId` equals the owner from Given.

**Step 3 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the pet with `id` = `petId` has the new name.

---

### AC-F02-05 — changing a pet's data does not wipe its visit history

**US:** US-02, US-05
**Why this matters:** the most dangerous case is an edit of the pet details that zeroes out the visit
history. The vet loses the data about previous visits even though only the name was being changed.

**Given** an owner is registered (`ownerId`) with a pet (`petId`); the pet has one visit recorded by the
request `POST /owners/{ownerId}/pets/{petId}/visits` with a body of `date` and `description` per the
[«Test data — visit»](./F-03-pet-visit-flow.md#test-data--visit) table — both fields are
required, `id` must not be submitted; `visitId` = `id` from the `201` response

**Step 1 — make sure the visit history is not empty**
**When** `GET /pets/{petId}`
**Then** code `200`; the `visits` array contains exactly one record with `id` = `visitId`. Remember its
`description` and `date`.

**Step 2 — change the pet's name without submitting the visit history**
**When** `PUT /pets/{petId}` with a body of `name` (a new unique name), `birthDate` and `type` —
**without the `visits` field**
**Then** code `204`; the response body is empty.

**Step 3 — open the pet details**
**When** `GET /pets/{petId}`
**Then** code `200`; `name` — the new name; the `visits` array still contains exactly one record with
`id` = `visitId`, its `description` and `date` match the ones remembered in step 1.

**Step 4 — check the visit by a separate request**
**When** `GET /visits/{visitId}`
**Then** code `200`; `petId` equals the pet's `petId`; `description` and `date` have not changed.

---

### AC-F02-06 — two pets of the same owner are independent: deleting one does not affect the other

**US:** US-02, US-04
**Why this matters:** an owner often has several animals. Deleting one must not affect the data of the
second one — otherwise the administrator loses the details of a living pet.

**Given** an owner is registered (`ownerId`); a pet type is obtained; data for two pets with different
unique names is prepared

**Step 1 — add the first pet**
**When** `POST /owners/{ownerId}/pets` with the data of the first pet
**Then** code `201`; save `id` as `petId1`.

**Step 2 — add the second pet**
**When** `POST /owners/{ownerId}/pets` with the data of the second pet
**Then** code `201`; `id` differs from `petId1`. Save it as `petId2`.

**Step 3 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the `pets` array contains two elements with `id` = `petId1` and `petId2`; each has
its own name — the second pet did not overwrite the first one.

**Step 4 — delete the first pet**
**When** `DELETE /pets/{petId1}`
**Then** code `204`.

**Step 5 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the `pets` array contains exactly one element with `id` = `petId2` and its original
name.

**Step 6 — open the second pet's details**
**When** `GET /pets/{petId2}`
**Then** code `200`; the second pet's `name`, `birthDate`, `type.id`, `ownerId` have not changed.

---

### AC-F02-07 — a deleted pet cannot be opened in its own details or from the owner details, and the owner is left with an empty pets list

**US:** US-01, US-03, US-04
**Why this matters:** after deletion the animal must not show up in its own details, in the owner
details, or in the clinic-wide pets list. At the same time the owner remains a client — deleting an
animal does not deregister them.

**Given** an owner is registered (`ownerId`) with one pet (`petId`); `firstName`, `lastName`, `address`,
`city`, `telephone` from the owner registration response are saved as `ownerBefore`

**Step 1 — delete the pet**
**When** `DELETE /pets/{petId}`
**Then** code `204`.

**Step 2 — attempt to open the pet details**
**When** `GET /pets/{petId}`
**Then** code `404`; the response body is empty.

**Step 3 — attempt to open the pet from the owner details**
**When** `GET /owners/{ownerId}/pets/{petId}`
**Then** code `404`; the response body is empty.

**Step 4 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the owner exists, their `firstName`, `lastName`, `address`, `city`, `telephone`
match `ownerBefore`; the `pets` array is empty.

**Step 5 — view the clinic-wide pets list**
**When** `GET /pets`
**Then** code `200`; there is no record with `id` = `petId` in the list.

---

### AC-F02-08 — a pet cannot be opened through another owner's details

**US:** US-03
**Why this matters:** the administrator must not see one owner's pet by substituting another owner into
the address — otherwise data about animals gets mixed up between the clinic's clients.

**Given** two owners are registered (`ownerId1`, `ownerId2`); the first one has a pet added (`petId`)

**Step 1 — open the pet from its own owner's details**
**When** `GET /owners/{ownerId1}/pets/{petId}`
**Then** code `200`; `id` = `petId`, `ownerId` = `ownerId1`. Remember the name.

**Step 2 — attempt to open the same pet from the second owner's details**
**When** `GET /owners/{ownerId2}/pets/{petId}`
**Then** code `404`; the response body is empty.

---

### AC-F02-09 — a pet cannot be added to a non-existent owner

**US:** US-06
**Why this matters:** a pet without an owner is useless to the clinic: it cannot be found through a
client's details and there is nobody to contact about the treatment.

**Given** a knowingly absent owner identifier — register an owner, delete them and use the freed `id`;
valid pet data with a unique name is prepared

**Step 1 — attempt to add a pet to the deleted owner**
**When** `POST /owners/{deleted ownerId}/pets` with the body from Given
**Then** code `404`; the response body is empty.

**Step 2 — check that the pet was not created**
**When** `GET /pets`
**Then** code `200`; there is no pet with the unique name from Given in the list.

---

### AC-F02-10 — deleting a pet removes its visits but affects neither the owner nor the pet types directory

**US:** US-03
**Why this matters:** an animal may have changed hands or stopped being served, but the client itself
stays with the clinic, and the pet type is a shared directory record used by other pets. Deleting a
single pet must affect neither of them.

**Given** a pet type is created (`petTypeId`, a unique name, used by this test only); an owner is
registered (`ownerId`); the owner has one pet (`petId`) of that type with a recorded visit (`visitId`);
`firstName`, `lastName`, `address`, `city`, `telephone` from the owner registration response are saved
as `ownerBefore`

**Step 1 — delete the pet**
**When** `DELETE /pets/{petId}`
**Then** code `204`.

**Step 2 — attempt to open the pet details**
**When** `GET /pets/{petId}`
**Then** code `404`; the response body is empty.

**Step 3 — attempt to open the deleted pet's visit**
**When** `GET /visits/{visitId}`
**Then** code `404`; the response body is empty — the visits were deleted together with the pet.

**Step 4 — open the owner details**
**When** `GET /owners/{ownerId}`
**Then** code `200`; the owner exists, their `firstName`, `lastName`, `address`, `city`, `telephone`
match `ownerBefore`; the `pets` array is empty.

**Step 5 — check the pet types directory**
**When** `GET /pettypes/{petTypeId}`
**Then** code `200`; the pet type exists, its `name` has not changed — deleting a pet does not affect
the directory.

**Step 6 — view the clinic-wide visits log**
**When** `GET /visits`
**Then** code `200`; there is no record with `id` = `visitId` in the log.


## Test plan

The level is **integration** everywhere. Setup of every test: get a pet type from `GET /pettypes` (in
AC-F02-10 — create its own one via `POST /pettypes`), create an owner, and where needed a pet and a
visit. Teardown: visits → pets → owner → the test's own pet type, if one was created. One AC — one test.

| AC | Test | Level | Expected run result |
|---|---|---|---|
| AC-F02-01 | `AC-F02-01: an added pet is visible in the owner details and in its own details with the same data` | integration | green |
| AC-F02-02 | `AC-F02-02: an added pet appears in the clinic-wide pets list` | integration | green |
| AC-F02-03 | `AC-F02-03: a rename in the pet details is visible in the owner details` | integration | green |
| AC-F02-04 | `AC-F02-04: a rename through the owner details is visible in the pet details` | integration | green |
| AC-F02-05 | `AC-F02-05: editing a pet's data does not wipe the visit history` | integration | green |
| AC-F02-06 | `AC-F02-06: deleting one pet does not affect the owner's second pet` | integration | green |
| AC-F02-07 | `AC-F02-07: a deleted pet cannot be opened in its own details or from the owner details` | integration | green |
| AC-F02-08 | `AC-F02-08: a pet cannot be opened through another owner's details` | integration | green |
| AC-F02-09 | `AC-F02-09: a pet cannot be added to a non-existent owner` | integration | green |
| AC-F02-10 | `AC-F02-10: deleting a pet removes the visits but preserves the owner and the pet types directory` | integration | green |
