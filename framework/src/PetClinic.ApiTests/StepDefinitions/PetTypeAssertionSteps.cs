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
        var directory = _state.Get<ApiResponse<List<PetType>>>("PetTypeDirectoryResponse").Body
            ?? throw new InvalidOperationException("GET /pettypes answered 200 with no body.");

        directory.Should().NotBeEmpty("a pet cannot be given a type if the directory has none to offer");
    }
}
