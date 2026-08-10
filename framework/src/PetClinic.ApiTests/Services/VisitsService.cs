using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

public sealed class VisitsService
{
    private readonly ApiClient _client;

    public VisitsService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<Visit>> AddToPet(int ownerId, int petId, Visit visit) =>
        _client.Post<Visit>("owners/{ownerId}/pets/{petId}/visits", visit, b => b
            .WithPathParam("ownerId", ownerId)
            .WithPathParam("petId", petId));

    public Task<ApiResponse<Visit>> Create(Visit visit) =>
        _client.Post<Visit>("visits", visit);

    public Task<ApiResponse<List<Visit>>> GetAll() =>
        _client.Get<List<Visit>>("visits");

    public Task<ApiResponse<Visit>> Get(int visitId) =>
        _client.Get<Visit>("visits/{visitId}", b => b.WithPathParam("visitId", visitId));

    public Task<ApiResponse> Update(int visitId, Visit visit) =>
        _client.Put("visits/{visitId}", visit, b => b.WithPathParam("visitId", visitId));

    public Task<ApiResponse> Delete(int visitId) =>
        _client.Delete("visits/{visitId}", b => b.WithPathParam("visitId", visitId));
}
