using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the visit routes. §7 gives a visit TWO creation routes — nested
// under the pet, and the clinic-wide log — both kept here since both answer with the created Visit.
public sealed class VisitsService
{
    private readonly RouteClient _client;

    public VisitsService(ApiClient client)
    {
        _client = new RouteClient(client);
    }

    public Task<ApiResponse<Visit>> AddVisit(int ownerId, int petId, Visit visit) =>
        _client.Post<Visit>("owners/{ownerId}/pets/{petId}/visits", visit, ("ownerId", ownerId), ("petId", petId));

    public Task<ApiResponse<Visit>> Create(Visit visit) => _client.Post<Visit>("visits", visit);

    public Task<ApiResponse<List<Visit>>> GetAll() => _client.Get<List<Visit>>("visits");

    public Task<ApiResponse<Visit>> GetById(int visitId) =>
        _client.Get<Visit>("visits/{visitId}", ("visitId", visitId));

    public Task<ApiResponse<object?>> Update(int visitId, Visit visit) =>
        _client.Put("visits/{visitId}", visit, ("visitId", visitId));

    public Task<ApiResponse<object?>> Delete(int visitId) =>
        _client.Delete("visits/{visitId}", ("visitId", visitId));
}
