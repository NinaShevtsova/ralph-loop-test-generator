using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the pettypes routes. §7 lists no Update for PetType — only
// Create, Read and Delete are used in the ACs.
public sealed class PetTypesService
{
    private readonly ApiClient _client;

    public PetTypesService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<PetType>> Create(PetType petType) =>
        _client.PostAsync<PetType>(_client.NewRequest(Method.Post).WithPath("pettypes").WithBody(petType).Build());

    public Task<ApiResponse<List<PetType>>> GetAll() =>
        _client.GetAsync<List<PetType>>(_client.NewRequest(Method.Get).WithPath("pettypes").Build());

    public Task<ApiResponse<PetType>> GetById(int petTypeId) =>
        _client.GetAsync<PetType>(_client.NewRequest(Method.Get)
            .WithPath("pettypes/{petTypeId}").WithPathParam("petTypeId", petTypeId).Build());

    public Task<ApiResponse<object?>> Delete(int petTypeId) =>
        _client.DeleteAsync(_client.NewRequest(Method.Delete)
            .WithPath("pettypes/{petTypeId}").WithPathParam("petTypeId", petTypeId).Build());
}
