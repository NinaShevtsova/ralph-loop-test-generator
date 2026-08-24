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
}
