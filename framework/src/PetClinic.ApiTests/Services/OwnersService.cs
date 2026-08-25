using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the owners routes, plus the two nested pet routes: §7 of
// context-and-conventions.md states a pet is created and updated only through its owner, so those
// two operations belong here rather than in PetsService.
public sealed class OwnersService
{
    private readonly RouteClient _client;

    public OwnersService(ApiClient client)
    {
        _client = new RouteClient(client);
    }

    public Task<ApiResponse<Owner>> Create(Owner owner) => _client.Post<Owner>("owners", owner);

    public Task<ApiResponse<List<Owner>>> GetAll() => _client.Get<List<Owner>>("owners");

    public Task<ApiResponse<Owner>> GetById(int ownerId) =>
        _client.Get<Owner>("owners/{ownerId}", ("ownerId", ownerId));

    public Task<ApiResponse<object?>> Update(int ownerId, Owner owner) =>
        _client.Put("owners/{ownerId}", owner, ("ownerId", ownerId));

    public Task<ApiResponse<object?>> Delete(int ownerId) =>
        _client.Delete("owners/{ownerId}", ("ownerId", ownerId));

    public Task<ApiResponse<Pet>> AddPet(int ownerId, Pet pet) =>
        _client.Post<Pet>("owners/{ownerId}/pets", pet, ("ownerId", ownerId));

    public Task<ApiResponse<Pet>> GetPet(int ownerId, int petId) =>
        _client.Get<Pet>("owners/{ownerId}/pets/{petId}", ("ownerId", ownerId), ("petId", petId));

    public Task<ApiResponse<object?>> UpdatePet(int ownerId, int petId, Pet pet) =>
        _client.Put("owners/{ownerId}/pets/{petId}", pet, ("ownerId", ownerId), ("petId", petId));
}
