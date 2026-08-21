using System.Net;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// REQUEST STEPS (design §4, D-13) over the four direct pet routes of §7. Creation has no step here —
// §7 states a pet is created only via the nested owner route, covered by OwnerSteps — and deletion is
// only here, never via the owner. Each step issues one request, asserts the code via EnsureStatus, and
// stores the typed response in ScenarioState.
[Binding]
public sealed class PetSteps
{
    private readonly PetsService _pets;
    private readonly ScenarioState _state;

    public PetSteps(PetsService pets, ScenarioState state)
    {
        _pets = pets;
        _state = state;
    }

    [When("the pets directory is requested")]
    public async Task RequestPetsDirectoryAsync()
    {
        var response = await _pets.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the pet details are opened")]
    public async Task OpenPetDetailsAsync()
    {
        var pet = RequirePet();
        var response = await _pets.GetById(pet.Id!.Value);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the pet's details are updated directly")]
    public async Task UpdatePetDetailsDirectlyAsync()
    {
        var pet = RequirePet();
        var updated = new Pet
        {
            Id = pet.Id,
            Name = UniqueData.PetName(pet.Name),
            BirthDate = pet.BirthDate,
            Type = pet.Type,
            OwnerId = pet.OwnerId,
        };

        var response = await _pets.Update(pet.Id!.Value, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);

        _state.CreatedPet = updated;
        _state.LastResponse = response;
    }

    [When("the pet is deleted")]
    public async Task DeletePetAsync()
    {
        var pet = RequirePet();
        var response = await _pets.Delete(pet.Id!.Value);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.LastResponse = response;
    }

    private Pet RequirePet() =>
        _state.CreatedPet ?? throw new InvalidOperationException(
            "No pet is known yet in this scenario — add one to an owner first.");
}
