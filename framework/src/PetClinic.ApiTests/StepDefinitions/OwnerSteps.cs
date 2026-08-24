using System.Net;
using System.Text.Json.Serialization;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// AC-F01-02's own "new city and telephone" (data block key "ownerContacts", TestDataProvider's
// naming convention for a case type stripped of its "Case" suffix). Lives here rather than under
// TestData/Cases because that folder is outside the stage-1 fence; this AC is the only caller.
internal sealed class OwnerContactsCase
{
    [JsonPropertyName("city")]
    public string City { get; set; } = string.Empty;

    [JsonPropertyName("telephone")]
    public string Telephone { get; set; } = string.Empty;
}

// The 8 request steps of §7 that OwnersService exposes (design D-13): the direct owner routes plus
// the two nested pet routes §7 places on the owner rather than on PetsService. Nothing here derives
// from an AC — every step issues its request, asserts the one code that route answers with on the
// happy path, and stores the result in ScenarioState. Assertion ("Then") steps belong to stage 1.
[Binding]
public sealed class OwnerSteps
{
    private readonly OwnersService _owners;
    private readonly ScenarioState _state;
    private readonly StatusCheck _check;
    private readonly TestDataProvider _data;

    public OwnerSteps(OwnersService owners, ScenarioState state, StatusCheck check, TestDataProvider data)
    {
        _owners = owners;
        _state = state;
        _check = check;
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

        var response = _check.Expect(await _owners.Create(owner), HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");

        _state.CreatedOwner = created;
        _state.Set("OwnerCreateRequest", owner);
        _state.Set("OwnerCreateResponse", response);
        _state.Tracker.TrackOwner(created.Id ?? throw new InvalidOperationException("Created owner carries no id."));
    }

    [When("the owners directory is requested")]
    public async Task TheOwnersDirectoryIsRequested()
    {
        var response = _check.Expect(await _owners.GetAll(), HttpStatusCode.OK);
        _state.Set("OwnerDirectoryResponse", response);
    }

    [When("the owner details are opened")]
    public async Task TheOwnerDetailsAreOpened()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to open.");
        var response = _check.Expect(await _owners.GetById(ownerId), HttpStatusCode.OK);

        _state.CreatedOwner = response.Body ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
        _state.Set("OwnerGetByIdResponse", response);
    }

    // §7 lists firstName/lastName/address/city/telephone as the owner's only request fields, so the
    // body built here never carries the read-only `id`. The only owner-update AC in the flows
    // (F-01) changes `city` and `telephone` and keeps `firstName`/`lastName`/`address` from the
    // previous state — the one shape this single generic step can ever be asked for, since there is
    // no per-AC parameter here to vary it. The new city/telephone are the AC's own "ownerContacts"
    // data block, not a suffixed copy of the registration city: the AC's Given asks for values
    // "prepared per the Test data — owner table", and a value invented at call time would leave the
    // data file with no view of what the update actually submits.
    [When("the owner's details are updated")]
    public async Task TheOwnersDetailsAreUpdated()
    {
        var existing = _state.CreatedOwner;
        var ownerId = existing.Id ?? throw new InvalidOperationException("Owner has no id to update.");
        var newContacts = _data.For<OwnerContactsCase>();

        var updated = new Owner
        {
            FirstName = existing.FirstName,
            LastName = existing.LastName,
            Address = existing.Address,
            City = newContacts.City,
            Telephone = newContacts.Telephone,
        };

        var response = _check.Expect(await _owners.Update(ownerId, updated), HttpStatusCode.NoContent);

        // PUT answers 204 with no body (§7) — the id is not part of the request, so it is folded back
        // in only now, for the benefit of steps that read CreatedOwner afterwards. Stored a second
        // time under its own key because a later "the owner details are opened" step overwrites
        // CreatedOwner with the GET's body — an assertion comparing the fetched owner against what
        // was actually submitted needs this copy, not the overwritten one.
        updated.Id = ownerId;
        _state.CreatedOwner = updated;
        _state.Set("OwnerUpdateRequest", updated);
        _state.Set("OwnerUpdateResponse", response);
    }

