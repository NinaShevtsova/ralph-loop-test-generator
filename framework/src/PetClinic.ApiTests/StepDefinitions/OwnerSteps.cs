using System.Net;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// The 8 request steps of §7 that OwnersService exposes (design D-13): the direct owner routes plus
// the two nested pet routes §7 places on the owner rather than on PetsService. Nothing here derives
// from an AC — every step issues its request, asserts the one code that route answers with on the
// happy path, and stores the result in ScenarioState. Assertion ("Then") steps belong to stage 1.
[Binding]
public sealed class OwnerSteps
{
    private readonly OwnersService _owners;
    private readonly ScenarioState _state;
    private readonly TestDataProvider _data;

    public OwnerSteps(OwnersService owners, ScenarioState state, TestDataProvider data)
    {
        _owners = owners;
        _state = state;
        _data = data;
    }

    // One of the four creation sentences that is also its own precondition (S12 DoD): a scenario
    // whose AC is "an owner is registered" uses this as a When, and a scenario that needs an owner
    // only to build on top of it uses the identical sentence as a Given.
    [Given("an owner is registered")]
    [When("an owner is registered")]
    public async Task AnOwnerIsRegistered()
    {
        var data = _data.For<OwnerCase>();
        var owner = new Owner
        {
            FirstName = data.FirstName,
            LastName = UniqueData.LastName(data.LastName),
            Address = data.Address,
            City = data.City,
            Telephone = data.Telephone,
        };

        var response = (await _owners.Create(owner)).EnsureStatus(HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");

        _state.CreatedOwner = created;
        _state.Set("OwnerCreateRequest", owner);
        _state.Set("OwnerCreateResponse", response);
        _state.Tracker.TrackOwner(created.Id ?? throw new InvalidOperationException("Created owner carries no id."));
    }

    [When("the owners directory is requested")]
    public async Task TheOwnersDirectoryIsRequested()
    {
        var response = (await _owners.GetAll()).EnsureStatus(HttpStatusCode.OK);
        _state.Set("OwnerDirectoryResponse", response);
    }

    [When("the owner details are opened")]
    public async Task TheOwnerDetailsAreOpened()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to open.");
        var response = (await _owners.GetById(ownerId)).EnsureStatus(HttpStatusCode.OK);

        _state.CreatedOwner = response.Body ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        _state.Set("OwnerGetByIdResponse", response);
    }

    // §7 lists firstName/lastName/address/city/telephone as the owner's only request fields, so the
    // body built here never carries the read-only `id`. The only owner-update AC in the flows
    // (F-01) changes `city` and `telephone` and keeps `firstName`/`lastName`/`address` from the
    // previous state — the one shape this single generic step can ever be asked for, since there is
    // no per-AC parameter here to vary it. UniqueData has no city helper (city carries no character
    // constraint of its own), so PetTypeName's 80-char, collision-free suffix generator is reused
    // for it rather than inventing a second one just for this field.
    [When("the owner's details are updated")]
    public async Task TheOwnersDetailsAreUpdated()
    {
        var existing = _state.CreatedOwner;
        var ownerId = existing.Id ?? throw new InvalidOperationException("Owner has no id to update.");
        var data = _data.For<OwnerCase>();

        var updated = new Owner
        {
            FirstName = existing.FirstName,
            LastName = existing.LastName,
            Address = existing.Address,
            City = UniqueData.PetTypeName(data.City),
            Telephone = UniqueData.Telephone(),
        };

        var response = (await _owners.Update(ownerId, updated)).EnsureStatus(HttpStatusCode.NoContent);

        // PUT answers 204 with no body (§7) — the id is not part of the request, so it is folded back
        // in only now, for the benefit of steps that read CreatedOwner afterwards.
        updated.Id = ownerId;
        _state.CreatedOwner = updated;
        _state.Set("OwnerUpdateResponse", response);
    }

    [When("the owner is deleted")]
    public async Task TheOwnerIsDeleted()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to delete.");
        var response = (await _owners.Delete(ownerId)).EnsureStatus(HttpStatusCode.NoContent);
        _state.Set("OwnerDeleteResponse", response);
    }

    // §7: a pet is created ONLY through this nested route. Its type is resolved by id alone (§11), so
    // it is read back from whichever PetType a PetTypeSteps step already stored — never a literal.
    [Given("a pet is added to the owner")]
    [When("a pet is added to the owner")]
    public async Task APetIsAddedToTheOwner()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to add a pet to.");
        var data = _data.For<PetCase>();
        var petType = _state.CreatedPetType;

        var pet = new Pet
        {
            Name = UniqueData.PetName(data.Name),
            BirthDate = data.BirthDate,
            Type = new PetType { Id = petType.Id, Name = petType.Name },
        };

        var response = (await _owners.AddPet(ownerId, pet)).EnsureStatus(HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");

        _state.CreatedPet = created;
        _state.Set("OwnerAddPetResponse", response);
        _state.Tracker.TrackPet(created.Id ?? throw new InvalidOperationException("Created pet carries no id."));
    }

    // Deliberately does NOT overwrite CreatedPet: US-02 asks that the nested and the direct
    // representation of the same pet agree, and a later assertion step needs both readings on hand to
    // compare, not one collapsed into the other. ScenarioState is addressed by key (S9's DoD) for
    // exactly this reason.
    [When("the pet is opened from the owner details")]
    public async Task ThePetIsOpenedFromTheOwnerDetails()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id.");
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id.");

        var response = (await _owners.GetPet(ownerId, petId)).EnsureStatus(HttpStatusCode.OK);
        _state.Set("OwnerGetPetResponse", response);
    }

    // §7's second pet-update route. The body carries only name/birthDate/type (never id, ownerId or
    // visits — Pet.Visits is nullable and omitted-when-null, so leaving `updated.Visits` unset keeps
    // it off the wire): Type is copied from the pet's current state rather than re-resolved, since
    // this route does not change what type the pet is. `Visits` is folded back in from `existing`
    // only after the call succeeds, so CreatedPet keeps reporting the real visit history rather than
    // the empty one the PUT never actually sent.
    [When("the pet is updated through the owner")]
    public async Task ThePetIsUpdatedThroughTheOwner()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id.");
        var existing = _state.CreatedPet;
        var petId = existing.Id ?? throw new InvalidOperationException("Pet has no id to update.");
        var data = _data.For<PetCase>();

        var updated = new Pet
        {
            Name = UniqueData.PetName(data.Name),
            BirthDate = existing.BirthDate,
            Type = existing.Type,
        };

        var response = (await _owners.UpdatePet(ownerId, petId, updated)).EnsureStatus(HttpStatusCode.NoContent);

        updated.Id = petId;
        updated.OwnerId = ownerId;
        updated.Visits = existing.Visits;
        _state.CreatedPet = updated;
        _state.Set("OwnerUpdatePetResponse", response);
    }
}
