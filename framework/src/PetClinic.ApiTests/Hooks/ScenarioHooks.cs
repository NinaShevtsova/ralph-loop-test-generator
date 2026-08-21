using PetClinic.ApiTests.Config;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using Reqnroll;
using Reqnroll.BoDi;

namespace PetClinic.ApiTests.Hooks;

// Readiness is awaited from [BeforeScenario(Order = -1)], NOT [BeforeTestRun]: Reqnroll turns the
// latter into an assembly-level [SetUpFixture] that NUnit runs for every test run in the assembly,
// filter or no filter, so `dotnet test --filter TestCategory=Unit` would sit out the whole
// readinessTimeoutMs budget with the container stopped. A scenario hook never fires for a plain unit
// test, so this Lazy<Task> is awaited once, by the first of the twenty BDD scenarios that needs it.
[Binding]
public static class ScenarioHooks
{
    private static readonly Lazy<Task> Readiness = new(
        () => new ReadinessProbe(ApiClient.Shared, SettingsLoader.Load()).WaitUntilReadyAsync());

    [BeforeScenario(Order = -1)]
    public static Task EnsureReadyAsync() => Readiness.Value;

    // BoDi auto-constructs any concrete type whose constructor arguments are already resolvable, so
    // ScenarioState -> ResourceTracker -> the four services -> ApiClient all come alive from these
    // five registrations without a registration of their own.
    [BeforeScenario(Order = 0)]
    public static void RegisterServices(IObjectContainer container)
    {
        var client = ApiClient.Shared;
        container.RegisterInstanceAs(client);
        container.RegisterInstanceAs(new OwnersService(client));
        container.RegisterInstanceAs(new PetsService(client));
        container.RegisterInstanceAs(new VisitsService(client));
        container.RegisterInstanceAs(new PetTypesService(client));
    }

    [AfterScenario]
    public static Task DrainAsync(ScenarioState state) => state.Tracker.Drain();
}
