using FluentAssertions;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Support;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// Assertion ("Then") steps for F-01's cascade AC (AC-F01-04, stage 1). The request steps these
// build on live in VisitSteps.cs (stage 0, design D-13); this file issues no requests of its own,
// it only reads back what those steps already stored in ScenarioState and asserts on it.
[Binding]
public sealed class VisitAssertionSteps
{
    private readonly ScenarioState _state;

    public VisitAssertionSteps(ScenarioState state)
    {
        _state = state;
    }

    // AC-F03-01 step 1: compared against VisitAddRequest -- the exact Visit "a visit is recorded for
    // the pet" sent on the wire -- not against the base VisitCase, the same "compare against what was
    // submitted" rule PetAssertionSteps applies to the nested pet-creation route, now for the
    // nested visit-creation route.
    [Then("the created visit has an assigned id, the submitted values and a link to the pet")]
    public void TheCreatedVisitHasAnAssignedIdTheSubmittedValuesAndALinkToThePet()
    {
        var visit = _state.Get<ApiResponse<Visit>>("VisitAddResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets/{petId}/visits answered 201 with no body.");
        var submitted = _state.Get<Visit>("VisitAddRequest");
        var petId = _state.CreatedPet.Id;
        var visitId = visit.Id;

        visit.Id.Should().NotBeNull($"recording a visit for pet {petId} must return the id the API assigned it");
        visit.PetId.Should().Be(petId, $"visit {visitId} must carry a link back to pet {petId}");
        visit.Description.Should().Be(submitted.Description, $"visit {visitId} must keep the description that was submitted");
        visit.Date.Should().Be(submitted.Date, $"visit {visitId} must keep the date that was submitted");
    }

    // AC-F03-01 step 5: "exactly one" per §10.4, compared against the pet's id -- the same
    // "compare against the submitted link" rule PetAssertionSteps applies to the clinic-wide pets
    // list, now for the clinic-wide visits log.
    [Then("the visit appears exactly once in the visits list with the pet's id")]
    public void TheVisitAppearsExactlyOnceInTheVisitsListWithThePetsId()
    {
        var visitId = _state.CreatedVisit.Id ?? throw new InvalidOperationException("Created visit carries no id.");
        var petId = _state.CreatedPet.Id;
        var log = _state.Get<ApiResponse<List<Visit>>>("VisitLogResponse").Body
            ?? throw new InvalidOperationException("GET /visits answered 200 with no body.");

        log.Should().ContainSingle(v => v.Id == visitId,
            $"visit {visitId} must appear exactly once in the clinic-wide visits log");

        var listed = log.Single(v => v.Id == visitId);
        listed.PetId.Should().Be(petId, $"visit {visitId}'s entry in the visits log must link back to pet {petId}");
    }

    // AC-F01-04 step 5: the code (404) is asserted by EnsureStatus inside "an attempt is made to
    // open the visit details"; this checks the other half §7 states for every 404 -- no body to
    // carry.
    [Then("the visit details are no longer available")]
    public void TheVisitDetailsAreNoLongerAvailable()
    {
        var visitId = _state.CreatedVisit.Id;
        var response = _state.Get<ApiResponse<Visit>>("VisitGetByIdAfterDeleteResponse");

        response.RawContent.Should().BeNullOrEmpty(
            $"visit {visitId}'s details must return no body once its pet has been removed (§7)");
    }

    // AC-F01-04 step 6 (visits half): deregistering the owner must not leave the visit dangling in
    // the clinic-wide visits log.
    [Then("the visit is missing from the visits list")]
    public void TheVisitIsMissingFromTheVisitsList()
    {
        var visitId = _state.CreatedVisit.Id ?? throw new InvalidOperationException("Created visit carries no id.");
        var log = _state.Get<ApiResponse<List<Visit>>>("VisitLogResponse").Body
            ?? throw new InvalidOperationException("GET /visits answered 200 with no body.");

        log.Should().NotContain(v => v.Id == visitId,
            $"visit {visitId} must no longer appear in the visits log once its pet has been removed");
    }

    // AC-F02-05 step 4: compared against VisitAddRequest -- the exact body "a visit is recorded for
    // the pet" put on the wire -- not against _state.CreatedVisit, since "the visit details are
    // opened" (the very step that performs this GET) overwrites CreatedVisit with its own fetched
    // body before this Then ever runs, the same reason PetAssertionSteps compares the pet's own
    // update against a request key instead of CreatedPet.
    [Then("the visit still shows the description and date it was recorded with")]
    public void TheVisitStillShowsTheDescriptionAndDateItWasRecordedWith()
    {
        var fetched = _state.Get<ApiResponse<Visit>>("VisitGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /visits/{visitId} answered 200 with no body.");
        var submitted = _state.Get<Visit>("VisitAddRequest");
        var petId = _state.CreatedPet.Id;
        var visitId = fetched.Id;

        fetched.PetId.Should().Be(petId, $"visit {visitId} must still belong to pet {petId} after the pet's own update");
        fetched.Description.Should().Be(submitted.Description, $"visit {visitId}'s description must be unaffected by changing pet {petId}'s data");
        fetched.Date.Should().Be(submitted.Date, $"visit {visitId}'s date must be unaffected by changing pet {petId}'s data");
    }

