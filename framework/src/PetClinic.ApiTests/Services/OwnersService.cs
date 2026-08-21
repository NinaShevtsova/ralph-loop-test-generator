using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the owners routes, plus the two nested pet routes: §7 of
// context-and-conventions.md states a pet is created and updated only through its owner, so those
// two operations belong here rather than in PetsService.
public sealed class OwnersService
{
    private readonly ApiClient _client;

    public OwnersService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<Owner>> Create(Owner owner) =>
        _client.PostAsync<Owner>(_client.NewRequest(Method.Post).WithPath("owners").WithBody(owner).Build());

    public Task<ApiResponse<List<Owner>>> GetAll() =>
        _client.GetAsync<List<Owner>>(_client.NewRequest(Method.Get).WithPath("owners").Build());

    public Task<ApiResponse<Owner>> GetById(int ownerId) =>
        _client.GetAsync<Owner>(_client.NewRequest(Method.Get)
            .WithPath("owners/{ownerId}").WithPathParam("ownerId", ownerId).Build());

    public Task<ApiResponse<object?>> Update(int ownerId, Owner owner) =>
        _client.PutAsync(_client.NewRequest(Method.Put)
            .WithPath("owners/{ownerId}").WithPathParam("ownerId", ownerId).WithBody(owner).Build());

    public Task<ApiResponse<object?>> Delete(int ownerId) =>
        _client.DeleteAsync(_client.NewRequest(Method.Delete)
            .WithPath("owners/{ownerId}").WithPathParam("ownerId", ownerId).Build());

    public Task<ApiResponse<Pet>> AddPet(int ownerId, Pet pet) =>
        _client.PostAsync<Pet>(_client.NewRequest(Method.Post)
            .WithPath("owners/{ownerId}/pets").WithPathParam("ownerId", ownerId).WithBody(pet).Build());

    public Task<ApiResponse<Pet>> GetPet(int ownerId, int petId) =>
        _client.GetAsync<Pet>(_client.NewRequest(Method.Get)
            .WithPath("owners/{ownerId}/pets/{petId}")
            .WithPathParam("ownerId", ownerId).WithPathParam("petId", petId).Build());

    public Task<ApiResponse<object?>> UpdatePet(int ownerId, int petId, Pet pet) =>
        _client.PutAsync(_client.NewRequest(Method.Put)
            .WithPath("owners/{ownerId}/pets/{petId}")
            .WithPathParam("ownerId", ownerId).WithPathParam("petId", petId).WithBody(pet).Build());
}
