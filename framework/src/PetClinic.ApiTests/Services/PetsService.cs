using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the direct pet routes. Creation has no route here — §7 states a
// pet is created only via OwnersService.AddPet — and deletion is only here, never via the owner.
public sealed class PetsService
{
    private readonly RouteClient _client;

    public PetsService(ApiClient client)
    {
        _client = new RouteClient(client);
    }

    public Task<ApiResponse<List<Pet>>> GetAll() => _client.Get<List<Pet>>("pets");

    public Task<ApiResponse<Pet>> GetById(int petId) =>
        _client.Get<Pet>("pets/{petId}", ("petId", petId));

    public Task<ApiResponse<object?>> Update(int petId, Pet pet) =>
        _client.Put("pets/{petId}", pet, ("petId", petId));

    public Task<ApiResponse<object?>> Delete(int petId) =>
        _client.Delete("pets/{petId}", ("petId", petId));
}