    [When("the owner is deleted")]
    public async Task TheOwnerIsDeleted()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to delete.");
        var response = _check.Expect(await _owners.Delete(ownerId), HttpStatusCode.NoContent);
        _state.Set("OwnerDeleteResponse", response);
    }

    // AC-F01-03 step 2: a GET on an owner that "the owner is deleted" already removed. Distinct from
    // "the owner details are opened" because the expected code is the opposite one (404, not 200) --
    // reusing that step's method would either throw on its own EnsureStatus(OK) or weaken it to accept
    // both codes, which is exactly the reuse-by-reword the gate exists to catch.
    [When("an attempt is made to open the owner details")]
    public async Task AnAttemptIsMadeToOpenTheOwnerDetails()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to open.");
        var response = _check.Expect(await _owners.GetById(ownerId), HttpStatusCode.NotFound);
        _state.Set("OwnerGetByIdAfterDeleteResponse", response);
    }

    // AC-F01-03 step 4: the same DELETE as "the owner is deleted", now expected to answer 404 because
    // the owner no longer exists. A second binding on the same method would force one of the two
    // EnsureStatus codes to be wrong, so this is its own step rather than a second attribute.
    [When("the owner is deleted again")]
    public async Task TheOwnerIsDeletedAgain()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id to delete.");
        var response = _check.Expect(await _owners.Delete(ownerId), HttpStatusCode.NotFound);
        _state.Set("OwnerDeleteAgainResponse", response);
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

        var response = _check.Expect(await _owners.AddPet(ownerId, pet), HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");

        _state.CreatedPet = created;
        _state.Set("OwnerAddPetRequest", pet);
        _state.Set("OwnerAddPetResponse", response);
        _state.Tracker.TrackPet(created.Id ?? throw new InvalidOperationException("Created pet carries no id."));
    }

    // AC-F02-06 step 2: a second pet added to the same owner, through the same nested route as "a
    // pet is added to the owner" but under its own request/response keys — the first pet's keys
    // (OwnerAddPetRequest/Response) must still hold the first pet afterwards, since step 4 deletes
    // it by that id and steps 3/5 compare the owner's nested pets against it.
    [When("a second pet is added to the owner")]
    public async Task ASecondPetIsAddedToTheOwner()
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

        var response = _check.Expect(await _owners.AddPet(ownerId, pet), HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");

        _state.CreatedPet = created;
        _state.Set("OwnerAddSecondPetRequest", pet);
        _state.Set("OwnerAddSecondPetResponse", response);
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

        var response = _check.Expect(await _owners.GetPet(ownerId, petId), HttpStatusCode.OK);
        _state.Set("OwnerGetPetResponse", response);
    }

    // AC-F02-07 step 3: the nested-route counterpart of "an attempt is made to open the pet
    // details" (PetSteps.cs) -- same deleted pet, but through GET /owners/{ownerId}/pets/{petId}
    // rather than GET /pets/{petId}, so it needs its own 404 expectation instead of reusing "the
    // pet is opened from the owner details", which asserts 200.
    [When("an attempt is made to open the pet from the owner details")]
    public async Task AnAttemptIsMadeToOpenThePetFromTheOwnerDetails()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id.");
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id.");

        var response = _check.Expect(await _owners.GetPet(ownerId, petId), HttpStatusCode.NotFound);
        _state.Set("OwnerGetPetAfterDeleteResponse", response);
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

        var response = _check.Expect(await _owners.UpdatePet(ownerId, petId, updated), HttpStatusCode.NoContent);

        updated.Id = petId;
        updated.OwnerId = ownerId;
        updated.Visits = existing.Visits;
        _state.CreatedPet = updated;

        // Mirrors OwnerUpdateRequest (the direct owner update): the PUT's own response carries no
        // body (§7), so a later step comparing a fresh GET against "what was actually sent" needs
        // this copy, since CreatedPet itself gets overwritten again by whichever read step runs next.
        _state.Set("OwnerUpdatePetRequest", updated);
        _state.Set("OwnerUpdatePetResponse", response);
    }
}
