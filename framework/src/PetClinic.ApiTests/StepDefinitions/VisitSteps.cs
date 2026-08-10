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

// The 6 request steps of the visit routes (§7): both creation routes (nested under the pet, and the
// clinic-wide log), plus the direct visit CRUD. "the visit details/update/delete" steps operate on
// whichever visit was recorded through the nested route ("Visit" key) -- the direct-log creation
// keeps its own "VisitDirect" key so a scenario comparing the two representations of one AC can
// still reach both.
[Binding]
public sealed class VisitSteps
{
    private readonly VisitsService _visits;
    private readonly ScenarioState _state;
    private readonly TestDataProvider _testData;

    public VisitSteps(VisitsService visits, ScenarioState state, TestDataProvider testData)
    {
        _visits = visits;
        _state = state;
        _testData = testData;
    }

    [Given("a visit is recorded for the pet")]
    [When("a visit is recorded for the pet")]
    public async Task AVisitIsRecordedForThePet()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var testCase = _testData.For<VisitCase>();
        var visit = new Visit
        {
            Date = testCase.Date,
            Description = UniqueData.VisitDescription(testCase.Description),
        };

        var response = await _visits.AddToPet(ownerId, petId, visit);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Visit", response);
        _state.SetEntity("Visit", visit);
        _state.Tracker.TrackVisit(response.Body!.Id!.Value);
    }

    // AC-F03-03's Given (flows/F-03-pet-visit-flow.md:137-138) asks for "a date one month ahead of
    // the current one" -- a relationship to the wall clock, not a fixed value, so unlike "a visit is
    // recorded for the pet" this step computes the date from DateTime.Today instead of reading
    // VisitCase.Date, via the same UniqueData.Date helper the smoke suite already uses for this
    // purpose (Support/UniqueData.cs:31). Reusing "a visit is recorded for the pet" here would force
    // every already-accepted caller of that step onto a moving date instead of its own fixed one, so
    // this stays a separate step.
    [When("a visit is recorded for the pet for a future date")]
    public async Task AVisitIsRecordedForThePetForAFutureDate()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var testCase = _testData.For<VisitCase>();
        var visit = new Visit
        {
            Date = UniqueData.Date(DateTime.Today.AddMonths(1)),
            Description = UniqueData.VisitDescription(testCase.Description),
        };

        var response = await _visits.AddToPet(ownerId, petId, visit);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Visit", response);
        _state.SetEntity("Visit", visit);
        _state.Tracker.TrackVisit(response.Body!.Id!.Value);
    }

    // §11: the id field must be absent from the creation body; Visit.Id stays unset because the
    // model only serialises it when non-null. petId is required only on this direct route (§7).
    // AC-F03-02's Given asks for two visits with different base dates/descriptions (flows/F-03-pet-
    // visit-flow.md:107-108) -- since "a visit is recorded for the pet" already reads the shared
    // "visit" section via VisitCase, this step reads its own "visit2" section via Visit2Case, the
    // same two-section split OwnerSteps uses for a second pet/owner (Pet2Case/Owner2Case).
    [Given("a visit is logged directly for the pet")]
    [When("a visit is logged directly for the pet")]
    public async Task AVisitIsLoggedDirectlyForThePet()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var testCase = _testData.For<Visit2Case>();
        var visit = new Visit
        {
            PetId = petId,
            Date = testCase.Date,
            Description = UniqueData.VisitDescription(testCase.Description),
        };

        var response = await _visits.Create(visit);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("VisitDirect", response);
        _state.SetEntity("VisitDirect", visit);
        _state.Tracker.TrackVisit(response.Body!.Id!.Value);
    }

    // AC-F03-06's Given (flows/F-03-pet-visit-flow.md:224-226) asks for a pet with two visits
    // recorded through the same nested route as "a visit is recorded for the pet" -- unlike "a
    // visit is logged directly for the pet", which hits POST /visits instead. Mirrors OwnerSteps's
    // "a second pet is added to the owner" (its own "Pet2" key next to "Pet"): reads the same
    // Visit2Case/"visit2" section already used by AC-F03-02's direct-log step, but through the
    // nested route and under its own "Visit2" key.
    [Given("a second visit is recorded for the pet")]
    [When("a second visit is recorded for the pet")]
    public async Task ASecondVisitIsRecordedForThePet()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var testCase = _testData.For<Visit2Case>();
        var visit = new Visit
        {
            Date = testCase.Date,
            Description = UniqueData.VisitDescription(testCase.Description),
        };

        var response = await _visits.AddToPet(ownerId, petId, visit);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("Visit2", response);
        _state.SetEntity("Visit2", visit);
        _state.Tracker.TrackVisit(response.Body!.Id!.Value);
    }

    [When("the visits log is requested")]
    public async Task TheVisitsLogIsRequested()
    {
        var response = await _visits.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("Visits", response);
    }

    // AC-F03-01, step 1 (flows/F-03-pet-visit-flow.md:76-79): the assigned id, the submitted date
    // and description, and the pet link are compared against what was submitted and against the
    // pet from Given -- the same shape as PetSteps's "the created pet has an assigned id, the
    // submitted values and a link to the owner", this time for POST /owners/{ownerId}/pets/{petId}/visits.
    [Then("the created visit has an assigned id, the submitted values and a link to the pet")]
    public void TheCreatedVisitHasAnAssignedIdTheSubmittedValuesAndALinkToThePet()
    {
        var ownerId = _state.GetResponse<Owner>("Owner").Body!.Id!.Value;
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var submitted = _state.GetEntity<Visit>("Visit");
        var visit = _state.GetResponse<Visit>("Visit").Body!;

        visit.Id.Should().NotBeNull(
            because: $"the POST /owners/{ownerId}/pets/{petId}/visits response should carry an assigned id");
        visit.PetId.Should().Be(petId,
            because: $"visit id {visit.Id} should be linked to pet id {petId}");
        visit.Date.Should().Be(submitted.Date,
            because: $"visit id {visit.Id} should keep the submitted date");
        visit.Description.Should().Be(submitted.Description,
            because: $"visit id {visit.Id} should keep the submitted description");
    }

    [When("the visit details are opened")]
    public async Task TheVisitDetailsAreOpened()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = await _visits.Get(visitId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("VisitDetails", response);
    }

    [When("the visit is updated")]
    public async Task TheVisitIsUpdated()
    {
        var current = _state.GetEntity<Visit>("Visit");
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var updated = new Visit
        {
            Date = current.Date,
            Description = UniqueData.VisitDescription(current.Description),
        };

        var response = await _visits.Update(visitId, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("VisitUpdate", response);
        _state.SetEntity("VisitUpdate", updated);
    }

    [When("the visit is deleted")]
    public async Task TheVisitIsDeleted()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = await _visits.Delete(visitId);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("VisitDelete", response);
    }

    // AC-F03-05, step 6 (flows/F-03-pet-visit-flow.md:211-213): the same repeated-deletion shape as
    // OwnerSteps's "the owner is deregistered again" -- the AC's own point is the repeated delete's
    // result, so the code is asserted in the Then rather than via an EnsureStatus inside this When.
    [When("the visit is deleted again")]
    public async Task TheVisitIsDeletedAgain()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = await _visits.Delete(visitId);
        _state.SetResponse("VisitSecondDelete", response);
    }

    [Then("the second deletion reports that the visit does not exist")]
    public void TheSecondDeletionReportsThatTheVisitDoesNotExist()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = _state.GetResponse("VisitSecondDelete");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            because: $"deleting visit id {visitId} a second time should report that it no longer exists");
    }

    // AC-F01-04, step 5 (flows/F-01-owner-lifecycle.md:199-201): a distinct request from "the visit
    // details are opened", which asserts 200 -- reusing that step here would change what
    // already-accepted scenarios assert, which is forbidden, so this is a separate step with its
    // own expected code.
    [When("an attempt is made to open the visit details")]
    public async Task AnAttemptIsMadeToOpenTheVisitDetails()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = await _visits.Get(visitId);
        response.EnsureStatus(HttpStatusCode.NotFound);
        _state.SetResponse("VisitDetailsAttempt", response);
    }

    [Then("the visit is reported as not found with an empty body")]
    public void TheVisitIsReportedAsNotFoundWithAnEmptyBody()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = _state.GetResponse("VisitDetailsAttempt");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a GET /visits/{visitId} response for a visit whose pet and owner were removed should carry no body");
    }

    // AC-F02-05, step 4 (flows/F-02-owner-pet-lifecycle.md:223-225): a separate direct read of the
    // visit confirms the pet-details check isn't the only place the untouched history shows up.
    [Then("the visit details show the pet link and unchanged data")]
    public void TheVisitDetailsShowThePetLinkAndUnchangedData()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var visit = _state.GetEntity<Visit>("Visit");
        var details = _state.GetResponse<Visit>("VisitDetails").Body!;

        details.PetId.Should().Be(petId,
            because: $"visit id {details.Id} should still be linked to pet id {petId} after the pet's name was changed");
        details.Description.Should().Be(visit.Description,
            because: $"visit id {details.Id} should keep its description after the pet's name was changed");
        details.Date.Should().Be(visit.Date,
            because: $"visit id {details.Id} should keep its date after the pet's name was changed");
    }

    // AC-F02-10, step 6 (flows/F-02-owner-pet-lifecycle.md:370-372): the same NotContain shape as
    // OwnerSteps's "the pets list and the visits log show no trace ..." but visits-only -- this AC has
    // no clinic-wide pets list check of its own, since the owner's now-empty pets array already
    // covers that half.
    [Then("the visits log shows no trace of the removed visit")]
    public void TheVisitsLogShowsNoTraceOfTheRemovedVisit()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var visits = _state.GetResponse<List<Visit>>("Visits").Body!;

        visits.Should().NotContain(v => v.Id == visitId,
            because: $"the clinic-wide visits log should no longer contain visit id {visitId} after its pet was deleted");
    }

    // AC-F03-01, step 5 (flows/F-03-pet-visit-flow.md:95-97): the same filter-then-ContainSingle
    // duplicate check as OwnerSteps's "the owners list contains exactly one entry ...", extended
    // with the petId link -- a visit that lost its pet reference in the clinic-wide log would
    // surface here.
    [Then("the visits log contains exactly one entry for the recorded visit linked to the pet")]
    public void TheVisitsLogContainsExactlyOneEntryForTheRecordedVisitLinkedToThePet()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var visit = _state.GetResponse<Visit>("Visit").Body!;
        var visits = _state.GetResponse<List<Visit>>("Visits").Body!;

        var matches = visits.Where(v => v.Id == visit.Id).ToList();
        matches.Should().ContainSingle(
            because: $"the clinic-wide visits log should contain exactly one entry for visit id {visit.Id}, with no duplicate");
        matches[0].PetId.Should().Be(petId,
            because: $"the clinic-wide visits log entry for visit id {visit.Id} should be linked to pet id {petId}");
    }

    // AC-F03-02, step 2 (flows/F-03-pet-visit-flow.md:114-118): the same distinct-id shape as
    // PetSteps's "the second pet has an assigned id different from the first pet's", extended with
    // the petId link since this visit is created through the route where the pet is named in the
    // body rather than the address.
    [Then("the directly logged visit has an assigned id different from the first visit's and links to the same pet")]
    public void TheDirectlyLoggedVisitHasAnAssignedIdDifferentFromTheFirstVisitsAndLinksToTheSamePet()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var firstVisit = _state.GetResponse<Visit>("Visit").Body!;
        var secondVisit = _state.GetResponse<Visit>("VisitDirect").Body!;

        secondVisit.Id.Should().NotBeNull(
            because: "the POST /visits response should carry an assigned id");
        secondVisit.Id.Should().NotBe(firstVisit.Id,
            because: $"the directly logged visit's id should differ from the first visit's id {firstVisit.Id}");
        secondVisit.PetId.Should().Be(petId,
            because: $"the directly logged visit id {secondVisit.Id} should be linked to pet id {petId}");
    }

    // AC-F03-04, step 1 (flows/F-03-pet-visit-flow.md:164-167): the same empty-body shape as
    // PetSteps's "the pet update returns an empty body", this time for PUT /visits/{id}.
    [Then("the visit update returns an empty body")]
    public void TheVisitUpdateReturnsAnEmptyBody()
    {
        var visitId = _state.GetResponse<Visit>("Visit").Body!.Id!.Value;
        var response = _state.GetResponse("VisitUpdate");

        response.RawContent.Should().BeNullOrEmpty(
            because: $"a PUT /visits/{visitId} response should carry no body, per the API conventions for PUT");
    }

    // AC-F03-04, step 2 (flows/F-03-pet-visit-flow.md:169-172): unlike "the visit details show the
    // pet link and unchanged data", which asserts the description stayed the same, this AC's whole
    // point is that the description changed while the date and the pet link did not -- so this
    // compares the description against the "VisitUpdate" entity while still comparing the date
    // against the original "Visit" one.
    [Then("the visit details show the pet link and the corrected description")]
    public void TheVisitDetailsShowThePetLinkAndTheCorrectedDescription()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var original = _state.GetEntity<Visit>("Visit");
        var updated = _state.GetEntity<Visit>("VisitUpdate");
        var details = _state.GetResponse<Visit>("VisitDetails").Body!;

        details.PetId.Should().Be(petId,
            because: $"visit id {details.Id} should still be linked to pet id {petId} after its description was corrected");
        details.Description.Should().Be(updated.Description,
            because: $"visit id {details.Id} should show the corrected description");
        details.Date.Should().Be(original.Date,
            because: $"visit id {details.Id} should keep its original date after only the description was corrected");
    }

    // AC-F03-06, step 3 (flows/F-03-pet-visit-flow.md:238-241): reads the "Visit2" key rather than
    // "Visit" -- the first visit's own key is what "the visit details are opened" (used by step 2
    // to re-read the corrected visit) reads, so the two visits' request steps stay independent.
    [When("the second visit's details are opened")]
    public async Task TheSecondVisitsDetailsAreOpened()
    {
        var visitId = _state.GetResponse<Visit>("Visit2").Body!.Id!.Value;
        var response = await _visits.Get(visitId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("Visit2Details", response);
    }

    // AC-F03-06, step 3 (flows/F-03-pet-visit-flow.md:238-241): the same shape as "the visit
    // details show the pet link and unchanged data", but reading the "Visit2"/"Visit2Details" keys
    // instead of "Visit"/"VisitDetails" -- this AC's whole point is that editing the first visit
    // left the second one's own record untouched.
    [Then("the second visit's own details are unaffected by the first visit's correction")]
    public void TheSecondVisitsOwnDetailsAreUnaffectedByTheFirstVisitsCorrection()
    {
        var petId = _state.GetResponse<Pet>("Pet").Body!.Id!.Value;
        var visit = _state.GetEntity<Visit>("Visit2");
        var details = _state.GetResponse<Visit>("Visit2Details").Body!;

        details.PetId.Should().Be(petId,
            because: $"visit id {details.Id} should still be linked to pet id {petId} after the first visit's description was corrected");
        details.Description.Should().Be(visit.Description,
            because: $"visit id {details.Id} should keep its description after the first visit's description was corrected");
        details.Date.Should().Be(visit.Date,
            because: $"visit id {details.Id} should keep its date after the first visit's description was corrected");
    }

    // AC-F03-02, step 4 (flows/F-03-pet-visit-flow.md:125-127): unlike "the visits log contains
    // exactly one entry ...", this AC compares two visits recorded through two different routes
    // against each other, so it checks presence of both ids rather than filtering for duplicates.
    [Then("the visits log contains both recorded visits")]
    public void TheVisitsLogContainsBothRecordedVisits()
    {
        var firstVisit = _state.GetResponse<Visit>("Visit").Body!;
        var secondVisit = _state.GetResponse<Visit>("VisitDirect").Body!;
        var visits = _state.GetResponse<List<Visit>>("Visits").Body!;

        visits.Should().Contain(v => v.Id == firstVisit.Id,
            because: $"the clinic-wide visits log should contain the visit recorded from the pet details, id {firstVisit.Id}");
        visits.Should().Contain(v => v.Id == secondVisit.Id,
            because: $"the clinic-wide visits log should contain the visit recorded through the clinic-wide log route, id {secondVisit.Id}");
    }
}

// Data-only shape for the "visit2" section of an AC block, same reasoning as OwnerSteps's Pet2Case:
// TestDataProvider.For<Visit2Case>() resolves the section name to "visit2", giving AC-F03-02 a
// second visit's base date/description distinct from the "visit" section the shared VisitCase reads.
public class Visit2Case
{
    public string Description { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
}
