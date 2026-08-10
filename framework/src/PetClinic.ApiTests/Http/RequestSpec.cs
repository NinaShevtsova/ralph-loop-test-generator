using PetClinic.ApiTests.Config;

namespace PetClinic.ApiTests.Http;

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
        new(settings.BaseUrl, "application/json", "application/json", settings.TimeoutMs);
}
