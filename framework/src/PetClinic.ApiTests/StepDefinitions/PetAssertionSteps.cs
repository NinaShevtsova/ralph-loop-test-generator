using FluentAssertions;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Support;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// Assertion ("Then") steps for F-01's cascade AC (AC-F01-04, stage 1). The request steps these
// build on live in PetSteps.cs (stage 0, design D-13); this file issues no requests of its own, it
// only reads back what those steps already stored in ScenarioState and asserts on it.
[Binding]
public sealed class PetAssertionSteps
{
    private readonly ScenarioState _state;

    public PetAssertionSteps(ScenarioState state)
    {
        _state = state;
    }

    // AC-F02-01 step 2: compared against the exact Pet OwnerSteps.cs sent on the wire
    // (OwnerAddPetRequest), not against the base PetCase and not against the response body itself --
    // the same "compare against what was submitted" rule OwnerAssertionSteps established for owner
    // registration, applied here to the nested pet-creation route.
    [Then("the created pet has an assigned id, the submitted values and a link to the owner")]
    public void TheCreatedPetHasAnAssignedIdTheSubmittedValuesAndALinkToTheOwner()
    {
        var pet = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var submitted = _state.Get<Pet>("OwnerAddPetRequest");
        var ownerId = _state.CreatedOwner.Id;
        var petId = pet.Id;

        pet.Id.Should().NotBeNull($"adding a pet to owner {ownerId} must return the id the API assigned it");
        pet.Name.Should().Be(submitted.Name, $"pet {petId} must keep the name that was submitted");
        pet.BirthDate.Should().Be(submitted.BirthDate, $"pet {petId} must keep the birth date that was submitted");
        pet.Type.Id.Should().Be(submitted.Type.Id, $"pet {petId} must keep the type id that was submitted");
        pet.OwnerId.Should().Be(ownerId, $"pet {petId} must carry a link back to owner {ownerId}");
    }

    // AC-F01-04 step 4: the code (404) is asserted by EnsureStatus inside "an attempt is made to
    // open the pet details"; this checks the other half §7 states for every 404 -- no body to carry.
    [Then("the pet details are no longer available")]
    public void ThePetDetailsAreNoLongerAvailable()
    {
        var petId = _state.CreatedPet.Id;
        var response = _state.Get<ApiResponse<Pet>>("PetGetByIdAfterDeleteResponse");

        response.RawContent.Should().BeNullOrEmpty(
            $"pet {petId}'s details must return no body once its owner has been deregistered (§7)");
    }

    // AC-F01-04 step 6 (pets half): deregistering the owner must not leave the pet dangling in the
    // clinic-wide directory that other owners' pets are also listed in.
    [Then("the pet is missing from the pets list")]
    public void ThePetIsMissingFromThePetsList()
    {
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Created pet carries no id.");
        var directory = _state.Get<ApiResponse<List<Pet>>>("PetDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /pets answered 200 with no body.");

        directory.Should().NotContain(p => p.Id == petId,
            $"pet {petId} must no longer appear in the pets list once its owner has been deregistered");
    }

    // AC-F02-01 step 4: compared against OwnerAddPetResponse (the POST's own body) for name and
    // birth date, and against PetTypeDirectoryResponse's first element for the type -- the AC's own
    // distinction: type.id is resolved from what was submitted, but type.name always comes back from
    // the directory regardless of what (if anything) was submitted (§11).
    [Then("the pet details match the addition and the type from the directory")]
    public void ThePetDetailsMatchTheAdditionAndTheTypeFromTheDirectory()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var added = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var directoryType = _state.Get<ApiResponse<List<PetType>>>("PetTypeDirectoryResponse").Body?.FirstOrDefault()
            ?? throw new InvalidOperationException("GET /pettypes answered 200 with no body.");
        var petId = fetched.Id;

