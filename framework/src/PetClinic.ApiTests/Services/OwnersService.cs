using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// Adapts ApiClient's RequestSpecBuilder to one call per route — `_client.Get<T>("owners")` rather
// than a NewRequest/WithPath/Build chain at every call site. Kept inside Services/ (not on
// ApiClient itself) so this row's diff cannot reach into Http/, which S4 already delivered.
// The route is always the first argument: scripts/invariants.mjs derives §7 coverage from exactly
// that shape, `_client.Verb("route", ...)`, across every service in this namespace.
internal sealed class RouteClient
{
    private readonly ApiClient _client;

    public RouteClient(ApiClient client)
    {
        _client = client;
    }

    public Task<ApiResponse<T>> Get<T>(string path, params (string Name, object Value)[] pathParams) =>
        _client.GetAsync<T>(Build(Method.Get, path, pathParams, body: null));

    public Task<ApiResponse<T>> Post<T>(string path, object body, params (string Name, object Value)[] pathParams) =>
        _client.PostAsync<T>(Build(Method.Post, path, pathParams, body));

    public Task<ApiResponse<object?>> Put(string path, object body, params (string Name, object Value)[] pathParams) =>
        _client.PutAsync(Build(Method.Put, path, pathParams, body));

    public Task<ApiResponse<object?>> Delete(string path, params (string Name, object Value)[] pathParams) =>
        _client.DeleteAsync(Build(Method.Delete, path, pathParams, body: null));

    private RestRequest Build(Method method, string path, (string Name, object Value)[] pathParams, object? body)
    {
        var builder = _client.NewRequest(method).WithPath(path);
        foreach (var (name, value) in pathParams)
        {
            builder.WithPathParam(name, value);
        }
        if (body is not null)
        {
            builder.WithBody(body);
        }
        return builder.Build();
    }
}

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
