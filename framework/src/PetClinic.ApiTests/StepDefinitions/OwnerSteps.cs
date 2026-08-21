using System.Linq;
using System.Net;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// REQUEST STEPS (design §4, D-13) over the eight owner routes of §7: the direct owner CRUD plus the
// two nested pet routes (a pet is created and updated only through its owner). Nothing here derives
// from any AC — each step issues one request, asserts the code §7 promises via EnsureStatus, and
// stores the typed response in ScenarioState. "an owner is registered" and "a pet is added to the
// owner" are bound as both [Given] and [When]: the same sentence is a precondition for a later flow
// and the action under test for its own AC (design §4.4).
[Binding]
public sealed class OwnerSteps
{
    private readonly OwnersService _owners;
    private readonly ScenarioState _state;
    private readonly ScenarioContext _scenarioContext;

    public OwnerSteps(OwnersService owners, ScenarioState state, ScenarioContext scenarioContext)
    {
        _owners = owners;
        _state = state;
        _scenarioContext = scenarioContext;
    }

    [Given("an owner is registered")]
    [When("an owner is registered")]
    public async Task RegisterOwnerAsync()
    {
        var data = TestDataProvider.For<OwnerCase>(_scenarioContext);
        var owner = new Owner
        {
            FirstName = data.FirstName,
            LastName = UniqueData.LastName(data.LastName),
            Address = data.Address,
            City = data.City,
            Telephone = data.Telephone,
        };

        var response = await _owners.Create(owner);
        response.EnsureStatus(HttpStatusCode.Created);

        _state.CreatedOwner = response.Body;
        _state.LastResponse = response;
        if (response.Body?.Id is int ownerId)
        {
            _state.Tracker.TrackOwner(ownerId);
        }
    }

    [When("the owners directory is requested")]
    public async Task RequestOwnersDirectoryAsync()
    {
        var response = await _owners.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the owner details are opened")]
    public async Task OpenOwnerDetailsAsync()
    {
        var owner = RequireOwner();
        var response = await _owners.GetById(owner.Id!.Value);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the owner's details are updated")]
    public async Task UpdateOwnerDetailsAsync()
    {
        var owner = RequireOwner();
        var newTelephone = UniqueData.Telephone();
        var newCity = $"UpdatedCity{newTelephone}";
        var requestBody = new Owner
        {
            FirstName = owner.FirstName,
            LastName = owner.LastName,
            Address = owner.Address,
            City = newCity,
            Telephone = newTelephone,
        };

        var response = await _owners.Update(owner.Id!.Value, requestBody);
        response.EnsureStatus(HttpStatusCode.NoContent);

        _state.CreatedOwner = new Owner
        {
            Id = owner.Id,
            FirstName = owner.FirstName,
            LastName = owner.LastName,
            Address = owner.Address,
            City = newCity,
            Telephone = newTelephone,
        };
        _state.LastResponse = response;
    }

    [When("the owner is deregistered")]
    public async Task DeregisterOwnerAsync()
    {
        var owner = RequireOwner();
        var response = await _owners.Delete(owner.Id!.Value);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.LastResponse = response;
    }

    [Given("a pet is added to the owner")]
    [When("a pet is added to the owner")]
    public async Task AddPetToOwnerAsync()
    {
        var owner = RequireOwner();
        var petType = ResolvePetType();
        var data = TestDataProvider.For<PetCase>(_scenarioContext);
        var pet = new Pet
        {
            Name = UniqueData.PetName(data.Name),
            BirthDate = data.BirthDate,
            Type = petType,
        };

        var response = await _owners.AddPet(owner.Id!.Value, pet);
        response.EnsureStatus(HttpStatusCode.Created);

        _state.CreatedPet = response.Body;
        _state.LastResponse = response;
        if (response.Body?.Id is int petId)
        {
            _state.Tracker.TrackPet(petId);
        }
    }

    [When("the pet is opened from the owner details")]
    public async Task OpenPetFromOwnerDetailsAsync()
    {
        var owner = RequireOwner();
        var pet = RequirePet();
        var response = await _owners.GetPet(owner.Id!.Value, pet.Id!.Value);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the pet is updated through the owner details")]
    public async Task UpdatePetThroughOwnerDetailsAsync()
    {
        var owner = RequireOwner();
        var pet = RequirePet();
        var updated = new Pet
        {
            Id = pet.Id,
            Name = UniqueData.PetName(pet.Name),
            BirthDate = pet.BirthDate,
            Type = pet.Type,
            OwnerId = pet.OwnerId,
        };

        var response = await _owners.UpdatePet(owner.Id!.Value, pet.Id!.Value, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);

        _state.CreatedPet = updated;
        _state.LastResponse = response;
    }

    private Owner RequireOwner() =>
        _state.CreatedOwner ?? throw new InvalidOperationException(
            "No owner is known yet in this scenario — register one first.");

    private Pet RequirePet() =>
        _state.CreatedPet ?? throw new InvalidOperationException(
            "No pet is known yet in this scenario — add one to the owner first.");

    // The type an added pet points at: the scenario's own, freshly created type takes priority
    // (§10.9 — an AC that asserts on the directory must not share a seeded type with other data),
    // otherwise the first entry of the most recently requested pet types directory.
    private PetType ResolvePetType()
    {
        if (_state.CreatedPetType is { } createdType)
        {
            return createdType;
        }

        var directory = _state.LastResponseAs<List<PetType>>();
        return directory.Body?.FirstOrDefault()
            ?? throw new InvalidOperationException(
                "No pet type is available yet — request the pet types directory or create one first.");
    }
}
