using PetClinic.ApiTests.Config;

namespace PetClinic.ApiTests.Http;

// REUSABLE REQUEST SPECIFICATION (design §4): base URL, default headers and timeout, shared by
// every request the framework issues. Immutable so a service cannot mutate it out from under
// another one sharing the same ApiClient.
public sealed class RequestSpec
{
    public string BaseUrl { get; }
    public string ContentType { get; }
    public string Accept { get; }
    public int TimeoutMs { get; }

    private RequestSpec(string baseUrl, string contentType, string accept, int timeoutMs)
    {
        BaseUrl = baseUrl;
        ContentType = contentType;
        Accept = accept;
        TimeoutMs = timeoutMs;
    }

    public static RequestSpec Default(TestSettings settings) =>
        new(settings.BaseUrl, contentType: "application/json", accept: "application/json", settings.TimeoutMs);
}
