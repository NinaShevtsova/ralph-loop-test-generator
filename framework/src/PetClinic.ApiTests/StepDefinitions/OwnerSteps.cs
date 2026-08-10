using System.Net;
using FluentAssertions;
using Reqnroll;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;

namespace PetClinic.ApiTests.StepDefinitions;

// The 8 request steps of the owner routes (§7): direct owner CRUD plus the two nested pet routes
// that only an owner can reach (POST .../pets, GET/PUT .../pets/{petId}). Both Given and When are
// bound to every sentence because a later flow may need the same request as its precondition or as
// its acted-upon step, and Reqnroll treats the two as independent bindings.
[Binding]
public sealed class OwnerSteps
{
    private readonly OwnersService _owners;
    private readonly ScenarioState _state;
    private readonly TestDataProvider _testData;

    public OwnerSteps(OwnersService owners, ScenarioState state, TestDataProvider testData)
    {
        _owners = owners;
        _state = state;
        _testData = testData;
    }

    [Given("an owner is registered")]
    [When("an owner is registered")]
    public async Task AnOwnerIsRegistered()
    {
        var testCase = _testData.For<OwnerCase>();
        var owner = new Owner
        {
            FirstName = testCase.FirstName,
            LastName = UniqueData.LastName(testCase.LastName),
            Address = testCase.Address,
            City = testCase.City,
            Telephone = testCase.Telephone,
        };

        var response = await _owners.Create(owner);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Owner", response);
        _state.SetEntity("Owner", owner);
        _state.Tracker.TrackOwner(response.Body!.Id!.Value);
    }

    [When("the owners list is requested")]
    public async Task TheOwnersListIsRequested()
    {
        var response = await _owners.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("Owners", response);
    }

    // AC-F01-01, step 1 (flows/F-01-owner-lifecycle.md:97): the submitted entity carries no `id`
    // and no `pets`, so those two are asserted as facts about the response rather than compared
    // against Given -- the remaining five fields are compared field by field against what was sent.
    [Then("the created owner has an assigned id, the submitted values and no pets yet")]
    public void TheCreatedOwnerHasAnAssignedIdTheSubmittedValuesAndNoPetsYet()
    {
        var submitted = _state.GetEntity<Owner>("Owner");
        var owner = _state.GetResponse<Owner>("Owner").Body!;

        owner.Id.Should().NotBeNull(
            because: $"the POST /owners response for last name '{submitted.LastName}' should carry an assigned id");
        owner.FirstName.Should().Be(submitted.FirstName,
            because: $"owner id {owner.Id} should keep the submitted first name");
        owner.LastName.Should().Be(submitted.LastName,
            because: $"owner id {owner.Id} should keep the submitted last name");
        owner.Address.Should().Be(submitted.Address,
            because: $"owner id {owner.Id} should keep the submitted address");
        owner.City.Should().Be(submitted.City,
            because: $"owner id {owner.Id} should keep the submitted city");
        owner.Telephone.Should().Be(submitted.Telephone,
            because: $"owner id {owner.Id} should keep the submitted telephone");
        owner.Pets.Should().BeEmpty(
            because: $"owner id {owner.Id} was just created and should not have any pets yet");
    }

    // AC-F01-01, step 2 (flows/F-01-owner-lifecycle.md:104): "the body fully matches the response
    // body of step 1" -- a whole-object comparison, not a field-by-field one, is the literal check.
    [Then("the owner details match the registration response")]
    public void TheOwnerDetailsMatchTheRegistrationResponse()
    {
        var registered = _state.GetResponse<Owner>("Owner").Body!;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        details.Should().BeEquivalentTo(registered,
            because: $"the GET /owners/{registered.Id} response should fully match the registration response for owner id {registered.Id}");
    }

