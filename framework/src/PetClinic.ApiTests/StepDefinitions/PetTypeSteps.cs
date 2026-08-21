using System.Net;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// REQUEST STEPS (design §4, D-13) over the four pettypes routes of §7 — no Update route exists (§7:
// "not used in the ACs"). "a pet type is added to the directory" is bound as both [Given] and [When]:
// a precondition for §10.9's own-type scenarios and the action under test for its own AC.
[Binding]
public sealed class PetTypeSteps
{
    private readonly PetTypesService _petTypes;
    private readonly ScenarioState _state;
    private readonly ScenarioContext _scenarioContext;

    public PetTypeSteps(PetTypesService petTypes, ScenarioState state, ScenarioContext scenarioContext)
    {
        _petTypes = petTypes;
        _state = state;
        _scenarioContext = scenarioContext;
    }

    [Given("a pet type is added to the directory")]
    [When("a pet type is added to the directory")]
    public async Task AddPetTypeToDirectoryAsync()
    {
        var data = TestDataProvider.For<PetTypeCase>(_scenarioContext);
        var petType = new PetType { Name = UniqueData.PetTypeName(data.Name) };

        var response = await _petTypes.Create(petType);
        response.EnsureStatus(HttpStatusCode.Created);

        _state.CreatedPetType = response.Body;
        _state.LastResponse = response;
        if (response.Body?.Id is int petTypeId)
        {
            _state.Tracker.TrackPetType(petTypeId);
        }
    }

    [When("the pet types directory is requested")]
    public async Task RequestPetTypesDirectoryAsync()
    {
        var response = await _petTypes.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the pet type details are opened")]
    public async Task OpenPetTypeDetailsAsync()
    {
        var petType = RequirePetType();
        var response = await _petTypes.GetById(petType.Id!.Value);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the pet type is removed from the directory")]
    public async Task RemovePetTypeFromDirectoryAsync()
    {
        var petType = RequirePetType();
        var response = await _petTypes.Delete(petType.Id!.Value);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.LastResponse = response;
    }

    private PetType RequirePetType() =>
        _state.CreatedPetType ?? throw new InvalidOperationException(
            "No pet type is known yet in this scenario — add one to the directory first.");
}
