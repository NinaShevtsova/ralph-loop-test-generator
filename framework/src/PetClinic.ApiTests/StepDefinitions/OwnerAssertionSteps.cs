using FluentAssertions;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// Assertion ("Then") steps for F-01's owner-lifecycle ACs (stage 1). The request steps these build
// on live in OwnerSteps.cs (stage 0, design D-13); this file issues no requests of its own, it only
// reads back what those steps already stored in ScenarioState and asserts on it.
[Binding]
public sealed class OwnerAssertionSteps
{
    private readonly ScenarioState _state;
    private readonly TestDataProvider _data;

    public OwnerAssertionSteps(ScenarioState state, TestDataProvider data)
    {
        _state = state;
        _data = data;
    }

    // AC-F01-01 step 1: compared against the base OwnerCase, not _state.CreatedOwner -- that field
    // is set to this very response body, so comparing it to itself would prove nothing. lastName
    // alone is a StartWith: UniqueData.LastName appends a suffix to, not instead of, the base value
    // (§10.5), so an exact match would fail by construction.
    [Then("the created owner has an assigned id, the submitted values and an empty pets list")]
    public void TheCreatedOwnerHasAnAssignedIdTheSubmittedValuesAndAnEmptyPetsList()
    {
        var owner = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var expected = _data.For<OwnerCase>();

        owner.Id.Should().NotBeNull("a created owner must carry the id the API assigned it");
        owner.FirstName.Should().Be(expected.FirstName);
        owner.LastName.Should().StartWith(expected.LastName, "the unique suffix is appended to the base last name, not a replacement for it");
        owner.Address.Should().Be(expected.Address);
        owner.City.Should().Be(expected.City);
        owner.Telephone.Should().Be(expected.Telephone);
        owner.Pets.Should().NotBeNull().And.BeEmpty("a newly registered owner has no pets yet");
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

        fetched.Should().BeEquivalentTo(created,
            "opening the owner details must return exactly what registration already returned, with no other state saved");
    }

    // AC-F01-01 step 3: "exactly one" per §10.4 -- never an absolute count of the whole list, only
    // that this owner's own id occurs once.
    [Then("the owner appears exactly once in the owners list with the submitted values")]
    public void TheOwnerAppearsExactlyOnceInTheOwnersListWithTheSubmittedValues()
    {
        var created = _state.Get<ApiResponse<Owner>>("OwnerCreateResponse").Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var ownerId = created.Id ?? throw new InvalidOperationException("Created owner carries no id.");
        var directory = _state.Get<ApiResponse<List<Owner>>>("OwnerDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /owners answered 200 with no body.");

        directory.Should().ContainSingle(o => o.Id == ownerId,
            "registration must not create a duplicate entry in the owners list");

        var listed = directory.Single(o => o.Id == ownerId);
        listed.FirstName.Should().Be(created.FirstName);
        listed.LastName.Should().Be(created.LastName);
        listed.Address.Should().Be(created.Address);
        listed.City.Should().Be(created.City);
        listed.Telephone.Should().Be(created.Telephone);
    }
}
