using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the pettypes routes. §7 lists no Update for PetType — only
// Create, Read and Delete are used in the ACs.
public sealed class PetTypesService
{
    private readonly RouteClient _client;

    public PetTypesService(ApiClient client)
    {
        _client = new RouteClient(client);
    }

    public Task<ApiResponse<PetType>> Create(PetType petType) => _client.Post<PetType>("pettypes", petType);

    public Task<ApiResponse<List<PetType>>> GetAll() => _client.Get<List<PetType>>("pettypes");

    public Task<ApiResponse<PetType>> GetById(int petTypeId) =>
        _client.Get<PetType>("pettypes/{petTypeId}", ("petTypeId", petTypeId));

    public Task<ApiResponse<object?>> Delete(int petTypeId) =>
        _client.Delete("pettypes/{petTypeId}", ("petTypeId", petTypeId));
}