    // AC-F03-02 step 2: mirrors "the second pet has its own id, distinct from the first pet"
    // (PetAssertionSteps) for §7's other visit-creation route -- compared against VisitCreateResponse,
    // which "a visit is recorded in the clinic log" writes, against VisitAddResponse from the earlier
    // nested-route visit.
    [Then("the visit recorded in the clinic log carries the pet's id and an id distinct from the first visit")]
    public void TheVisitRecordedInTheClinicLogCarriesThePetsIdAndAnIdDistinctFromTheFirstVisit()
    {
        var first = _state.Get<ApiResponse<Visit>>("VisitAddResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets/{petId}/visits answered 201 with no body.");
        var second = _state.Get<ApiResponse<Visit>>("VisitCreateResponse").Body
            ?? throw new InvalidOperationException("POST /visits answered 201 with no body.");
        var petId = _state.CreatedPet.Id;

        second.Id.Should().NotBeNull("recording a visit in the clinic log must return the id the API assigned it");
        second.PetId.Should().Be(petId, $"visit {second.Id} recorded in the clinic log must carry a link back to pet {petId}");
        second.Id.Should().NotBe(first.Id, $"the visit recorded in the clinic log must get its own id, distinct from the first visit {first.Id}");
    }

    // AC-F03-02 step 3: both visits -- one from each creation route -- must be visible together in
    // the same pet's history, each still matching what was actually submitted for it (VisitAddRequest
    // for the nested route, VisitCreateRequest for the clinic-wide one).
    [Then("the pet details show both visits recorded for it")]
    public void ThePetDetailsShowBothVisitsRecordedForIt()
    {
        var fetched = _state.Get<ApiResponse<Pet>>("PetGetByIdResponse").Body
            ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
        var petId = fetched.Id;

        var firstVisit = _state.Get<ApiResponse<Visit>>("VisitAddResponse").Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets/{petId}/visits answered 201 with no body.");
        var firstSubmitted = _state.Get<Visit>("VisitAddRequest");
        var secondVisit = _state.Get<ApiResponse<Visit>>("VisitCreateResponse").Body
            ?? throw new InvalidOperationException("POST /visits answered 201 with no body.");
        var secondSubmitted = _state.Get<Visit>("VisitCreateRequest");

        fetched.Visits.Should().NotBeNull($"pet {petId}'s details must carry a visits field");

        fetched.Visits.Should().Contain(v => v.Id == firstVisit.Id,
            $"pet {petId}'s visit history must show the visit recorded from its own details ({firstVisit.Id})");
        var recordedFirst = fetched.Visits!.Single(v => v.Id == firstVisit.Id);
        recordedFirst.Description.Should().Be(firstSubmitted.Description, $"visit {firstVisit.Id}'s description must match what was submitted");
        recordedFirst.Date.Should().Be(firstSubmitted.Date, $"visit {firstVisit.Id}'s date must match what was submitted");
        recordedFirst.PetId.Should().Be(petId, $"visit {firstVisit.Id} must link back to pet {petId}");

        fetched.Visits.Should().Contain(v => v.Id == secondVisit.Id,
            $"pet {petId}'s visit history must show the visit recorded in the clinic-wide log ({secondVisit.Id})");
        var recordedSecond = fetched.Visits!.Single(v => v.Id == secondVisit.Id);
        recordedSecond.Description.Should().Be(secondSubmitted.Description, $"visit {secondVisit.Id}'s description must match what was submitted");
        recordedSecond.Date.Should().Be(secondSubmitted.Date, $"visit {secondVisit.Id}'s date must match what was submitted");
        recordedSecond.PetId.Should().Be(petId, $"visit {secondVisit.Id} must link back to pet {petId}");
    }

    // AC-F03-02 step 4: plural counterpart of "the visit appears exactly once in the visits list
    // with the pet's id" -- both routes' visits must be present in the clinic-wide log, each linked
    // back to the same pet.
    [Then("both visits appear in the visits list with the pet's id")]
    public void BothVisitsAppearInTheVisitsListWithThePetsId()
    {
        var petId = _state.CreatedPet.Id;
        var firstVisitId = _state.Get<ApiResponse<Visit>>("VisitAddResponse").Body?.Id
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets/{petId}/visits answered 201 with no body.");
        var secondVisitId = _state.Get<ApiResponse<Visit>>("VisitCreateResponse").Body?.Id
            ?? throw new InvalidOperationException("POST /visits answered 201 with no body.");
        var log = _state.Get<ApiResponse<List<Visit>>>("VisitLogResponse").Body
            ?? throw new InvalidOperationException("GET /visits answered 200 with no body.");

        log.Should().ContainSingle(v => v.Id == firstVisitId,
            $"visit {firstVisitId} must appear exactly once in the clinic-wide visits log");
        log.Single(v => v.Id == firstVisitId).PetId.Should().Be(petId, $"visit {firstVisitId}'s entry in the visits log must link back to pet {petId}");

        log.Should().ContainSingle(v => v.Id == secondVisitId,
            $"visit {secondVisitId} must appear exactly once in the clinic-wide visits log");
        log.Single(v => v.Id == secondVisitId).PetId.Should().Be(petId, $"visit {secondVisitId}'s entry in the visits log must link back to pet {petId}");
    }
}
