using PetClinic.ApiTests.Config;
using RestSharp;

namespace PetClinic.ApiTests.Http;

// Owns the ONE RestClient for the whole run. No service, step or test may `new RestClient` — every
// call goes through ApiClient.Shared, which is what keeps the connection pool, base URL and timeout
// in exactly one place.
public sealed class ApiClient
{
    private readonly RestClient _client;

    private ApiClient(RequestSpec spec)
    {
        Spec = spec;
        _client = new RestClient(new RestClientOptions(spec.BaseUrl)
        {
            Timeout = TimeSpan.FromMilliseconds(spec.TimeoutMs),
        });
    }

    public static ApiClient Shared { get; } = new(RequestSpec.Default(SettingsLoader.Load()));

    // The spec this client was configured from, kept as the single instance every request is built
    // from — a service builds its requests via NewRequest rather than re-loading settings itself.
    public RequestSpec Spec { get; }

    public RequestSpecBuilder NewRequest(Method method) => new(Spec, method);

    public Task<ApiResponse<T>> GetAsync<T>(RestRequest request) => ExecuteAsync<T>(request);

    public Task<ApiResponse<T>> PostAsync<T>(RestRequest request) => ExecuteAsync<T>(request);

    // PUT and DELETE answer 204 with an empty body (§7 of context-and-conventions.md) — the caller
    // verifies the result with a subsequent GET, so these return no typed body to deserialize.
    public Task<ApiResponse<object?>> PutAsync(RestRequest request) => ExecuteAsync<object?>(request);

    public Task<ApiResponse<object?>> DeleteAsync(RestRequest request) => ExecuteAsync<object?>(request);

    private async Task<ApiResponse<T>> ExecuteAsync<T>(RestRequest request)
    {
        var response = await _client.ExecuteAsync<T>(request);

        // The resolved URL when RestSharp reports one, the template otherwise. Both were already here
        // and both were thrown away, which is why every failure message named no route.
        var resource = response.ResponseUri?.ToString() ?? request.Resource;
        return new ApiResponse<T>(
            response.StatusCode,
            response.Data,
            response.Content,
            response.Headers,
            new RequestContext(request.Method, resource));
    }
}
