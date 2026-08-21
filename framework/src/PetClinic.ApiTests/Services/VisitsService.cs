using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the visit routes. §7 gives a visit TWO creation routes — nested
// under the pet, and the clinic-wide log — both kept here since both answer with the created Visit.
public sealed class VisitsService
{
    private readonly ApiClient _client;

    public VisitsService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<Visit>> AddVisit(int ownerId, int petId, Visit visit) =>
        _client.PostAsync<Visit>(_client.NewRequest(Method.Post)
            .WithPath("owners/{ownerId}/pets/{petId}/visits")
            .WithPathParam("ownerId", ownerId).WithPathParam("petId", petId).WithBody(visit).Build());

    public Task<ApiResponse<Visit>> Create(Visit visit) =>
        _client.PostAsync<Visit>(_client.NewRequest(Method.Post).WithPath("visits").WithBody(visit).Build());

    public Task<ApiResponse<List<Visit>>> GetAll() =>
        _client.GetAsync<List<Visit>>(_client.NewRequest(Method.Get).WithPath("visits").Build());

    public Task<ApiResponse<Visit>> GetById(int visitId) =>
        _client.GetAsync<Visit>(_client.NewRequest(Method.Get)
            .WithPath("visits/{visitId}").WithPathParam("visitId", visitId).Build());

    public Task<ApiResponse<object?>> Update(int visitId, Visit visit) =>
        _client.PutAsync(_client.NewRequest(Method.Put)
            .WithPath("visits/{visitId}").WithPathParam("visitId", visitId).WithBody(visit).Build());

    public Task<ApiResponse<object?>> Delete(int visitId) =>
        _client.DeleteAsync(_client.NewRequest(Method.Delete)
            .WithPath("visits/{visitId}").WithPathParam("visitId", visitId).Build());
}
