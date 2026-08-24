using System.Net;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// The 4 request steps of §7 that PetsService exposes. §7's asymmetry means neither Create nor
// Delete belongs here: a pet is created only via OwnersService.AddPet and deleted only via
// PetsService.Delete, so this file has one route the owner-nested steps do not: the direct delete.
[Binding]
public sealed class PetSteps
{
    private readonly PetsService _pets;
    private readonly ScenarioState _state;
    private readonly TestDataProvider _data;

    public PetSteps(PetsService pets, ScenarioState state, TestDataProvider data)
    {
        _pets = pets;
        _state = state;
        _data = data;
    }

    [When("the pets directory is requested")]
    public async Task ThePetsDirectoryIsRequested()
    {
        var response = (await _pets.GetAll()).EnsureStatus(HttpStatusCode.OK);
        _state.Set("PetDirectoryResponse", response);
    }

    [When("the pet details are opened")]
    public async Task ThePetDetailsAreOpened()
    {
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id to open.");
        var response = (await _pets.GetById(petId)).EnsureStatus(HttpStatusCode.OK);

        _state.CreatedPet = response.Body ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        _state.Set("PetGetByIdResponse", response);
    }

    // §7's first pet-update route. Type is carried over from the pet's current state, never
    // re-resolved — this route changes the pet's own fields, not what type it is. `Visits` is left
    // unset on `updated` for the call itself (Pet.Visits is nullable and omitted-when-null, so the
    // wire body carries no `visits` field at all, per AC-F02-05); it is folded back in only after the
    // call succeeds, from `existing`, so CreatedPet keeps reporting the real visit history instead of
    // inventing an empty one the PUT never actually sent.
    [When("the pet details are updated")]
    public async Task ThePetDetailsAreUpdated()
    {
        var existing = _state.CreatedPet;
        var petId = existing.Id ?? throw new InvalidOperationException("Pet has no id to update.");
        var data = _data.For<PetCase>();

        var updated = new Pet
        {
            Name = UniqueData.PetName(data.Name),
            BirthDate = existing.BirthDate,
            Type = existing.Type,
        };

        var response = (await _pets.Update(petId, updated)).EnsureStatus(HttpStatusCode.NoContent);

        updated.Id = petId;
        updated.OwnerId = existing.OwnerId;
        updated.Visits = existing.Visits;
        _state.CreatedPet = updated;
        _state.Set("PetUpdateResponse", response);
    }

    [When("the pet is deleted")]
    public async Task ThePetIsDeleted()
    {
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id to delete.");
        var response = (await _pets.Delete(petId)).EnsureStatus(HttpStatusCode.NoContent);
        _state.Set("PetDeleteResponse", response);
    }

    // AC-F01-04 step 4: a GET on a pet removed by its owner's deregistration cascade, not by "the
    // pet is deleted". Expected code is the opposite of "the pet details are opened" (404, not
    // 200), so this is its own step rather than a reworded one.
    [When("an attempt is made to open the pet details")]
    public async Task AnAttemptIsMadeToOpenThePetDetails()
    {
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id to open.");
        var response = (await _pets.GetById(petId)).EnsureStatus(HttpStatusCode.NotFound);
        _state.Set("PetGetByIdAfterDeleteResponse", response);
    }
}