        fetched.Name.Should().Be(added.Name, $"pet {petId}'s own details must show the name that was submitted");
        fetched.BirthDate.Should().Be(added.BirthDate, $"pet {petId}'s own details must show the birth date that was submitted");
        fetched.Type.Id.Should().Be(directoryType.Id, $"pet {petId}'s own details must show the submitted type id");
        fetched.Type.Name.Should().Be(directoryType.Name, $"pet {petId}'s own details must show the type name from the directory, not a submitted one");
        fetched.OwnerId.Should().Be(added.OwnerId, $"pet {petId}'s own details must still link back to the same owner");
    }

    // AC-F02-01 step 5: GET /owners/{ownerId}/pets/{petId} must return exactly what GET /pets/{petId}
    // already returned -- one and the same record read through two different routes, not two
    // independent representations (US-02).
    [Then("the pet opened from the owner details matches the pet details in every field")]
    public void ThePetOpenedFromTheOwnerDetailsMatchesThePetDetailsInEveryField()
    {
        var direct = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var nested = _state.Get<ApiResponse<Pet>>("OwnerGetPetResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId}/pets/{petId} answered 200 with no body.");

        nested.Should().BeEquivalentTo(direct,
            $"opening pet {direct.Id} through its owner must return exactly what opening it directly already returned");
    }

    // AC-F02-02 step 2: "exactly one" per §10.4, compared against OwnerAddPetResponse (the POST's
    // own body) for the owner link, name and type id -- the same "compare against what was
    // submitted" rule this file already applies to the owner-nested reading, now for the
    // clinic-wide pets list.
    [Then("the pet appears exactly once in the pets list with the submitted values")]
    public void ThePetAppearsExactlyOnceInThePetsListWithTheSubmittedValues()
    {
        var added = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var petId = added.Id ?? throw new InvalidOperationException("Created pet carries no id.");
        var directory = _state.Get<ApiResponse<List<Pet>>>("PetDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /pets answered 200 with no body.");

        directory.Should().ContainSingle(p => p.Id == petId,
            $"pet {petId} must appear exactly once in the clinic-wide pets list after being added");

        var listed = directory.Single(p => p.Id == petId);
        listed.OwnerId.Should().Be(added.OwnerId, $"pet {petId}'s entry in the pets list must link back to its owner");
        listed.Name.Should().Be(added.Name, $"pet {petId}'s entry in the pets list must carry the submitted name");
        listed.Type.Id.Should().Be(added.Type.Id, $"pet {petId}'s entry in the pets list must carry the submitted type id");
    }

    // AC-F02-03 step 1: EnsureStatus inside "the pet details are updated" already covers "code 204";
    // this is the other half §7 states for every PUT -- the same "empty body" check
    // OwnerAssertionSteps already applies to the owner's own PUT, now for the direct pet route.
    [Then("the pet update returns no pet data")]
    public void ThePetUpdateReturnsNoPetData()
    {
        var petId = _state.CreatedPet.Id;
        var response = _state.Get<ApiResponse<object?>>("PetUpdateResponse");

        response.RawContent.Should().BeNullOrEmpty($"pet {petId}'s update must answer with an empty body (§7)");
    }

    // AC-F02-03 step 3: compared against _state.CreatedPet.Name -- "the pet details are updated"
    // already folded the new name into CreatedPet once the PUT succeeded, so this is the same
    // "compare against what was actually sent" rule, now for the route the AC itself did not use to
    // make the change.
    [Then("the pet opened from the owner details carries the new name")]
    public void ThePetOpenedFromTheOwnerDetailsCarriesTheNewName()
    {
        var nested = _state.Get<ApiResponse<Pet>>("OwnerGetPetResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId}/pets/{petId} answered 200 with no body.");
        var expectedName = _state.CreatedPet.Name;
        var petId = _state.CreatedPet.Id;

        nested.Name.Should().Be(expectedName, $"pet {petId} opened through its owner must show the renamed value");
    }

    // AC-F02-04 step 1: EnsureStatus inside "the pet is updated through the owner" already covers
    // "code 204"; this is the other half §7 states for every PUT -- the same "empty body" check this
    // file already applies to the direct pet route ("the pet update returns no pet data"), now for
    // the owner-nested route, which stores its response under its own key (OwnerUpdatePetResponse)
    // rather than PetUpdateResponse.
    [Then("the pet update through the owner details returns no pet data")]
    public void ThePetUpdateThroughTheOwnerDetailsReturnsNoPetData()
    {
        var petId = _state.CreatedPet.Id;
        var response = _state.Get<ApiResponse<object?>>("OwnerUpdatePetResponse");

        response.RawContent.Should().BeNullOrEmpty($"pet {petId}'s update through the owner must answer with an empty body (§7)");
    }

    // AC-F02-04 step 2: compared against OwnerUpdatePetRequest -- the body "the pet is updated
    // through the owner" put on the wire -- rather than _state.CreatedPet, since "the pet details
    // are opened" overwrites CreatedPet with this very GET's own body before this step runs, which
    // would make a comparison against CreatedPet prove nothing.
    [Then("the pet details show the name that was set through the owner")]
    public void ThePetDetailsShowTheNameThatWasSetThroughTheOwner()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var submitted = _state.Get<Pet>("OwnerUpdatePetRequest");
        var ownerId = _state.CreatedOwner.Id;
        var petId = fetched.Id;

        fetched.Name.Should().Be(submitted.Name, $"pet {petId}'s own details must show the name that was set through the owner");
        fetched.OwnerId.Should().Be(ownerId, $"pet {petId} must still be linked to owner {ownerId} after being renamed through the owner");
    }

    // AC-F02-05 step 1: reads the pet's own GET response rather than CreatedVisit's creation
    // response, to confirm the just-recorded visit is already visible through this route before
    // the update this AC exercises even runs.
    [Then("the pet details show the visit that was recorded for it")]
    public void ThePetDetailsShowTheVisitThatWasRecordedForIt()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");

        AssertVisitUnaffected(fetched, _state.CreatedVisit);
    }

    // AC-F02-05 step 3: the name is compared against PetUpdateRequest -- the exact body "the pet
    // details are updated" put on the wire -- rather than _state.CreatedPet, since "the pet details
    // are opened" (the very step that performs this GET) overwrites CreatedPet with its own fetched
    // body before this Then ever runs. The visit half reuses the same check step 1 already made:
    // a rename through PUT /pets/{petId} without a visits field must leave the recorded visit
    // exactly as it was.
    [Then("the pet details show the new name and an unaffected visit history")]
    public void ThePetDetailsShowTheNewNameAndAnUnaffectedVisitHistory()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var submitted = _state.Get<Pet>("PetUpdateRequest");
        var petId = fetched.Id;

        fetched.Name.Should().Be(submitted.Name, $"pet {petId}'s own details must show the new name after the update");

        AssertVisitUnaffected(fetched, _state.CreatedVisit);
    }

    // AC-F02-07 step 1: EnsureStatus inside "the pet is deleted" already covers "code 204"; this is
    // the other half §7 states for every DELETE -- the same "empty body" check this file already
    // applies to "the first pet's deletion returns no pet data", now for the generic delete
    // (PetDeleteResponse) that this AC's single-pet scenario uses instead.
    [Then("the pet deletion returns no pet data")]
    public void ThePetDeletionReturnsNoPetData()
    {
        var petId = _state.CreatedPet.Id;
        var response = _state.Get<ApiResponse<object?>>("PetDeleteResponse");

        response.RawContent.Should().BeNullOrEmpty($"deleting pet {petId} must answer with an empty body (§7)");
    }

    // AC-F02-07 step 3: the code (404) is asserted by EnsureStatus inside "an attempt is made to
    // open the pet from the owner details"; this checks the other half §7 states for every 404 --
    // no body to carry. Mirrors "the pet details are no longer available" (the direct route), now
    // for the owner-nested one, which stores its response under its own key
    // (OwnerGetPetAfterDeleteResponse).
    [Then("the pet is no longer available from the owner details")]
    public void ThePetIsNoLongerAvailableFromTheOwnerDetails()
    {
        var petId = _state.CreatedPet.Id;
        var response = _state.Get<ApiResponse<Pet>>("OwnerGetPetAfterDeleteResponse");

        response.RawContent.Should().BeNullOrEmpty(
            $"opening pet {petId} through its owner must return no body once the pet has been deleted (§7)");
    }

    // AC-F02-06 step 2: the AC's own extra check beyond the standard creation assertions — that
    // adding a second pet to the same owner returns a different id than the first, so the second
    // POST does not silently reuse or overwrite the first pet's record.
    [Then("the second pet has its own id, distinct from the first pet")]
    public void TheSecondPetHasItsOwnIdDistinctFromTheFirstPet()
    {
        var first = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var second = _state.Get<ApiResponse<Pet>>("OwnerAddSecondPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");

        second.Id.Should().NotBeNull("adding the second pet must return the id the API assigned it");
        second.Id.Should().NotBe(first.Id, $"the second pet must get its own id, distinct from the first pet {first.Id}");
    }

    // AC-F02-06 step 4: EnsureStatus inside "the first pet is deleted" already covers "code 204";
    // this is the other half §7 states for every DELETE — the same "empty body" check this file
    // already applies to updates, now for a delete response. Named for the first pet specifically
    // (mirroring "the pet update through the owner details returns no pet data" alongside the
    // generic "the pet update returns no pet data") because it reads PetDeleteFirstResponse, which
    // only "the first pet is deleted" ever writes — the generic "the pet deletion returns no pet
    // data" name is left free for "the pet is deleted" (PetDeleteResponse) to claim later.
    [Then("the first pet's deletion returns no pet data")]
    public void TheFirstPetsDeletionReturnsNoPetData()
    {
        var first = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var response = _state.Get<ApiResponse<object?>>("PetDeleteFirstResponse");

        response.RawContent.Should().BeNullOrEmpty($"deleting pet {first.Id} must answer with an empty body (§7)");
    }

    // AC-F02-06 step 6: the second pet's own details, read directly after its sibling was deleted,
    // must still show exactly what "a second pet is added to the owner" recorded at creation —
    // deleting the first pet must affect neither the second pet's fields nor its link to the owner.
    [Then("the second pet's details are unchanged after the first pet was deleted")]
    public void TheSecondPetsDetailsAreUnchangedAfterTheFirstPetWasDeleted()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var created = _state.Get<ApiResponse<Pet>>("OwnerAddSecondPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var petId = fetched.Id;

        fetched.Name.Should().Be(created.Name, $"pet {petId}'s name must be unchanged after its sibling was deleted");
        fetched.BirthDate.Should().Be(created.BirthDate, $"pet {petId}'s birth date must be unchanged after its sibling was deleted");
        fetched.Type.Id.Should().Be(created.Type.Id, $"pet {petId}'s type must be unchanged after its sibling was deleted");
        fetched.OwnerId.Should().Be(created.OwnerId, $"pet {petId} must still be linked to the same owner after its sibling was deleted");
    }

    // AC-F02-08 step 1: the pet opened through its own owner's nested route must carry that owner's
    // id and the pet's own id -- establishing which owner the record belongs to before step 2 checks
    // that substituting a different owner into the same route no longer resolves it.
    [Then("the pet opened from the owner details belongs to its own owner")]
    public void ThePetOpenedFromTheOwnerDetailsBelongsToItsOwnOwner()
    {
        var nested = _state.Get<ApiResponse<Pet>>("OwnerGetPetResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId}/pets/{petId} answered 200 with no body.");
        var ownerId = _state.CreatedOwner.Id;
        var petId = _state.CreatedPet.Id;

        nested.Id.Should().Be(petId, $"opening pet {petId} through its own owner's details must return that same pet");
        nested.OwnerId.Should().Be(ownerId, $"pet {petId} opened through owner {ownerId}'s details must carry a link back to owner {ownerId}");
    }

    // AC-F02-08 step 2: the code (404) is asserted by EnsureStatus inside "an attempt is made to open
    // the pet from the second owner's details"; this checks the other half §7 states for every 404 --
    // no body to carry. Mirrors "the pet is no longer available from the owner details" (the
    // deleted-pet case), now for a pet that still exists but is addressed through the wrong owner.
    [Then("the pet is not available from the second owner's details")]
    public void ThePetIsNotAvailableFromTheSecondOwnersDetails()
    {
        var petId = _state.CreatedPet.Id;
        var response = _state.Get<ApiResponse<Pet>>("OwnerGetPetFromSecondOwnerResponse");

        response.RawContent.Should().BeNullOrEmpty(
            $"opening pet {petId} through another owner's details must return no body (§7)");
    }

    // AC-F02-09 step 1: EnsureStatus inside "an attempt is made to add a pet to the deleted owner"
    // already covers "code 404"; this is the other half §7 states for every 404 -- no body to carry.
    [Then("the pet addition to the deleted owner returns no pet data")]
    public void ThePetAdditionToTheDeletedOwnerReturnsNoPetData()
    {
        var deletedOwnerId = _state.CreatedOwner.Id;
        var attempted = _state.Get<Pet>("OwnerAddPetToDeletedOwnerRequest");
        var response = _state.Get<ApiResponse<Pet>>("OwnerAddPetToDeletedOwnerResponse");

        response.RawContent.Should().BeNullOrEmpty(
            $"adding pet '{attempted.Name}' to deleted owner {deletedOwnerId} must return no body (§7)");
    }

    // AC-F02-09 step 2: the failed POST never returned a body to take an id from, so this checks by
    // the unique name the attempted request carried instead -- the same "compare against what was
    // submitted" rule this file applies elsewhere, now proving the pet was never created at all.
    [Then("the pet from the failed addition is missing from the pets list")]
    public void ThePetFromTheFailedAdditionIsMissingFromThePetsList()
    {
        var attempted = _state.Get<Pet>("OwnerAddPetToDeletedOwnerRequest");
        var directory = _state.Get<ApiResponse<List<Pet>>>("PetDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /pets answered 200 with no body.");

        directory.Should().NotContain(p => p.Name == attempted.Name,
            $"pet '{attempted.Name}' must never have been created since its owner did not exist");
    }

    // AC-F03-05 step 3: name/birthDate/type.id compared against OwnerAddPetRequest -- what was
    // actually submitted when the pet was added -- the same "compare against what was submitted"
    // rule this file applies elsewhere; the visits array must now be empty, the one visit it held
    // having just been cancelled.
    [Then("the pet's own details are unaffected and its visit history is empty")]
    public void ThePetsOwnDetailsAreUnaffectedAndItsVisitHistoryIsEmpty()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var submitted = _state.Get<Pet>("OwnerAddPetRequest");
        var petId = fetched.Id;

        fetched.Name.Should().Be(submitted.Name, $"pet {petId}'s name must be unchanged after cancelling its visit");
        fetched.BirthDate.Should().Be(submitted.BirthDate, $"pet {petId}'s birth date must be unchanged after cancelling its visit");
        fetched.Type.Id.Should().Be(submitted.Type.Id, $"pet {petId}'s type must be unchanged after cancelling its visit");
        fetched.Visits.Should().BeNullOrEmpty($"pet {petId}'s visit history must be empty once its only visit has been cancelled");
    }

    // Shared by both AC-F02-05 Then steps above: the visit's id, description and date must still be
    // the ones "a visit is recorded for the pet" created, whether read right after recording it or
    // again after the pet's name was changed by a PUT that never submitted a visits field.
    private static void AssertVisitUnaffected(Pet pet, Visit expected)
    {
        var petId = pet.Id;
        var visitId = expected.Id ?? throw new InvalidOperationException("Created visit carries no id.");

        pet.Visits.Should().NotBeNull($"pet {petId}'s details must carry a visits field")
            .And.ContainSingle(v => v.Id == visitId,
                $"pet {petId}'s visit history must still show visit {visitId}");

        var recorded = pet.Visits!.Single(v => v.Id == visitId);
        recorded.Description.Should().Be(expected.Description, $"visit {visitId}'s description must be unchanged after pet {petId}'s update");
        recorded.Date.Should().Be(expected.Date, $"visit {visitId}'s date must be unchanged after pet {petId}'s update");
    }
}
