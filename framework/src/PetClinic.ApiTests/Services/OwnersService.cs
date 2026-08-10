using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

public sealed class OwnersService
{
    private readonly ApiClient _client;

    public OwnersService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<Owner>> Create(Owner owner) =>
        _client.Post<Owner>("owners", owner);

    public Task<ApiResponse<List<Owner>>> GetAll() =>
        _client.Get<List<Owner>>("owners");

    public Task<ApiResponse<Owner>> Get(int ownerId) =>
        _client.Get<Owner>("owners/{ownerId}", b => b.WithPathParam("ownerId", ownerId));

    public Task<ApiResponse> Update(int ownerId, Owner owner) =>
        _client.Put("owners/{ownerId}", owner, b => b.WithPathParam("ownerId", ownerId));

    public Task<ApiResponse> Delete(int ownerId) =>
        _client.Delete("owners/{ownerId}", b => b.WithPathParam("ownerId", ownerId));

    public Task<ApiResponse<Pet>> AddPet(int ownerId, Pet pet) =>
        _client.Post<Pet>("owners/{ownerId}/pets", pet, b => b.WithPathParam("ownerId", ownerId));

    public Task<ApiResponse<Pet>> GetPet(int ownerId, int petId) =>
        _client.Get<Pet>("owners/{ownerId}/pets/{petId}", b => b
            .WithPathParam("ownerId", ownerId)
            .WithPathParam("petId", petId));

    public Task<ApiResponse> UpdatePet(int ownerId, int petId, Pet pet) =>
        _client.Put("owners/{ownerId}/pets/{petId}", pet, b => b
            .WithPathParam("ownerId", ownerId)
            .WithPathParam("petId", petId));
}
