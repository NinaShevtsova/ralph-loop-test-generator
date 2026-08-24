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
}
