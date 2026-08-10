using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

// A pet is created only through OwnersService.AddPet and deleted only through Delete below (§7).
public sealed class PetsService
{
    private readonly ApiClient _client;

    public PetsService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<List<Pet>>> GetAll() =>
        _client.Get<List<Pet>>("pets");

    public Task<ApiResponse<Pet>> Get(int petId) =>
        _client.Get<Pet>("pets/{petId}", b => b.WithPathParam("petId", petId));

    public Task<ApiResponse> Update(int petId, Pet pet) =>
        _client.Put("pets/{petId}", pet, b => b.WithPathParam("petId", petId));

    public Task<ApiResponse> Delete(int petId) =>
        _client.Delete("pets/{petId}", b => b.WithPathParam("petId", petId));
}
