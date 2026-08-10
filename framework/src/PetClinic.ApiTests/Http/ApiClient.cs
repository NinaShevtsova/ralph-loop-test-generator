using RestSharp;
using PetClinic.ApiTests.Config;

using System.Linq;

namespace PetClinic.ApiTests.Http;

public sealed class ApiClient
{
    private readonly RestClient _restClient;
    private readonly RequestSpec _spec;

    private ApiClient(RestClient restClient, RequestSpec spec)
    {
        _restClient = restClient;
        _spec = spec;
    }

    public static ApiClient Shared { get; } = Create(SettingsLoader.Load());

    private static ApiClient Create(TestSettings settings)
    {
        var spec = RequestSpec.Default(settings);
        var options = new RestClientOptions(spec.BaseUrl)
        {
            Timeout = TimeSpan.FromMilliseconds(spec.TimeoutMs),
        };
        return new ApiClient(new RestClient(options), spec);
    }

    public async Task<ApiResponse<T>> Get<T>(string path, Action<RequestSpecBuilder>? configure = null)
    {
        var request = BuildRequest(Method.Get, path, configure);
        var response = await _restClient.ExecuteAsync<T>(request);
        return ToTypedResponse(response);
    }

    public async Task<ApiResponse<T>> Post<T>(string path, object body, Action<RequestSpecBuilder>? configure = null)
    {
        var request = BuildRequest(Method.Post, path, builder =>
        {
            builder.WithBody(body);
            configure?.Invoke(builder);
        });
        var response = await _restClient.ExecuteAsync<T>(request);
        return ToTypedResponse(response);
    }

    public async Task<ApiResponse> Put(string path, object body, Action<RequestSpecBuilder>? configure = null)
    {
        var request = BuildRequest(Method.Put, path, builder =>
        {
            builder.WithBody(body);
            configure?.Invoke(builder);
        });
        var response = await _restClient.ExecuteAsync(request);
        return ToResponse(response);
    }

    public async Task<ApiResponse> Delete(string path, Action<RequestSpecBuilder>? configure = null)
    {
        var request = BuildRequest(Method.Delete, path, configure);
        var response = await _restClient.ExecuteAsync(request);
        return ToResponse(response);
    }

    private RestRequest BuildRequest(Method method, string path, Action<RequestSpecBuilder>? configure)
    {
        var builder = new RequestSpecBuilder(_spec, method).WithPath(path);
        configure?.Invoke(builder);
        return builder.Build();
    }

    private static ApiResponse ToResponse(RestResponse response) =>
        new(response.StatusCode, response.Content, ToHeaderMap(response.Headers));

    private static ApiResponse<T> ToTypedResponse<T>(RestResponse<T> response) =>
        new(response.StatusCode, response.Data, response.Content, ToHeaderMap(response.Headers));

    private static IReadOnlyDictionary<string, string> ToHeaderMap(IReadOnlyCollection<HeaderParameter>? headers) =>
        (headers ?? Array.Empty<HeaderParameter>())
            .GroupBy(h => h.Name ?? string.Empty)
            .ToDictionary(g => g.Key, g => string.Join(", ", g.Select(h => h.Value?.ToString() ?? string.Empty)));
}
