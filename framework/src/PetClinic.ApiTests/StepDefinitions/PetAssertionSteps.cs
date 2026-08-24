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
}
