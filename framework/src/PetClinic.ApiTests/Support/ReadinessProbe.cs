using System.Net;
using PetClinic.ApiTests.Config;
using PetClinic.ApiTests.Http;

namespace PetClinic.ApiTests.Support;

// D-10: this probe only waits for GET /pettypes to answer 200 — it never restarts the SUT.
// Restarting lives in scripts/sut.mjs, so the delivered framework still runs against a shared
// environment that someone else started.
public static class ReadinessProbe
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(500);

    public static Task WaitUntilReady() => WaitUntilReady(ApiClient.Shared, SettingsLoader.Load());

    public static async Task WaitUntilReady(ApiClient client, TestSettings settings)
    {
        var path = settings.ReadinessPath.TrimStart('/');
        var url = settings.BaseUrl.TrimEnd('/') + "/" + path;
        var deadline = DateTime.UtcNow.AddMilliseconds(settings.ReadinessTimeoutMs);

        while (true)
        {
            if (await IsReady(client, path))
            {
                return;
            }

            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException(
                    $"SUT at {url} did not become ready within {settings.ReadinessTimeoutMs} ms.");
            }

            await Task.Delay(PollInterval);
        }
    }

    // Unlike ResourceTracker's 404-only swallow, every failure here means "not ready yet": before
    // the SUT is listening, the request fails at the transport level rather than with a status code.
    private static async Task<bool> IsReady(ApiClient client, string path)
    {
        try
        {
            var response = await client.Get<object>(path);
            return response.StatusCode == HttpStatusCode.OK;
        }
        catch
        {
            return false;
        }
    }
}
