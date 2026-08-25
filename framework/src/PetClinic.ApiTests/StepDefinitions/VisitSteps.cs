using System.Net;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// The 6 request steps of §7 that VisitsService exposes: the two creation routes (nested under the
// pet, and the clinic-wide log) plus read/update/delete of a single visit and the log itself.
[Binding]
public sealed class VisitSteps
{
    private readonly VisitsService _visits;
    private readonly ScenarioState _state;
    private readonly StatusCheck _check;
    private readonly TestDataProvider _data;

    public VisitSteps(VisitsService visits, ScenarioState state, StatusCheck check, TestDataProvider data)
    {
        _visits = visits;
        _state = state;
        _check = check;
        _data = data;
    }

    // One of the four creation sentences that also serves as a Given (S12 DoD): US-05's flows build
    // an owner-with-a-pet-with-a-visit as their shared precondition.
    [Given("a visit is recorded for the pet")]
    [When("a visit is recorded for the pet")]
    public async Task AVisitIsRecordedForThePet()
    {
        var ownerId = _state.CreatedOwner.Id ?? throw new InvalidOperationException("Owner has no id.");
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id.");
        var data = _data.For<VisitCase>();

        var visit = new Visit
        {
            Description = UniqueData.VisitDescription(data.Description),
            Date = data.Date,
        };

        var response = _check.Expect(await _visits.AddVisit(ownerId, petId, visit), HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST .../visits answered 201 with no body.");

        _state.CreatedVisit = created;

        // Stored separately from CreatedVisit: AC-F02-05 reopens this visit through "the visit
        // details are opened" after the pet's own update, and that step overwrites CreatedVisit
        // with its own fetched body -- an assertion comparing the fetch against what was actually
        // submitted needs this copy, not the overwritten one (same reason OwnerSteps keeps
        // OwnerAddPetRequest next to CreatedPet).
        _state.Set("VisitAddRequest", visit);
        _state.Set("VisitAddResponse", response);
        _state.Tracker.TrackVisit(created.Id ?? throw new InvalidOperationException("Created visit carries no id."));
    }

    // §7's other creation route. `petId` is required here (unlike the nested route, which takes it
    // from the path) — and `id` is still never set: §11 records that submitting it is a 500 on save.
    [When("a visit is recorded in the clinic log")]
    public async Task AVisitIsRecordedInTheClinicLog()
    {
        var petId = _state.CreatedPet.Id ?? throw new InvalidOperationException("Pet has no id.");
        var data = _data.For<VisitCase>();

        var visit = new Visit
        {
            PetId = petId,
            Description = UniqueData.VisitDescription(data.Description),
            Date = data.Date,
        };

        var response = _check.Expect(await _visits.Create(visit), HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /visits answered 201 with no body.");

        _state.CreatedVisit = created;
        _state.Set("VisitCreateRequest", visit);
        _state.Set("VisitCreateResponse", response);
        _state.Tracker.TrackVisit(created.Id ?? throw new InvalidOperationException("Created visit carries no id."));
    }

    [When("the visits log is requested")]
    public async Task TheVisitsLogIsRequested()
    {
        var response = _check.Expect(await _visits.GetAll(), HttpStatusCode.OK);
        _state.Set("VisitLogResponse", response);
    }

    [When("the visit details are opened")]
    public async Task TheVisitDetailsAreOpened()
    {
        var visitId = _state.CreatedVisit.Id ?? throw new InvalidOperationException("Visit has no id to open.");
        var response = _check.Expect(await _visits.GetById(visitId), HttpStatusCode.OK);

        _state.CreatedVisit = response.Body ?? throw new InvalidOperationException("GET /visits/{visitId} answered 200 with no body.");
        _state.Set("VisitGetByIdResponse", response);
    }

    [When("the visit details are updated")]
    public async Task TheVisitDetailsAreUpdated()
    {
        var existing = _state.CreatedVisit;
        var visitId = existing.Id ?? throw new InvalidOperationException("Visit has no id to update.");
        var data = _data.For<VisitCase>();

        var updated = new Visit
        {
            Description = UniqueData.VisitDescription(data.Description),
            Date = existing.Date,
        };

        var response = _check.Expect(await _visits.Update(visitId, updated), HttpStatusCode.NoContent);

        updated.Id = visitId;
        _state.CreatedVisit = updated;
        _state.Set("VisitUpdateResponse", response);
    }

    [When("the visit is deleted")]
    public async Task TheVisitIsDeleted()
    {
        var visitId = _state.CreatedVisit.Id ?? throw new InvalidOperationException("Visit has no id to delete.");
        var response = _check.Expect(await _visits.Delete(visitId), HttpStatusCode.NoContent);
        _state.Set("VisitDeleteResponse", response);
    }

    // AC-F01-04 step 5: a GET on a visit removed along with its pet by the owner's deregistration
    // cascade, not by "the visit is deleted". Expected code is the opposite of "the visit details
    // are opened" (404, not 200), so this is its own step rather than a reworded one.
    [When("an attempt is made to open the visit details")]
    public async Task AnAttemptIsMadeToOpenTheVisitDetails()
    {
        var visitId = _state.CreatedVisit.Id ?? throw new InvalidOperationException("Visit has no id to open.");
        var response = _check.Expect(await _visits.GetById(visitId), HttpStatusCode.NotFound);
        _state.Set("VisitGetByIdAfterDeleteResponse", response);
    }
}