    // AC-F01-01, step 3 (flows/F-01-owner-lifecycle.md:109): "exactly one entry" is the duplicate
    // check -- filtering by id before asserting Count == 1 is what makes a second, unrelated owner
    // in the list (seeded data, or another test's leftovers) not silently satisfy a bare ContainSingle.
    [Then("the owners list contains exactly one entry for the owner with the submitted values")]
    public void TheOwnersListContainsExactlyOneEntryForTheOwnerWithTheSubmittedValues()
    {
        var registered = _state.GetResponse<Owner>("Owner").Body!;
        var owners = _state.GetResponse<List<Owner>>("Owners").Body!;

        var matches = owners.Where(o => o.Id == registered.Id).ToList();
        matches.Should().ContainSingle(
            because: $"the owners list should contain exactly one entry for owner id {registered.Id}, with no duplicate");
        matches[0].Should().BeEquivalentTo(registered,
            because: $"the owners list entry for owner id {registered.Id} should match the registration response");
    }

    // AC-F01-02, step 2 (flows/F-01-owner-lifecycle.md:132): city and telephone must be the new
    // ones while firstName, lastName and address stay whatever the registration submitted --
    // comparing against "Owner" (the original entity), not "OwnerUpdate", is what would catch a
    // bug that also changed the name or the address.
    [Then("the owner details show the updated contacts with the previous name and address unchanged")]
    public void TheOwnerDetailsShowTheUpdatedContactsWithThePreviousNameAndAddressUnchanged()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var previous = _state.GetEntity<Owner>("Owner");
        var updated = _state.GetEntity<Owner>("OwnerUpdate");
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        details.Id.Should().Be(ownerId,
            because: $"the GET /owners/{ownerId} response should be for the updated owner id {ownerId}");
        details.City.Should().Be(updated.City,
            because: $"owner id {ownerId} should show the updated city after the contact change");
        details.Telephone.Should().Be(updated.Telephone,
            because: $"owner id {ownerId} should show the updated telephone after the contact change");
        details.FirstName.Should().Be(previous.FirstName,
            because: $"owner id {ownerId} should keep the previous first name after the contact change");
        details.LastName.Should().Be(previous.LastName,
            because: $"owner id {ownerId} should keep the previous last name after the contact change");
        details.Address.Should().Be(previous.Address,
            because: $"owner id {ownerId} should keep the previous address after the contact change");
        details.Pets.Should().BeEmpty(
            because: $"owner id {ownerId} has no pets, and a contact change should not affect the set of pets");
    }

    // AC-F01-02, step 3 (flows/F-01-owner-lifecycle.md:138): "exactly one entry" is the same
    // duplicate check as AC-F01-01's; this AC additionally requires the previous city/telephone
    // combination to be gone from the whole list, not merely absent from this owner's own entry.
    [Then("the owners list shows the updated contacts and no entry with the previous ones")]
    public void TheOwnersListShowsTheUpdatedContactsAndNoEntryWithThePreviousOnes()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var previous = _state.GetEntity<Owner>("Owner");
        var updated = _state.GetEntity<Owner>("OwnerUpdate");
        var owners = _state.GetResponse<List<Owner>>("Owners").Body!;

        var matches = owners.Where(o => o.Id == ownerId).ToList();
        matches.Should().ContainSingle(
            because: $"the owners list should contain exactly one entry for owner id {ownerId}, with no duplicate after the update");
        matches[0].City.Should().Be(updated.City,
            because: $"the owners list entry for owner id {ownerId} should show the updated city");
        matches[0].Telephone.Should().Be(updated.Telephone,
            because: $"the owners list entry for owner id {ownerId} should show the updated telephone");

        owners.Should().NotContain(o => o.City == previous.City && o.Telephone == previous.Telephone,
            because: $"no entry in the owners list should still show owner id {ownerId}'s previous city '{previous.City}' and telephone '{previous.Telephone}'");
    }

    [When("the owner details are opened")]
    public async Task TheOwnerDetailsAreOpened()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = await _owners.Get(ownerId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("OwnerDetails", response);
    }

    // AC-F01-04, step 1 (flows/F-01-owner-lifecycle.md:182-185): the pre-deregistration snapshot --
    // the owner's `pets` array carries the one pet, and that pet's own `visits` array carries the one
    // visit -- is the baseline the rest of the scenario proves gone after deregistration.
    [Then("the owner details show the pet and its recorded visit")]
    public void TheOwnerDetailsShowThePetAndItsRecordedVisit()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        var pets = details.Pets.Where(p => p.Id == petId).ToList();
        pets.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should show one pet with id {petId} before deregistration");
        pets[0].Visits.Should().Contain(v => v.Id == visitId,
            because: $"pet id {petId}'s visits should include visit id {visitId} before deregistration");
    }

    // AC-F03-05, step 5 (flows/F-03-pet-visit-flow.md:207-209): unlike "the owner details show the
    // pet and its recorded visit", the AC's own point here is the opposite -- the pet is still in
    // place but its nested visits array is now empty after the visit was cancelled.
    [Then("the owner details show the pet unaffected with an empty visit history")]
    public void TheOwnerDetailsShowThePetUnaffectedWithAnEmptyVisitHistory()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        var pets = details.Pets.Where(p => p.Id == petId).ToList();
        pets.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should still show exactly one entry for pet id {petId} after its visit was cancelled");
        pets[0].Visits.Should().BeEmpty(
            because: $"pet id {petId}'s visits array inside the owner details should be empty after its only visit was cancelled");
    }

    // PUTs answer 204 with no body (§7), so the constructed payload is stashed as an entity too --
    // it is the only record of what the update was supposed to change, for a later GET to confirm.
    // AC-F01-02 (flows/F-01-owner-lifecycle.md:126) requires both `city` and `telephone` to be new
    // while the other three fields stay the previous ones -- a step that leaves `city` unchanged
    // makes that AC's "no previous city/telephone in the list" assertion compare a value with itself.
    [When("the owner's contact details are updated")]
    public async Task TheOwnersContactDetailsAreUpdated()
    {
        var current = _state.GetEntity<Owner>("Owner");
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var testCase = _testData.For<OwnerUpdateCase>();
        var updated = new Owner
        {
            FirstName = current.FirstName,
            LastName = current.LastName,
            Address = current.Address,
            City = testCase.City,
            Telephone = UniqueData.Telephone(),
        };

        var response = await _owners.Update(ownerId, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("OwnerUpdate", response);
        _state.SetEntity("OwnerUpdate", updated);
    }

    // AC-F01-02, step 1 (flows/F-01-owner-lifecycle.md:128): "the response body is empty" is a
    // distinct claim from the `204` already checked by the When step's `EnsureStatus` -- a PUT that
    // answered `204` with a body would pass unnoticed without this assertion (§7 states every PUT's
    // response body is empty).
    [Then("the contact update returns an empty body")]
    public void TheContactUpdateReturnsAnEmptyBody()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = _state.GetResponse("OwnerUpdate");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a PUT /owners/{ownerId} response should carry no body, per the API conventions for PUT");
    }

    // AC-F02-09's Given (flows/F-02-owner-pet-lifecycle.md:326): "register an owner, delete them and
    // use the freed id" makes the deletion part of the AC's precondition rather than one of its two
    // acted-upon steps, so this needs the dual [Given]/[When] binding the file's own convention (see
    // header comment) reserves for exactly this case; AC-F01-03 and AC-F01-04 keep the When keyword
    // for their own scenarios, so adding [Given] here changes neither.
    [Given("the owner is deregistered")]
    [When("the owner is deregistered")]
    public async Task TheOwnerIsDeregistered()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = await _owners.Delete(ownerId);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("OwnerDelete", response);
    }

    // AC-F01-03, step 1 (flows/F-01-owner-lifecycle.md:155): "the response body is empty" is a
    // distinct claim from the `204` already checked by the When step's EnsureStatus -- the same
    // shape as the PUT case above.
    [Then("the deregistration returns an empty body")]
    public void TheDeregistrationReturnsAnEmptyBody()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = _state.GetResponse("OwnerDelete");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a DELETE /owners/{ownerId} response should carry no body, per the API conventions for DELETE");
    }

    // AC-F01-03, step 2 (flows/F-01-owner-lifecycle.md:157-159): opening the details of a
    // deregistered owner is a distinct request from "the owner details are opened", which asserts
    // `200` -- reusing that step here would mean changing what an already-accepted scenario
    // asserts, which is forbidden, so this is a separate step with its own expected code.
    [When("an attempt is made to open the owner details")]
    public async Task AnAttemptIsMadeToOpenTheOwnerDetails()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = await _owners.Get(ownerId);
        response.EnsureStatus(HttpStatusCode.NotFound);
        _state.SetResponse("OwnerDetailsAttempt", response);
    }

    [Then("the owner is reported as not found with an empty body")]
    public void TheOwnerIsReportedAsNotFoundWithAnEmptyBody()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = _state.GetResponse("OwnerDetailsAttempt");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a GET /owners/{ownerId} response for a deregistered owner should carry no body");
    }

    // AC-F01-03, step 3 (flows/F-01-owner-lifecycle.md:161-164): the owner must be gone from the
    // list, but the list itself must not be emptied by deregistering one client -- both halves need
    // their own assertion, or a bug that cleared the whole list would pass the first check unnoticed.
    [Then("the owners list has no entry for the deregistered owner, while other owners remain")]
    public void TheOwnersListHasNoEntryForTheDeregisteredOwnerWhileOtherOwnersRemain()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var owners = _state.GetResponse<List<Owner>>("Owners").Body!;

        owners.Should().NotContain(o => o.Id == ownerId,
            because: $"the owners list should no longer contain the deregistered owner id {ownerId}");
        owners.Should().NotBeEmpty(
            because: "deregistering one owner should not clear the entire owners list");
    }

    // AC-F01-03, step 4 (flows/F-01-owner-lifecycle.md:166-168): the repeated deletion is the AC's
    // own point rather than an auxiliary gate for a later chained step, so the code is asserted in
    // the Then as the domain fact it is, instead of via an EnsureStatus inside this When.
    [When("the owner is deregistered again")]
    public async Task TheOwnerIsDeregisteredAgain()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = await _owners.Delete(ownerId);
        _state.SetResponse("OwnerSecondDelete", response);
    }

    [Then("the second deregistration reports that no such owner exists")]
    public void TheSecondDeregistrationReportsThatNoSuchOwnerExists()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = _state.GetResponse("OwnerSecondDelete");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            because: $"deregistering owner id {ownerId} a second time should report that it no longer exists");
    }

    // AC-F01-04, step 6 (flows/F-01-owner-lifecycle.md:203-206): both the clinic-wide pets list and
    // the clinic-wide visits log are checked in one Then because both come from the two When steps
    // run immediately before it ("the pets list is requested", "the visits log is requested").
    [Then("the pets list and the visits log show no trace of the removed pet or its visit")]
    public void ThePetsListAndTheVisitsLogShowNoTraceOfTheRemovedPetOrItsVisit()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var pets = _state.GetResponse<List<Pet>>("Pets").Body!;
        var visits = _state.GetResponse<List<Visit>>("Visits").Body!;

        pets.Should().NotContain(p => p.Id == petId,
            because: $"the clinic-wide pets list should no longer contain pet id {petId} after its owner was deregistered");
        visits.Should().NotContain(v => v.Id == visitId,
            because: $"the clinic-wide visits list should no longer contain visit id {visitId} after its pet was removed");
    }

    // §10.9: most ACs take an existing type -- the first element of the pet types directory
    // already fetched into state ("the pet types directory is requested"). AC-F01-04 and
    // AC-F02-10 instead create their own type via "a new pet type is added to the directory" and
    // must use that one, exclusively, for their own pet -- deleting either the owner or the pet
    // type cascades onto the other otherwise (§10.9, §11). Whichever of the two steps ran earlier
    // in the scenario is the one whose key is present in state, so that governs which type wins.
    [Given("a pet is added to the owner")]
    [When("a pet is added to the owner")]
    public async Task APetIsAddedToTheOwner()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petType = ResolvePetType();
        var testCase = _testData.For<PetCase>();
        var pet = new Pet
        {
            Name = UniqueData.PetName(testCase.Name),
            BirthDate = testCase.BirthDate,
            Type = petType,
        };

        var response = await _owners.AddPet(ownerId, pet);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Pet", response);
        _state.SetEntity("Pet", pet);
        _state.Tracker.TrackPet(response.Body!.Id!.Value);
    }

    // AC-F02-06, step 2 (flows/F-02-owner-pet-lifecycle.md:242-244): a second pet for the same
    // owner, stashed under its own "Pet2" response/entity keys so the first pet's "Pet" key
    // -- and the "the pet is deleted" step that reads it -- stay untouched; this step is When-only
    // because the AC never needs it as a precondition, the same shape as ThePetIsUpdatedThroughTheOwnersDetails.
    [When("a second pet is added to the owner")]
    public async Task ASecondPetIsAddedToTheOwner()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petType = ResolvePetType();
        var testCase = _testData.For<Pet2Case>();
        var pet = new Pet
        {
            Name = UniqueData.PetName(testCase.Name),
            BirthDate = testCase.BirthDate,
            Type = petType,
        };

        var response = await _owners.AddPet(ownerId, pet);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Pet2", response);
        _state.SetEntity("Pet2", pet);
        _state.Tracker.TrackPet(response.Body!.Id!.Value);
    }

    [When("the pet is opened from the owner details")]
    public async Task ThePetIsOpenedFromTheOwnerDetails()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = await _owners.GetPet(ownerId, petId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("PetFromOwner", response);
    }

    // Stashed under "PetUpdate" -- the same key "the pet's own details are updated" (PetSteps) uses
    // -- so that a rename's onward visibility can be asserted with the same Then steps regardless of
    // which of the two update routes produced it (AC-F02-03 vs AC-F02-04); this step had 0 scenario
    // uses before AC-F02-04, so unifying the key changes no already-accepted scenario's behaviour.
    [When("the pet is updated through the owner's details")]
    public async Task ThePetIsUpdatedThroughTheOwnersDetails()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var current = _state.GetEntity<Pet>("Pet");
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var updated = new Pet
        {
            Name = UniqueData.PetName(current.Name),
            BirthDate = current.BirthDate,
            Type = current.Type,
        };

        var response = await _owners.UpdatePet(ownerId, petId, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("PetUpdate", response);
        _state.SetEntity("PetUpdate", updated);
    }

    // AC-F02-01, step 3 (flows/F-02-owner-pet-lifecycle.md:111-114): "exactly one element" is the
    // same duplicate-style check as the owners list assertions in AC-F01-01/02; it also compares
    // name, birthDate and type.id against the pet's own creation response rather than Given, so a
    // bug that only broke the nested representation would surface here.
    [Then("the owner details show one pet matching the added pet's data")]
    public void TheOwnerDetailsShowOnePetMatchingTheAddedPetsData()
    {
        var pet = _state.GetResponse<Pet>("Pet").Body!;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        var pets = details.Pets.Where(p => p.Id == pet.Id).ToList();
        pets.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should show exactly one pet with id {pet.Id}");
        pets[0].Name.Should().Be(pet.Name,
            because: $"pet id {pet.Id} inside the owner details should show its name");
        pets[0].BirthDate.Should().Be(pet.BirthDate,
            because: $"pet id {pet.Id} inside the owner details should show its birth date");
        pets[0].Type.Id.Should().Be(pet.Type.Id,
            because: $"pet id {pet.Id} inside the owner details should show its pet type");
    }

    // AC-F02-01, step 5 (flows/F-02-owner-pet-lifecycle.md:121-124): "matches ... in every field" is
    // a whole-object comparison, not a field-by-field one -- the same shape as "the owner details
    // match the registration response" above, this time proving the pet's own details and the
    // representation nested under the owner are one record, not two independent copies.
    [Then("the pet from the owner details matches the pet's own details in every field")]
    public void ThePetFromTheOwnerDetailsMatchesThePetsOwnDetailsInEveryField()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petDetails = _state.GetResponse<Pet>("PetDetails").Body!;
        var petFromOwner = _state.GetResponse<Pet>("PetFromOwner").Body!;

        petFromOwner.Should().BeEquivalentTo(petDetails,
            because: $"the GET /owners/{ownerId}/pets/{petDetails.Id} response should fully match the GET /pets/{petDetails.Id} response for pet id {petDetails.Id}");
    }

    // AC-F02-06, step 3 (flows/F-02-owner-pet-lifecycle.md:246-249): the same filter-then-ContainSingle
    // duplicate check as "the owner details show one pet matching the added pet's data", run twice --
    // once per pet -- so that a bug overwriting the first pet's name with the second one's would
    // surface here rather than being hidden behind a bare Count == 2.
    [Then("the owner details show both pets with their own distinct names")]
    public void TheOwnerDetailsShowBothPetsWithTheirOwnDistinctNames()
    {
        var firstPet = _state.GetResponse<Pet>("Pet").Body!;
        var secondPet = _state.GetResponse<Pet>("Pet2").Body!;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        var firstMatches = details.Pets.Where(p => p.Id == firstPet.Id).ToList();
        firstMatches.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should show exactly one entry for the first pet with id {firstPet.Id}");
        firstMatches[0].Name.Should().Be(firstPet.Name,
            because: $"pet id {firstPet.Id} inside the owner details should keep its own name after the second pet was added");

        var secondMatches = details.Pets.Where(p => p.Id == secondPet.Id).ToList();
        secondMatches.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should show exactly one entry for the second pet with id {secondPet.Id}");
        secondMatches[0].Name.Should().Be(secondPet.Name,
            because: $"pet id {secondPet.Id} inside the owner details should show its own name, not the first pet's");
    }

    // AC-F02-06, step 5 (flows/F-02-owner-pet-lifecycle.md:255-258): the negative half (NotContain
    // the deleted first pet) is the same shape as "the pets list and the visits log show no trace of
    // the removed pet or its visit"; the positive half re-checks the second pet's name is still its
    // original one, not touched by the first pet's deletion.
    [Then("the owner details show only the second pet, unaffected by the first pet's deletion")]
    public void TheOwnerDetailsShowOnlyTheSecondPetUnaffectedByTheFirstPetsDeletion()
    {
        var firstPet = _state.GetResponse<Pet>("Pet").Body!;
        var secondPet = _state.GetResponse<Pet>("Pet2").Body!;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        details.Pets.Should().NotContain(p => p.Id == firstPet.Id,
            because: $"owner id {details.Id}'s details should no longer show the deleted first pet with id {firstPet.Id}");

        var matches = details.Pets.Where(p => p.Id == secondPet.Id).ToList();
        matches.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should still show exactly one entry for the second pet with id {secondPet.Id}");
        matches[0].Name.Should().Be(secondPet.Name,
            because: $"pet id {secondPet.Id} inside the owner details should keep its original name after the first pet was deleted");
    }

    // AC-F02-07, step 3 (flows/F-02-owner-pet-lifecycle.md:284-286): a distinct request from "the pet
    // is opened from the owner details", which asserts 200 -- reusing that step here would change
    // what an already-accepted scenario asserts, which is forbidden, so this is a separate step with
    // its own expected code, the same shape as "an attempt is made to open the pet details" in PetSteps.
    [When("an attempt is made to open the pet from the owner details")]
    public async Task AnAttemptIsMadeToOpenThePetFromTheOwnerDetails()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = await _owners.GetPet(ownerId, petId);
        response.EnsureStatus(HttpStatusCode.NotFound);
        _state.SetResponse("PetFromOwnerAttempt", response);
    }

    [Then("the pet is reported as not found from the owner details too")]
    public void ThePetIsReportedAsNotFoundFromTheOwnerDetailsToo()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = _state.GetResponse("PetFromOwnerAttempt");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a GET /owners/{ownerId}/pets/{petId} response for a deleted pet should carry no body");
    }

    // AC-F02-07, step 4 (flows/F-02-owner-pet-lifecycle.md:288-291): the owner's contact fields are
    // compared against the registration response, the same baseline "the owner details show the
    // updated contacts ..." compares against for AC-F01-02 -- nothing in this AC changes them, only
    // the pet is deleted, so the owner itself must come back unchanged except for its now-empty pets.
    [Then("the owner details show the previous contact info and an empty pets list")]
    public void TheOwnerDetailsShowThePreviousContactInfoAndAnEmptyPetsList()
    {
        var registered = _state.GetResponse<Owner>("Owner").Body!;
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        details.FirstName.Should().Be(registered.FirstName,
            because: $"owner id {details.Id} should keep the registered first name after its pet was deleted");
        details.LastName.Should().Be(registered.LastName,
            because: $"owner id {details.Id} should keep the registered last name after its pet was deleted");
        details.Address.Should().Be(registered.Address,
            because: $"owner id {details.Id} should keep the registered address after its pet was deleted");
        details.City.Should().Be(registered.City,
            because: $"owner id {details.Id} should keep the registered city after its pet was deleted");
        details.Telephone.Should().Be(registered.Telephone,
            because: $"owner id {details.Id} should keep the registered telephone after its pet was deleted");
        details.Pets.Should().BeEmpty(
            because: $"owner id {details.Id}'s pets list should be empty after its only pet was deleted");
    }

    // AC-F02-08, Given (flows/F-02-owner-pet-lifecycle.md:305): a second, independent owner for the
    // negative check -- stashed under its own "Owner2" key so the first owner's "Owner" key, and every
    // step that reads it, stay untouched; mirrors "an owner is registered" exactly, the same shape as
    // "a second pet is added to the owner" mirroring "a pet is added to the owner".
    [Given("a second owner is registered")]
    [When("a second owner is registered")]
    public async Task ASecondOwnerIsRegistered()
    {
        var testCase = _testData.For<Owner2Case>();
        var owner = new Owner
        {
            FirstName = testCase.FirstName,
            LastName = UniqueData.LastName(testCase.LastName),
            Address = testCase.Address,
            City = testCase.City,
            Telephone = testCase.Telephone,
        };

        var response = await _owners.Create(owner);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Owner2", response);
        _state.SetEntity("Owner2", owner);
        _state.Tracker.TrackOwner(response.Body!.Id!.Value);
    }

    // AC-F02-08, step 1 (flows/F-02-owner-pet-lifecycle.md:307-309): the pet opened through its own
    // owner's nested route should carry that same pet's id and be linked to that same owner -- the
    // sanity half of the AC, checked before the negative check in step 2.
    [Then("the pet from the owner details belongs to its own owner")]
    public void ThePetFromTheOwnerDetailsBelongsToItsOwnOwner()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var petFromOwner = _state.GetResponse<Pet>("PetFromOwner").Body!;

        petFromOwner.Id.Should().Be(petId,
            because: $"GET /owners/{ownerId}/pets/{petId} should return the pet with id {petId}");
        petFromOwner.OwnerId.Should().Be(ownerId,
            because: $"pet id {petId} opened from its own owner's details should be linked to owner id {ownerId}");
    }

    // AC-F02-08, step 2 (flows/F-02-owner-pet-lifecycle.md:311-313): a distinct request from "an
    // attempt is made to open the pet from the owner details", which reads ownerId from "Owner" --
    // this one substitutes the second, unrelated owner's id while keeping the same pet id, so it needs
    // its own When rather than a reword of the existing one.
    [When("an attempt is made to open the pet from the second owner's details")]
    public async Task AnAttemptIsMadeToOpenThePetFromTheSecondOwnersDetails()
    {
        var ownerId2 = _state.GetResponse<Owner>("Owner2").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = await _owners.GetPet(ownerId2, petId);
        response.EnsureStatus(HttpStatusCode.NotFound);
        _state.SetResponse("PetFromOwner2Attempt", response);
    }

    [Then("the pet is reported as not found from the second owner's details too")]
    public void ThePetIsReportedAsNotFoundFromTheSecondOwnersDetailsToo()
    {
        var ownerId2 = _state.GetResponse<Owner>("Owner2").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = _state.GetResponse("PetFromOwner2Attempt");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a GET /owners/{ownerId2}/pets/{petId} response for a pet belonging to another owner should carry no body");
    }

    // AC-F02-09, step 1 (flows/F-02-owner-pet-lifecycle.md:326-328): "the owner is deregistered"
    // already ran by the time this executes, so ownerId is read from "Owner" as the now-freed id
    // rather than a live one -- nothing about that read changes, only the route no longer
    // recognises the id. The submitted pet is stashed under its own "PetToDeletedOwner" key rather
    // than "Pet" (used by "a pet is added to the owner"), since no pet is ever created here and the
    // pets-list check in step 2 has no id to filter by, only the unique name.
    [When("an attempt is made to add a pet to the deleted owner")]
    public async Task AnAttemptIsMadeToAddAPetToTheDeletedOwner()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petType = ResolvePetType();
        var testCase = _testData.For<PetCase>();
        var pet = new Pet
        {
            Name = UniqueData.PetName(testCase.Name),
            BirthDate = testCase.BirthDate,
            Type = petType,
        };

        var response = await _owners.AddPet(ownerId, pet);
        response.EnsureStatus(HttpStatusCode.NotFound);
        _state.SetResponse("PetToDeletedOwnerAttempt", response);
        _state.SetEntity("PetToDeletedOwner", pet);
    }

    [Then("the pet is reported as not found for the deleted owner")]
    public void ThePetIsReportedAsNotFoundForTheDeletedOwner()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var response = _state.GetResponse("PetToDeletedOwnerAttempt");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a POST /owners/{ownerId}/pets response for deleted owner id {ownerId} should carry no body");
    }

    // The "PetType" key exists only when "a new pet type is added to the directory" already ran
    // in this scenario (AC-F01-04, AC-F02-10) -- its absence is the normal case, not an error, so
    // the fallback to the shared directory is a catch, not a precondition check on state we don't
    // otherwise need to read.
    private PetType ResolvePetType()
    {
        try
        {
            return _state.GetResponse<PetType>("PetType").Body!;
        }
        catch (KeyNotFoundException)
        {
            return _state.GetResponse<List<PetType>>("PetTypes").Body!.First();
        }
    }
}

// Data-only shape for the "ownerUpdate" section of an AC block (TestDataProvider.For<T>() resolves
// the section name from the type name minus "Case"). Kept beside its only reader, above, rather than
// in TestData/Cases/, because that directory is outside the stage-1 fence.
public class OwnerUpdateCase
{
    public string City { get; set; } = string.Empty;
}

// Data-only shape for the "pet2" section of an AC block, same reasoning as OwnerUpdateCase above:
// TestDataProvider.For<Pet2Case>() resolves the section name to "pet2", giving AC-F02-06 a second
// pet's base name/birthDate distinct from the "pet" section the shared PetCase reads.
public class Pet2Case
{
    public string Name { get; set; } = string.Empty;
    public string BirthDate { get; set; } = string.Empty;
}

// Data-only shape for the "owner2" section of an AC block, same reasoning as Pet2Case above:
// TestDataProvider.For<Owner2Case>() resolves the section name to "owner2", giving AC-F02-08 a second,
// independent owner distinct from the "owner" section the shared OwnerCase reads.
public class Owner2Case
{
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string Telephone { get; set; } = string.Empty;
}
