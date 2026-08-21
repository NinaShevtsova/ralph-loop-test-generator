using System.Net;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// REQUEST STEPS (design §4, D-13) over the six visit routes of §7 — the two creation routes (nested
// under the pet, and the clinic-wide log) plus direct read/update/delete. "a visit is recorded for
// the pet" is bound as both [Given] and [When]: a precondition for the pet's visit history and the
// action under test for its own AC.
[Binding]
public sealed class VisitSteps
{
    private readonly VisitsService _visits;
    private readonly ScenarioState _state;
    private readonly ScenarioContext _scenarioContext;

    public VisitSteps(VisitsService visits, ScenarioState state, ScenarioContext scenarioContext)
    {
        _visits = visits;
        _state = state;
        _scenarioContext = scenarioContext;
    }

    [Given("a visit is recorded for the pet")]
    [When("a visit is recorded for the pet")]
    public async Task RecordVisitForPetAsync()
    {
        var owner = RequireOwner();
        var pet = RequirePet();
        var data = TestDataProvider.For<VisitCase>(_scenarioContext);
        var visit = new Visit
        {
            Description = UniqueData.VisitDescription(data.Description),
            Date = data.Date,
        };

        var response = await _visits.AddVisit(owner.Id!.Value, pet.Id!.Value, visit);
        response.EnsureStatus(HttpStatusCode.Created);

        _state.CreatedVisit = response.Body;
        _state.LastResponse = response;
        if (response.Body?.Id is int visitId)
        {
            _state.Tracker.TrackVisit(visitId);
        }
    }

    [When("a visit is logged directly for the pet")]
    public async Task LogVisitDirectlyForPetAsync()
    {
        var pet = RequirePet();
        var data = TestDataProvider.For<VisitCase>(_scenarioContext);
        var visit = new Visit
        {
            PetId = pet.Id,
            Description = UniqueData.VisitDescription(data.Description),
            Date = data.Date,
        };

        var response = await _visits.Create(visit);
        response.EnsureStatus(HttpStatusCode.Created);

        _state.CreatedVisit = response.Body;
        _state.LastResponse = response;
        if (response.Body?.Id is int visitId)
        {
            _state.Tracker.TrackVisit(visitId);
        }
    }

    [When("the visits log is requested")]
    public async Task RequestVisitsLogAsync()
    {
        var response = await _visits.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the visit details are opened")]
    public async Task OpenVisitDetailsAsync()
    {
        var visit = RequireVisit();
        var response = await _visits.GetById(visit.Id!.Value);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.LastResponse = response;
    }

    [When("the visit's details are updated")]
    public async Task UpdateVisitDetailsAsync()
    {
        var visit = RequireVisit();
        var updated = new Visit
        {
            Id = visit.Id,
            PetId = visit.PetId,
            Description = UniqueData.VisitDescription(visit.Description),
            Date = visit.Date,
        };

        var response = await _visits.Update(visit.Id!.Value, updated);
        response.EnsureStatus(HttpStatusCode.NoContent);

        _state.CreatedVisit = updated;
        _state.LastResponse = response;
    }

    [When("the visit is deleted")]
    public async Task DeleteVisitAsync()
    {
        var visit = RequireVisit();
        var response = await _visits.Delete(visit.Id!.Value);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.LastResponse = response;
    }

    private Owner RequireOwner() =>
        _state.CreatedOwner ?? throw new InvalidOperationException(
            "No owner is known yet in this scenario — register one first.");

    private Pet RequirePet() =>
        _state.CreatedPet ?? throw new InvalidOperationException(
            "No pet is known yet in this scenario — add one to an owner first.");

    private Visit RequireVisit() =>
        _state.CreatedVisit ?? throw new InvalidOperationException(
            "No visit is known yet in this scenario — record one first.");
}
