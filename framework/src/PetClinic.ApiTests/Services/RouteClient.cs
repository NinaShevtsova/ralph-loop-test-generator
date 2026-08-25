using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using RestSharp;

namespace PetClinic.ApiTests.Services;

// Shared by all four services. It was declared inside OwnersService.cs, where three of its four
// users could not see why it lived there -- and where a whole-tree check read its public members as
// OwnersService's own API and blocked a run on a method no step should ever call.

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
