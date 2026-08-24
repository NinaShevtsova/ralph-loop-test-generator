using System;
using System.Threading.Tasks;
using PetClinic.ApiTests.Config;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using Reqnroll;
using Reqnroll.BoDi;

namespace PetClinic.ApiTests.Hooks;

// Wires Reqnroll's per-scenario container to the framework: readiness before any scenario touches
// the SUT, the four services and the shared ApiClient available to every step, and teardown after
// each scenario through the same ResourceTracker those services fed.
[Binding]
public sealed class ScenarioHooks
{
    // Memoised behind a Lazy<Task>, not run in [BeforeTestRun]: a BeforeTestRun hook becomes an
    // assembly-level SetUpFixture that NUnit runs for every test in the assembly, so it would make
    // even `dotnet test --filter TestCategory=Unit` sit out the readiness budget (measured at 96 s,
    // red with the container stopped). A unit test has no scenario, so [BeforeScenario] never fires
    // for one, while the Lazy still awaits the SUT exactly once for the whole run.
    private static readonly Lazy<Task> Readiness = new(() =>
        new ReadinessProbe(ApiClient.Shared, SettingsLoader.Load()).WaitUntilReadyAsync());

    private readonly IObjectContainer _container;

    public ScenarioHooks(IObjectContainer container)
    {
        _container = container;
    }

    [BeforeScenario(Order = -1)]
    public static Task AwaitReadiness() => Readiness.Value;

    [BeforeScenario(Order = 0)]
    public void RegisterServices()
    {
        var client = ApiClient.Shared;
        _container.RegisterInstanceAs(client);
        _container.RegisterInstanceAs(new OwnersService(client));
        _container.RegisterInstanceAs(new PetsService(client));
        _container.RegisterInstanceAs(new VisitsService(client));
        _container.RegisterInstanceAs(new PetTypesService(client));
    }

    // Resolved lazily, on the same container, rather than taken as a constructor parameter: this
    // instance's constructor already runs before RegisterServices (to serve AwaitReadiness at
    // Order = -1), and ScenarioState's dependency chain only becomes resolvable once that
    // registration has happened.
    [AfterScenario]
    public async Task Cleanup()
    {
        var state = _container.Resolve<ScenarioState>();
        await state.Tracker.Drain();
    }
}
