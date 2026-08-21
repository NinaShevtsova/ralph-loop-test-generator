using System.Diagnostics;
using System.Net;
using PetClinic.ApiTests.Config;
using PetClinic.ApiTests.Http;
using RestSharp;

namespace PetClinic.ApiTests.Support;

// Polls readinessPath from appsettings.json — configured to /pettypes, the one route every
// scenario depends on regardless of flow — until it answers 200, honouring readinessTimeoutMs. It
// only ever waits: restarting the SUT belongs to scripts/sut.mjs, not the delivered framework
// (D-10), so a probe that times out here fails loud instead of reaching for a restart.
public sealed class ReadinessProbe
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(500);

    private readonly ApiClient _client;
    private readonly TestSettings _settings;

    public ReadinessProbe(ApiClient client, TestSettings settings)
    {
        _client = client;
        _settings = settings;
    }

    public async Task WaitUntilReadyAsync()
    {
        var path = _settings.ReadinessPath.TrimStart('/');
        var timeout = TimeSpan.FromMilliseconds(_settings.ReadinessTimeoutMs);
        var stopwatch = Stopwatch.StartNew();
        Exception? lastFailure = null;

        while (stopwatch.Elapsed < timeout)
        {
            try
            {
                var request = _client.NewRequest(Method.Get).WithPath(path).Build();
                var response = await _client.GetAsync<object?>(request);
                if (response.StatusCode == HttpStatusCode.OK)
                {
                    return;
                }
            }
            catch (Exception ex)
            {
                lastFailure = ex;
            }

            await Task.Delay(PollInterval);
        }

        var url = $"{_settings.BaseUrl}/{path}";
        var message = $"SUT at {url} was not ready within {_settings.ReadinessTimeoutMs} ms.";
        if (lastFailure is not null)
        {
            message += $" Last failure: {lastFailure.Message}";
        }

        throw new TimeoutException(message);
    }
}
