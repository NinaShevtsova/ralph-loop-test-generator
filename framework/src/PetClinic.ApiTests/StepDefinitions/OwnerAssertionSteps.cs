using FluentAssertions;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Support;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// Assertion ("Then") steps for F-01's owner-lifecycle ACs (stage 1). The request steps these build
// on live in OwnerSteps.cs (stage 0, design D-13); this file issues no requests of its own, it only
// reads back what those steps already stored in ScenarioState and asserts on it.
[Binding]
public sealed class OwnerAssertionSteps
{
    private readonly ScenarioState _state;

    public OwnerAssertionSteps(ScenarioState state)
    {
        _state = state;
    }

    // AC-F01-01 step 1: compared against the exact Owner OwnerSteps.cs sent on the wire
    // (OwnerCreateRequest), not against the base OwnerCase and not against _state.CreatedOwner --
    // the latter is set to this very response body, so comparing it to itself would prove nothing.
    // Comparing against the request (which already carries UniqueData's suffix) lets every field,
    // lastName included, be an exact Be rather than a StartWith.
    [Then("the created owner has an assigned id, the submitted values and an empty pets list")]
    public void TheCreatedOwnerHasAnAssignedIdTheSubmittedValuesAndAnEmptyPetsList()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var submitted = _state.Get<Owner>("OwnerCreateRequest");
        var ownerId = owner.Id;

