using Microsoft.Extensions.Configuration;

namespace PetClinic.ApiTests.Config;

public static class SettingsLoader
{
    private const string BaseUrlOverrideVariable = "PETCLINIC_BASE_URL";

    public static TestSettings Load()
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();

        var baseUrl = Environment.GetEnvironmentVariable(BaseUrlOverrideVariable);
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            baseUrl = Require(configuration, "baseUrl");
        }

        return new TestSettings(
            baseUrl,
            int.Parse(Require(configuration, "timeoutMs")),
            Require(configuration, "readinessPath"),
            int.Parse(Require(configuration, "readinessTimeoutMs")));
    }

    private static string Require(IConfiguration configuration, string key) =>
        configuration[key] ?? throw new InvalidOperationException(
            $"appsettings.json is missing the required '{key}' setting.");
}
