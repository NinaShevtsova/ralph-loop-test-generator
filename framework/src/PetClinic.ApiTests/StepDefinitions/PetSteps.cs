using System.Net;
using FluentAssertions;
using Reqnroll;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;

namespace PetClinic.ApiTests.StepDefinitions;

// The 4 request steps of the direct pet routes (§7). A pet is created only through the owner's
// nested route (OwnerSteps.APetIsAddedToTheOwner) and never here -- these steps only read, change
// and remove the pet that step already stored under the "Pet" key.
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

    // AC-F02-01, step 2 (flows/F-02-owner-pet-lifecycle.md:106-109): the assigned id, the submitted
    // name/birthDate and the resolved pet type are compared against what was submitted, while
    // ownerId is compared against the owner from Given -- the request itself lives in OwnerSteps
    // because a pet can only be created through the nested owner route (§7), but the response shape
    // is a Pet fact, not an Owner one.
    [Then("the created pet has an assigned id, the submitted values and a link to the owner")]
    public void TheCreatedPetHasAnAssignedIdTheSubmittedValuesAndALinkToTheOwner()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var submitted = _state.GetEntity<Pet>("Pet");
        var pet = _state.GetResponse<Pet>("Pet").Body!;

        pet.Id.Should().NotBeNull(
            because: $"the POST /owners/{ownerId}/pets response should carry an assigned id");
        pet.Name.Should().Be(submitted.Name,
            because: $"pet id {pet.Id} should keep the submitted name");
        pet.BirthDate.Should().Be(submitted.BirthDate,
            because: $"pet id {pet.Id} should keep the submitted birth date");
        pet.Type.Id.Should().Be(submitted.Type.Id,
            because: $"pet id {pet.Id} should keep the submitted pet type");
        pet.OwnerId.Should().Be(ownerId,
            because: $"pet id {pet.Id} should be linked to owner id {ownerId}");
    }

    // AC-F02-01, step 4 (flows/F-02-owner-pet-lifecycle.md:116-119): name and birthDate are compared
    // against the creation response, while type.id and type.name are compared against the directory
    // entry from step 1 -- the AC compares the type against the directory rather than against the
    // creation response on purpose, since the type name is resolved server-side and is not among the
    // submitted values (§11).
    [Then("the pet details match the added pet's data and the pet type from the directory")]
    public void ThePetDetailsMatchTheAddedPetsDataAndThePetTypeFromTheDirectory()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var created = _state.GetResponse<Pet>("Pet").Body!;
        var petType = _state.GetResponse<List<PetType>>("PetTypes").Body!.First();
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        details.Name.Should().Be(created.Name,
            because: $"pet id {details.Id}'s own details should match the name from its creation response");
        details.BirthDate.Should().Be(created.BirthDate,
            because: $"pet id {details.Id}'s own details should match the birth date from its creation response");
        details.Type.Id.Should().Be(petType.Id,
            because: $"pet id {details.Id}'s own details should show the pet type id from the directory");
        details.Type.Name.Should().Be(petType.Name,
            because: $"pet id {details.Id}'s own details should show the pet type name from the directory");
        details.OwnerId.Should().Be(ownerId,
            because: $"pet id {details.Id}'s own details should be linked to owner id {ownerId}");
    }

    // AC-F02-06, step 2 (flows/F-02-owner-pet-lifecycle.md:242-244): the AC only asks for an assigned
    // id that differs from the first pet's -- not a full field-by-field check, since that full check
    // is already exercised by "the created pet has an assigned id, the submitted values and a link
    // to the owner" for the first pet above.
    [Then("the second pet has an assigned id different from the first pet's")]
    public void TheSecondPetHasAnAssignedIdDifferentFromTheFirstPets()
    {
        var firstPet = _state.GetResponse<Pet>("Pet").Body!;
        var secondPet = _state.GetResponse<Pet>("Pet2").Body!;

        secondPet.Id.Should().NotBeNull(
            because: "the POST /owners/{ownerId}/pets response for the second pet should carry an assigned id");
        secondPet.Id.Should().NotBe(firstPet.Id,
            because: $"the second pet's id should differ from the first pet's id {firstPet.Id}");
    }

    [When("the pets list is requested")]
    public async Task ThePetsListIsRequested()
    {
        var response = await _pets.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("Pets", response);
    }

    // AC-F02-07, step 5 (flows/F-02-owner-pet-lifecycle.md:293-295): the negative half of
    // OwnerSteps's "the pets list and the visits log show no trace ..." but pets-only -- this AC has
    // no visit in its Given, so there is no visits log to check alongside it.
    [Then("the pets list has no entry for the deleted pet")]
    public void ThePetsListHasNoEntryForTheDeletedPet()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var pets = _state.GetResponse<List<Pet>>("Pets").Body!;

        pets.Should().NotContain(p => p.Id == petId,
            because: $"the clinic-wide pets list should no longer contain the deleted pet id {petId}");
    }

    // AC-F02-09, step 2 (flows/F-02-owner-pet-lifecycle.md:330-332): unlike "the pets list has no
    // entry for the deleted pet", this pet was never created -- there is no assigned id to filter
    // by, so the submitted entity's unique name (stashed under "PetToDeletedOwner" by
    // OwnerSteps.AnAttemptIsMadeToAddAPetToTheDeletedOwner) is the only handle left to check by.
    [Then("the pets list has no entry for the pet that was never added")]
    public void ThePetsListHasNoEntryForThePetThatWasNeverAdded()
    {
        var submitted = _state.GetEntity<Pet>("PetToDeletedOwner");
        var pets = _state.GetResponse<List<Pet>>("Pets").Body!;

        pets.Should().NotContain(p => p.Name == submitted.Name,
            because: $"the clinic-wide pets list should not contain a pet named '{submitted.Name}', since it was never created for the deleted owner");
    }

    // AC-F02-02, step 2 (flows/F-02-owner-pet-lifecycle.md:141-144): the same duplicate-style check
    // as "the owners list contains exactly one entry ..." in OwnerSteps, extended with the ownerId
    // link -- a pet that lost its owner reference in the clinic-wide list would surface here.
    [Then("the pets list contains exactly one entry for the added pet with the submitted values and its owner link")]
    public void ThePetsListContainsExactlyOneEntryForTheAddedPetWithTheSubmittedValuesAndItsOwnerLink()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var submitted = _state.GetEntity<Pet>("Pet");
        var pet = _state.GetResponse<Pet>("Pet").Body!;
        var pets = _state.GetResponse<List<Pet>>("Pets").Body!;

        var matches = pets.Where(p => p.Id == pet.Id).ToList();
        matches.Should().ContainSingle(
            because: $"the clinic-wide pets list should contain exactly one entry for pet id {pet.Id}, with no duplicate");
        matches[0].OwnerId.Should().Be(ownerId,
            because: $"the clinic-wide pets list entry for pet id {pet.Id} should be linked to owner id {ownerId}");
        matches[0].Name.Should().Be(submitted.Name,
            because: $"the clinic-wide pets list entry for pet id {pet.Id} should show the submitted name");
        matches[0].Type.Id.Should().Be(submitted.Type.Id,
            because: $"the clinic-wide pets list entry for pet id {pet.Id} should show the submitted pet type");
    }

    [When("the pet details are opened")]
    public async Task ThePetDetailsAreOpened()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = await _pets.Get(petId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("PetDetails", response);
    }

    // AC-F02-06, step 6 (flows/F-02-owner-pet-lifecycle.md:260-262): reads the "Pet2" key rather
    // than "Pet" -- the first pet's own key is what "the pet is deleted" (0 uses before this AC)
    // reads, so the two pets' request steps stay independent of each other.
    [When("the second pet's details are opened")]
    public async Task TheSecondPetsDetailsAreOpened()
    {
        var petId = _state.GetResponse<Pet>("Pet2").Body!.Id!.Value;
        var response = await _pets.Get(petId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("Pet2Details", response);
    }

    [When("the pet's own details are updated")]
    public async Task ThePetsOwnDetailsAreUpdated()
    {
        var current = _state.GetEntity<Pet>("Pet");
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var updated = new Pet
        {
            Name = UniqueData.PetName(current.Name),
            BirthDate = current.BirthDate,
            Type = current.Type,
        };

        var response = await _pets.Update(petId, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("PetUpdate", response);
        _state.SetEntity("PetUpdate", updated);
    }

    [When("the pet is deleted")]
    public async Task ThePetIsDeleted()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = await _pets.Delete(petId);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("PetDelete", response);
    }

    // AC-F01-04, step 4 (flows/F-01-owner-lifecycle.md:195-197): a distinct request from "the pet
    // details are opened", which asserts 200 -- reusing that step here would change what
    // already-accepted scenarios assert, which is forbidden, so this is a separate step with its
    // own expected code.
    [When("an attempt is made to open the pet details")]
    public async Task AnAttemptIsMadeToOpenThePetDetails()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = await _pets.Get(petId);
        response.EnsureStatus(HttpStatusCode.NotFound);
        _state.SetResponse("PetDetailsAttempt", response);
    }

    [Then("the pet is reported as not found with an empty body")]
    public void ThePetIsReportedAsNotFoundWithAnEmptyBody()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = _state.GetResponse("PetDetailsAttempt");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a GET /pets/{petId} response for a pet whose owner was deregistered should carry no body");
    }

    // AC-F02-03, step 1 (flows/F-02-owner-pet-lifecycle.md:157-160): "the response body is empty" is
    // a distinct claim from the `204` already checked by the When step's EnsureStatus -- the same
    // shape as OwnerSteps's "the contact update returns an empty body", this time for PUT /pets/{id}.
    [Then("the pet update returns an empty body")]
    public void ThePetUpdateReturnsAnEmptyBody()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var response = _state.GetResponse("PetUpdate");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a PUT /pets/{petId} response should carry no body, per the API conventions for PUT");
    }

    // AC-F02-03, step 2 (flows/F-02-owner-pet-lifecycle.md:162-165): the owner details are read
    // straight after the rename in the pet's own details, so the pet id still comes from "Pet", but
    // the expected name comes from "PetUpdate" -- the entity "the pet's own details are updated"
    // just constructed -- rather than from the original creation response.
    [Then("the owner details show the pet with the new name")]
    public void TheOwnerDetailsShowThePetWithTheNewName()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var updated = _state.GetEntity<Pet>("PetUpdate");
        var details = _state.GetResponse<Owner>("OwnerDetails").Body!;

        var pets = details.Pets.Where(p => p.Id == petId).ToList();
        pets.Should().ContainSingle(
            because: $"owner id {details.Id}'s details should show exactly one pet with id {petId} after the rename");
        pets[0].Name.Should().Be(updated.Name,
            because: $"pet id {petId} inside the owner details should show the new name after the rename in its own details");
    }

    // AC-F02-03, step 3 (flows/F-02-owner-pet-lifecycle.md:167-169): the same new-name comparison as
    // the Then above, this time against GET /owners/{ownerId}/pets/{petId} rather than the nested
    // representation inside GET /owners/{ownerId}.
    [Then("the pet from the owner details shows the new name")]
    public void ThePetFromTheOwnerDetailsShowsTheNewName()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var updated = _state.GetEntity<Pet>("PetUpdate");
        var petFromOwner = _state.GetResponse<Pet>("PetFromOwner").Body!;

        petFromOwner.Name.Should().Be(updated.Name,
            because: $"pet id {petId} opened from the owner details should show the new name after the rename in its own details");
    }

    // AC-F02-04, step 2 (flows/F-02-owner-pet-lifecycle.md:187-189): the rename went through the
    // owner's nested route this time, but it is stashed under the same "PetUpdate" key as AC-F02-03's
    // direct-route rename (OwnerSteps.ThePetIsUpdatedThroughTheOwnersDetails), so this step reads the
    // same key -- AC-F02-04's own point is that the two update routes give the same result, which is
    // also why the ownerId link is checked here alongside the name.
    [Then("the pet details show the new name")]
    public void ThePetDetailsShowTheNewName()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var updated = _state.GetEntity<Pet>("PetUpdate");
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        details.Name.Should().Be(updated.Name,
            because: $"pet id {details.Id}'s own details should show the new name after the rename");
        details.OwnerId.Should().Be(ownerId,
            because: $"pet id {details.Id}'s own details should still be linked to owner id {ownerId} after the rename");
    }

    // AC-F02-05, steps 1 and 3 (flows/F-02-owner-pet-lifecycle.md:208-211,218-221): the same check
    // fits both the pre-update baseline and the post-update read of "the pet details are opened" --
    // it only compares that response's visits against the "Visit" entity recorded earlier, so neither
    // read cares whether the name change in between already happened.
    [Then("the pet details show the recorded visit")]
    public void ThePetDetailsShowTheRecordedVisit()
    {
        var visit = _state.GetEntity<Visit>("Visit");
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        var visits = details.Visits.Where(v => v.Id == visitId).ToList();
        visits.Should().ContainSingle(
            because: $"pet id {details.Id}'s details should show exactly one visit with id {visitId}");
        visits[0].Description.Should().Be(visit.Description,
            because: $"visit id {visitId} inside the pet details should keep its description");
        visits[0].Date.Should().Be(visit.Date,
            because: $"visit id {visitId} inside the pet details should keep its date");
    }

    // AC-F03-02, step 3 (flows/F-03-pet-visit-flow.md:120-123): the same filter-then-ContainSingle
    // per-visit check as "the pet details show the recorded visit", run twice -- once for the visit
    // recorded from the pet details ("Visit") and once for the one recorded through the clinic-wide
    // log ("VisitDirect") -- to prove both routes land in the same pet's history side by side.
    [Then("the pet details show both recorded visits")]
    public void ThePetDetailsShowBothRecordedVisits()
    {
        var firstVisit = _state.GetResponse<Visit>("Visit").Body!;
        var firstEntity = _state.GetEntity<Visit>("Visit");
        var secondVisit = _state.GetResponse<Visit>("VisitDirect").Body!;
        var secondEntity = _state.GetEntity<Visit>("VisitDirect");
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        var firstMatches = details.Visits.Where(v => v.Id == firstVisit.Id).ToList();
        firstMatches.Should().ContainSingle(
            because: $"pet id {details.Id}'s details should show exactly one visit with id {firstVisit.Id}, recorded from the pet details");
        firstMatches[0].Description.Should().Be(firstEntity.Description,
            because: $"visit id {firstVisit.Id} inside the pet details should keep its description");
        firstMatches[0].Date.Should().Be(firstEntity.Date,
            because: $"visit id {firstVisit.Id} inside the pet details should keep its date");
        firstMatches[0].PetId.Should().Be(details.Id,
            because: $"visit id {firstVisit.Id}, recorded from the pet details, should carry pet id {details.Id}");

        var secondMatches = details.Visits.Where(v => v.Id == secondVisit.Id).ToList();
        secondMatches.Should().ContainSingle(
            because: $"pet id {details.Id}'s details should show exactly one visit with id {secondVisit.Id}, recorded through the clinic-wide log");
        secondMatches[0].Description.Should().Be(secondEntity.Description,
            because: $"visit id {secondVisit.Id} inside the pet details should keep its description");
        secondMatches[0].Date.Should().Be(secondEntity.Date,
            because: $"visit id {secondVisit.Id} inside the pet details should keep its date");
        secondMatches[0].PetId.Should().Be(details.Id,
            because: $"visit id {secondVisit.Id}, recorded through the clinic-wide log, should carry pet id {details.Id}, same as the one recorded from the pet details");
    }

    // AC-F03-04, step 3 (flows/F-03-pet-visit-flow.md:174-177): the same filter-then-ContainSingle
    // shape as "the pet details show the recorded visit", now comparing against the "VisitUpdate"
    // entity's new description rather than the original "Visit" one -- proves the correction is
    // visible through the pet's nested visits array, not just the direct GET /visits/{visitId} read.
    [Then("the pet details show the visit with the corrected description")]
    public void ThePetDetailsShowTheVisitWithTheCorrectedDescription()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var updated = _state.GetEntity<Visit>("VisitUpdate");
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        var visits = details.Visits.Where(v => v.Id == visitId).ToList();
        visits.Should().ContainSingle(
            because: $"pet id {details.Id}'s details should show exactly one visit with id {visitId} after the description was corrected");
        visits[0].Description.Should().Be(updated.Description,
            because: $"visit id {visitId} inside the pet details should show the corrected description");
    }

    // AC-F03-05, step 3 (flows/F-03-pet-visit-flow.md:198-201): unlike "the second pet's own details
    // have not changed after the first pet was deleted", which compares against another pet's own
    // creation response, this compares the same pet's own fields against its original creation
    // response and adds the visits-array-is-empty half the AC also requires after its only visit
    // was cancelled.
    [Then("the pet details show the pet unaffected with an empty visit history")]
    public void ThePetDetailsShowThePetUnaffectedWithAnEmptyVisitHistory()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var pet = _state.GetResponse<Pet>("Pet").Body!;
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        details.Name.Should().Be(pet.Name,
            because: $"pet id {pet.Id}'s own details should keep its name after its only visit was cancelled");
        details.BirthDate.Should().Be(pet.BirthDate,
            because: $"pet id {pet.Id}'s own details should keep its birth date after its only visit was cancelled");
        details.Type.Id.Should().Be(pet.Type.Id,
            because: $"pet id {pet.Id}'s own details should keep its pet type after its only visit was cancelled");
        details.OwnerId.Should().Be(ownerId,
            because: $"pet id {pet.Id}'s own details should still be linked to owner id {ownerId} after its only visit was cancelled");
        details.Visits.Should().BeEmpty(
            because: $"pet id {pet.Id}'s visits array should be empty after its only visit was cancelled");
    }

    // AC-F03-06, step 4 (flows/F-03-pet-visit-flow.md:243-246): the same filter-then-ContainSingle
    // shape as "the pet details show both recorded visits", but the first visit's expected
    // description comes from "VisitUpdate" (its correction) while its expected date still comes
    // from "Visit" (unchanged) -- the second visit's own entity ("Visit2") is compared as-is,
    // since nothing about it was ever meant to change.
    [Then("the pet details show the corrected visit and the untouched second visit")]
    public void ThePetDetailsShowTheCorrectedVisitAndTheUntouchedSecondVisit()
    {
        var firstVisit = _state.GetResponse<Visit>("Visit").Body!;
        var originalEntity = _state.GetEntity<Visit>("Visit");
        var correctedEntity = _state.GetEntity<Visit>("VisitUpdate");
        var secondVisit = _state.GetResponse<Visit>("Visit2").Body!;
        var secondEntity = _state.GetEntity<Visit>("Visit2");
        var details = _state.GetResponse<Pet>("PetDetails").Body!;

        details.Visits.Should().HaveCount(2,
            because: $"pet id {details.Id}'s visits array should hold exactly the corrected visit and the untouched second visit, no more");

        var firstMatches = details.Visits.Where(v => v.Id == firstVisit.Id).ToList();
        firstMatches.Should().ContainSingle(
            because: $"pet id {details.Id}'s details should show exactly one visit with id {firstVisit.Id}, the corrected one");
        firstMatches[0].Description.Should().Be(correctedEntity.Description,
            because: $"visit id {firstVisit.Id} inside the pet details should show the corrected description");
        firstMatches[0].Date.Should().Be(originalEntity.Date,
            because: $"visit id {firstVisit.Id} inside the pet details should keep its original date after only the description was corrected");
        firstMatches[0].PetId.Should().Be(details.Id,
            because: $"visit id {firstVisit.Id}, the corrected one, should carry pet id {details.Id}");

        var secondMatches = details.Visits.Where(v => v.Id == secondVisit.Id).ToList();
        secondMatches.Should().ContainSingle(
            because: $"pet id {details.Id}'s details should show exactly one visit with id {secondVisit.Id}, the untouched one");
        secondMatches[0].Description.Should().Be(secondEntity.Description,
            because: $"visit id {secondVisit.Id} inside the pet details should keep its description, unaffected by the first visit's correction");
        secondMatches[0].Date.Should().Be(secondEntity.Date,
            because: $"visit id {secondVisit.Id} inside the pet details should keep its date, unaffected by the first visit's correction");
        secondMatches[0].PetId.Should().Be(details.Id,
            because: $"visit id {secondVisit.Id}, the untouched one, should carry pet id {details.Id}, same as the corrected one");
    }

    // AC-F02-06, step 6 (flows/F-02-owner-pet-lifecycle.md:260-262): compares against the second
    // pet's own creation response ("Pet2"), not a Given entity, since nothing about the second pet
    // was ever meant to change -- only the first pet's deletion happened in between.
    [Then("the second pet's own details have not changed after the first pet was deleted")]
    public void TheSecondPetsOwnDetailsHaveNotChangedAfterTheFirstPetWasDeleted()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var secondPet = _state.GetResponse<Pet>("Pet2").Body!;
        var details = _state.GetResponse<Pet>("Pet2Details").Body!;

        details.Name.Should().Be(secondPet.Name,
            because: $"pet id {secondPet.Id}'s own details should keep its name after the first pet was deleted");
        details.BirthDate.Should().Be(secondPet.BirthDate,
            because: $"pet id {secondPet.Id}'s own details should keep its birth date after the first pet was deleted");
        details.Type.Id.Should().Be(secondPet.Type.Id,
            because: $"pet id {secondPet.Id}'s own details should keep its pet type after the first pet was deleted");
        details.OwnerId.Should().Be(ownerId,
            because: $"pet id {secondPet.Id}'s own details should still be linked to owner id {ownerId} after the first pet was deleted");
    }
}