        owner.Id.Should().NotBeNull("registering an owner must return the id the API assigned it");
        owner.FirstName.Should().Be(submitted.FirstName, $"owner {ownerId} must keep the first name that was submitted");
        owner.LastName.Should().Be(submitted.LastName, $"owner {ownerId} must keep the exact last name that was submitted, unique suffix included");
        owner.Address.Should().Be(submitted.Address, $"owner {ownerId} must keep the address that was submitted");
        owner.City.Should().Be(submitted.City, $"owner {ownerId} must keep the city that was submitted");
        owner.Telephone.Should().Be(submitted.Telephone, $"owner {ownerId} must keep the telephone that was submitted");
        owner.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.BeEmpty($"owner {ownerId} has just been registered and has no pets yet");
    }

    // AC-F01-01 step 2: the GET response is compared against the POST response, not against
    // _state.CreatedOwner -- that field was already overwritten with the GET's own body by "the
    // owner details are opened", so it can no longer serve as the other side of the comparison.
    [Then("the owner details show the submitted values and match the registration response")]
    public void TheOwnerDetailsShowTheSubmittedValuesAndMatchTheRegistrationResponse()
    {
        var created = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var fetched = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var ownerId = created.Id;

        fetched.Should().BeEquivalentTo(created,
            $"opening the details of owner {ownerId} must return exactly what registering owner {ownerId} already returned, with no other state saved");
    }

    // AC-F01-01 step 3: "exactly one" per §10.4 -- never an absolute count of the whole list, only
    // that this owner's own id occurs once. The `because` message is built from `ownerId` (a plain
    // value) rather than the ContainSingle predicate, since FluentAssertions prints the predicate's
    // expression text ("o.Id == ownerId") on failure, never the captured value.
    [Then("the owner appears exactly once in the owners list with the submitted values")]
    public void TheOwnerAppearsExactlyOnceInTheOwnersListWithTheSubmittedValues()
    {
        var created = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var ownerId = created.Id ?? throw new InvalidOperationException("Created owner carries no id.");
        var directory = _state.Get<ApiResponse<List<Owner>>>("OwnerDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /owners answered 200 with no body.");

        directory.Should().ContainSingle(o => o.Id == ownerId,
            $"registering owner {ownerId} must not create a duplicate entry in the owners list");

        var listed = directory.Single(o => o.Id == ownerId);
        listed.FirstName.Should().Be(created.FirstName, $"owner {ownerId}'s entry in the owners list must carry the registered first name");
        listed.LastName.Should().Be(created.LastName, $"owner {ownerId}'s entry in the owners list must carry the registered last name");
        listed.Address.Should().Be(created.Address, $"owner {ownerId}'s entry in the owners list must carry the registered address");
        listed.City.Should().Be(created.City, $"owner {ownerId}'s entry in the owners list must carry the registered city");
        listed.Telephone.Should().Be(created.Telephone, $"owner {ownerId}'s entry in the owners list must carry the registered telephone");
    }

    // AC-F01-02 step 1: EnsureStatus inside the When step already covers "code 204"; this is the
    // AC's other half -- "the response body is empty" -- which §7 states for every PUT and which
    // was otherwise never checked, since OwnerUpdateResponse was written to ScenarioState but never
    // read back by any step.
    [Then("the owner update returns no owner data")]
    public void TheOwnerUpdateReturnsNoOwnerData()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var response = _state.Get<ApiResponse<object?>>("OwnerUpdateResponse");
        var ownerId = registered.Id;

        response.RawContent.Should().BeNullOrEmpty($"owner {ownerId}'s update must answer with an empty body (§7)");
    }

    // AC-F01-02 step 2: the new city/telephone are compared against OwnerUpdateRequest -- the exact
    // body OwnerSteps.cs put on the wire, per the same "compare against what was submitted" rule
    // iteration 2 established for registration -- while firstName/lastName/address are compared
    // against OwnerCreateResponse, since a contacts-only update must leave them exactly as
    // registration returned them.
    [Then("the owner details show the updated contacts and the previous values that were not changed")]
    public void TheOwnerDetailsShowTheUpdatedContactsAndThePreviousValuesThatWereNotChanged()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var submittedUpdate = _state.Get<Owner>("OwnerUpdateRequest");
        var fetched = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var ownerId = registered.Id;

        fetched.Id.Should().Be(ownerId, $"owner {ownerId} must still be reachable by the same id after the update");
        fetched.City.Should().Be(submittedUpdate.City, $"owner {ownerId}'s details must show the new city that was submitted");
        fetched.Telephone.Should().Be(submittedUpdate.Telephone, $"owner {ownerId}'s details must show the new telephone that was submitted");
        fetched.FirstName.Should().Be(registered.FirstName, $"owner {ownerId}'s first name must be unchanged by a contacts-only update");
        fetched.LastName.Should().Be(registered.LastName, $"owner {ownerId}'s last name must be unchanged by a contacts-only update");
        fetched.Address.Should().Be(registered.Address, $"owner {ownerId}'s address must be unchanged by a contacts-only update");
        fetched.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.BeEmpty($"owner {ownerId} has no pets, and changing contacts must not add any");
    }

    // AC-F01-02 step 3: "exactly one" per §10.4, plus a negative check that the previous city/telephone
    // combination (from the registration response, before the update) no longer appears in the list --
    // the AC's own wording ("no entry ... with the previous city and telephone from Given").
    [Then("the owner appears exactly once in the owners list with the updated contacts and without the previous ones")]
    public void TheOwnerAppearsExactlyOnceInTheOwnersListWithTheUpdatedContactsAndWithoutThePreviousOnes()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var submittedUpdate = _state.Get<Owner>("OwnerUpdateRequest");
        var ownerId = registered.Id ?? throw new InvalidOperationException("Registered owner carries no id.");
        var directory = _state.Get<ApiResponse<List<Owner>>>("OwnerDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /owners answered 200 with no body.");

        directory.Should().ContainSingle(o => o.Id == ownerId,
            $"updating owner {ownerId}'s contacts must not create a duplicate entry in the owners list");

        var listed = directory.Single(o => o.Id == ownerId);
        listed.City.Should().Be(submittedUpdate.City, $"owner {ownerId}'s entry in the owners list must carry the new city");
        listed.Telephone.Should().Be(submittedUpdate.Telephone, $"owner {ownerId}'s entry in the owners list must carry the new telephone");

        directory.Should().NotContain(o => o.City == registered.City && o.Telephone == registered.Telephone,
            $"the owners list must not still carry owner {ownerId}'s previous city/telephone combination after the update");
    }

    // AC-F01-03 step 1: EnsureStatus inside the When step already covers "code 204"; this is the AC's
    // other half -- "the response body is empty" -- the same §7 rule AC-F01-02's PUT check already
    // established, now for the DELETE response instead of the PUT response.
    [Then("the owner deregistration returns no owner data")]
    public void TheOwnerDeregistrationReturnsNoOwnerData()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var response = _state.Get<ApiResponse<object?>>("OwnerDeleteResponse");
        var ownerId = registered.Id;

        response.RawContent.Should().BeNullOrEmpty($"owner {ownerId}'s deregistration must answer with an empty body (§7)");
    }

    // AC-F01-03 step 2: the code (404) is asserted by EnsureStatus inside "an attempt is made to open
    // the owner details"; this checks the other half §7 states for every 404 -- no body to carry.
    [Then("the owner details are no longer available")]
    public void TheOwnerDetailsAreNoLongerAvailable()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var response = _state.Get<ApiResponse<Owner>>("OwnerGetByIdAfterDeleteResponse");
        var ownerId = registered.Id;

        response.RawContent.Should().BeNullOrEmpty($"owner {ownerId}'s details must return no body once deregistered (§7)");
    }

    // AC-F01-03 step 3: the negative half of §10.4's "exactly one" rule -- this owner's id must be
    // absent -- paired with a check that deregistering one owner did not clear the rest of the
    // seeded/created owners, per the AC's own wording ("other owners are present in the list").
    [Then("the owner is missing from the owners list while other owners remain")]
    public void TheOwnerIsMissingFromTheOwnersListWhileOtherOwnersRemain()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var ownerId = registered.Id ?? throw new InvalidOperationException("Registered owner carries no id.");
        var directory = _state.Get<ApiResponse<List<Owner>>>("OwnerDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /owners answered 200 with no body.");

        directory.Should().NotContain(o => o.Id == ownerId,
            $"owner {ownerId} must no longer appear in the owners list after deregistration");
        directory.Should().NotBeEmpty(
            $"deregistering owner {ownerId} must not clear the rest of the owners list");
    }

    [Then("the repeated deregistration reports that the owner no longer exists")]
    public void TheRepeatedDeregistrationReportsThatTheOwnerNoLongerExists()
    {
        var registered = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var response = _state.Get<ApiResponse<object?>>("OwnerDeleteAgainResponse");
        var ownerId = registered.Id;

        response.RawContent.Should().BeNullOrEmpty(
            $"a 404 for owner {ownerId}'s repeated deregistration must carry no body (§7)");
    }

    // AC-F01-04 step 1: confirms the owner's just-added pet, together with that pet's own
    // just-recorded visit, show up nested inside the owner details before the deregistration this
    // AC exercises removes them -- the baseline the later 404 checks in PetAssertionSteps and
    // VisitAssertionSteps are measured against.
    [Then("the owner details show the pet with its recorded visit")]
    public void TheOwnerDetailsShowThePetWithItsRecordedVisit()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Created pet carries no id.");
        var visitId = _state.CreatedVisit.Id ?? throw new InvalidOperationException("Created visit carries no id.");
        var ownerId = owner.Id;

        owner.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.ContainSingle(p => p.Id == petId,
                $"owner {ownerId}'s details must show the pet {petId} that was just added");

        var pet = owner.Pets!.Single(p => p.Id == petId);
        pet.Visits.Should().NotBeNull($"pet {petId}'s entry in the owner details must carry a visits field")
            .And.ContainSingle(v => v.Id == visitId,
                $"pet {petId}'s entry in the owner details must show the visit {visitId} that was just recorded");
    }

    // AC-F02-01 step 3: the owner details' nested pet is compared against OwnerAddPetResponse (the
    // POST's own body) rather than the base PetCase, the same "compare against what was submitted"
    // rule this file already applies to owner fields, and "exactly one" per §10.4.
    [Then("the owner details show the added pet with the submitted values")]
    public void TheOwnerDetailsShowTheAddedPetWithTheSubmittedValues()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var addedPet = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var petId = addedPet.Id ?? throw new InvalidOperationException("Created pet carries no id.");
        var ownerId = owner.Id;

        owner.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.ContainSingle(p => p.Id == petId,
                $"owner {ownerId}'s details must show the pet {petId} that was just added");

        var pet = owner.Pets!.Single(p => p.Id == petId);
        pet.Name.Should().Be(addedPet.Name, $"owner {ownerId}'s pet {petId} must show the submitted name");
        pet.BirthDate.Should().Be(addedPet.BirthDate, $"owner {ownerId}'s pet {petId} must show the submitted birth date");
        pet.Type.Id.Should().Be(addedPet.Type.Id, $"owner {ownerId}'s pet {petId} must show the type from the directory");
    }

    // AC-F02-03 step 2: compared against _state.CreatedPet.Name -- "the pet details are updated"
    // already folded the new name into CreatedPet once the PUT succeeded, so the owner-nested
    // reading is checked against that, not against the pre-rename addition response.
    [Then("the owner details show the pet with its new name")]
    public void TheOwnerDetailsShowThePetWithItsNewName()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Created pet carries no id.");
        var expectedName = _state.CreatedPet.Name;
        var ownerId = owner.Id;

        owner.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.ContainSingle(p => p.Id == petId,
                $"owner {ownerId}'s details must show exactly one entry for pet {petId} after the rename");

        var pet = owner.Pets!.Single(p => p.Id == petId);
        pet.Name.Should().Be(expectedName, $"owner {ownerId}'s pet {petId} must show the new name, not the one it was created with");
    }

    // AC-F02-06 step 3: both pets this AC adds must show up as two distinct entries, each keeping
    // its own name — compared against OwnerAddPetResponse/OwnerAddSecondPetResponse (what each POST
    // actually returned), not against _state.CreatedPet, which by this point holds only the second
    // pet.
    [Then("the owner details show both pets with their own names")]
    public void TheOwnerDetailsShowBothPetsWithTheirOwnNames()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var first = _state.Get<ApiResponse<Pet>>("OwnerAddPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var second = _state.Get<ApiResponse<Pet>>("OwnerAddSecondPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var ownerId = owner.Id;

        owner.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.HaveCount(2, $"owner {ownerId} must show exactly the two pets that were added");

        owner.Pets.Should().ContainSingle(p => p.Id == first.Id,
            $"owner {ownerId}'s details must show the first pet {first.Id}");
        owner.Pets.Should().ContainSingle(p => p.Id == second.Id,
            $"owner {ownerId}'s details must show the second pet {second.Id}");

        var firstNested = owner.Pets!.Single(p => p.Id == first.Id);
        var secondNested = owner.Pets!.Single(p => p.Id == second.Id);

        firstNested.Name.Should().Be(first.Name, $"owner {ownerId}'s first pet {first.Id} must keep its own name");
        secondNested.Name.Should().Be(second.Name, $"owner {ownerId}'s second pet {second.Id} must keep its own name, not overwritten by the first");
    }

    // AC-F02-06 step 5: after the first pet is deleted, the owner's pets array must contain exactly
    // the second pet, with the name it was created with — deleting one sibling must not touch the
    // other's data, only remove it from the list.
    [Then("the owner details show only the second pet with its original name")]
    public void TheOwnerDetailsShowOnlyTheSecondPetWithItsOriginalName()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        var second = _state.Get<ApiResponse<Pet>>("OwnerAddSecondPetResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var ownerId = owner.Id;

        owner.Pets.Should().NotBeNull($"owner {ownerId}'s response must carry a pets field")
            .And.HaveCount(1, $"owner {ownerId} must show only the second pet after the first was deleted, not both")
            .And.ContainSingle(p => p.Id == second.Id,
                $"owner {ownerId}'s details must show exactly the second pet {second.Id} after the first was deleted");

        var pet = owner.Pets!.Single(p => p.Id == second.Id);
        pet.Name.Should().Be(second.Name, $"owner {ownerId}'s second pet {second.Id} must keep its original name after the first pet was deleted");
    }
}
