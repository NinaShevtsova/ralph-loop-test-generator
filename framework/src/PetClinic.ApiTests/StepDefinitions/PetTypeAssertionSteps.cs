using FluentAssertions;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Support;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// Assertion ("Then") steps for pet-type-directory reads (stage 1). The request step this builds on
// lives in PetTypeSteps.cs (stage 0, design D-13); this file issues no requests of its own.
[Binding]
public sealed class PetTypeAssertionSteps
{
    private readonly ScenarioState _state;

    public PetTypeAssertionSteps(ScenarioState state)
    {
        _state = state;
    }

    // AC-F02-01 step 1: the common precondition already resolves the shared pet type from the first
    // element of this same response (PetTypeSteps.cs sets CreatedPetType there), so this only
    // confirms the directory was non-empty -- the precondition every later step in the scenario
    // relies on without checking it again.
    [Then("the directory returns at least one pet type")]
    public void TheDirectoryReturnsAtLeastOnePetType()
    {
        var directory = _state.Body<List<PetType>>("PetTypeDirectoryResponse");

        directory.Should().NotBeEmpty("a pet cannot be given a type if the directory has none to offer");
    }

    // AC-F02-10 step 5: this AC creates its own pet type ("a pet type is added to the directory",
    // §10.9) precisely so the assertion below can compare against PetTypeCreateResponse -- the
    // POST's own body -- rather than a shared directory entry another test could have mutated.
    // Deleting the pet must leave this record exactly as it was created.
    [Then("the pet type exists, unchanged")]
    public void ThePetTypeExistsUnchanged()
    {
        var fetched = _state.Body<PetType>("PetTypeGetByIdResponse");
        var created = _state.Body<PetType>("PetTypeCreateResponse");
        var petTypeId = fetched.Id;

        fetched.Id.Should().Be(created.Id, $"pet type {petTypeId} must still be reachable by the same id after its pet was deleted");
        fetched.Name.Should().Be(created.Name, $"pet type {petTypeId}'s name must be unchanged after its pet was deleted");
    }
}
