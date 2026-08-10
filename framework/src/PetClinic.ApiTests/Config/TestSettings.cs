namespace PetClinic.ApiTests.Config;

public sealed record TestSettings(
    string BaseUrl,
    int TimeoutMs,
    string ReadinessPath,
    int ReadinessTimeoutMs);
