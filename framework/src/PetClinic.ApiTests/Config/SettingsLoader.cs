using Microsoft.Extensions.Configuration;

namespace PetClinic.ApiTests.Config;

public static class SettingsLoader
{
    private const string BaseUrlEnvironmentVariable = "PETCLINIC_BASE_URL";

    public static TestSettings Load()
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
            .Build();

        var baseUrl = configuration["baseUrl"]
            ?? throw new InvalidOperationException("appsettings.json is missing 'baseUrl'.");
        var timeoutMs = int.Parse(configuration["timeoutMs"]
            ?? throw new InvalidOperationException("appsettings.json is missing 'timeoutMs'."));
        var readinessPath = configuration["readinessPath"]
            ?? throw new InvalidOperationException("appsettings.json is missing 'readinessPath'.");
        var readinessTimeoutMs = int.Parse(configuration["readinessTimeoutMs"]
            ?? throw new InvalidOperationException("appsettings.json is missing 'readinessTimeoutMs'."));

        var baseUrlOverride = Environment.GetEnvironmentVariable(BaseUrlEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(baseUrlOverride))
        {
            baseUrl = baseUrlOverride;
        }

        return new TestSettings(baseUrl, timeoutMs, readinessPath, readinessTimeoutMs);
    }
}
