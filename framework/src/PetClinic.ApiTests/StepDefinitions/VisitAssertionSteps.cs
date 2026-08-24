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
}
