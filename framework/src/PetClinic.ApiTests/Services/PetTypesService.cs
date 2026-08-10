using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

public sealed class PetTypesService
{
    private readonly ApiClient _client;

    public PetTypesService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<PetType>> Create(PetType petType) =>
        _client.Post<PetType>("pettypes", petType);

    public Task<ApiResponse<List<PetType>>> GetAll() =>
        _client.Get<List<PetType>>("pettypes");

    public Task<ApiResponse<PetType>> Get(int petTypeId) =>
        _client.Get<PetType>("pettypes/{petTypeId}", b => b.WithPathParam("petTypeId", petTypeId));

    public Task<ApiResponse> Delete(int petTypeId) =>
        _client.Delete("pettypes/{petTypeId}", b => b.WithPathParam("petTypeId", petTypeId));
}
