using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// SERVICE OBJECT (design §4) over the direct pet routes. Creation has no route here — §7 states a
// pet is created only via OwnersService.AddPet — and deletion is only here, never via the owner.
public sealed class PetsService
{
    private readonly ApiClient _client;

    public PetsService(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<List<Pet>>> GetAll() =>
        _client.GetAsync<List<Pet>>(_client.NewRequest(Method.Get).WithPath("pets").Build());

    public Task<ApiResponse<Pet>> GetById(int petId) =>
        _client.GetAsync<Pet>(_client.NewRequest(Method.Get)
            .WithPath("pets/{petId}").WithPathParam("petId", petId).Build());

    public Task<ApiResponse<object?>> Update(int petId, Pet pet) =>
        _client.PutAsync(_client.NewRequest(Method.Put)
            .WithPath("pets/{petId}").WithPathParam("petId", petId).WithBody(pet).Build());

    public Task<ApiResponse<object?>> Delete(int petId) =>
        _client.DeleteAsync(_client.NewRequest(Method.Delete)
            .WithPath("pets/{petId}").WithPathParam("petId", petId).Build());
}
