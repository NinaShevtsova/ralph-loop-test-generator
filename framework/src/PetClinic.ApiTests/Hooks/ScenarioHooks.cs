using Reqnroll;
using Reqnroll.BoDi;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;

namespace PetClinic.ApiTests.Hooks;

[Binding]
public sealed class ScenarioHooks
{
    private readonly IObjectContainer _container;

    public ScenarioHooks(IObjectContainer container)
    {
        _container = container;
    }

    [BeforeTestRun]
    public static Task BeforeTestRun() => ReadinessProbe.WaitUntilReady();

    // Order = 0: every step definition and every other scenario-scoped class (ScenarioState,
    // ResourceTracker) is resolved through this same container and depends on these five
    // instances being registered before anything else runs.
    [BeforeScenario(Order = 0)]
    public void RegisterServices()
    {
        _container.RegisterInstanceAs(ApiClient.Shared);
        _container.RegisterInstanceAs(new OwnersService(ApiClient.Shared));
        _container.RegisterInstanceAs(new PetsService(ApiClient.Shared));
        _container.RegisterInstanceAs(new VisitsService(ApiClient.Shared));
        _container.RegisterInstanceAs(new PetTypesService(ApiClient.Shared));
    }

    // Resolved lazily rather than taken as a constructor parameter: ResourceTracker's own
    // constructor needs the four services above, which only exist in the container once
    // RegisterServices has run.
    [AfterScenario]
    public Task DrainResources() => _container.Resolve<ResourceTracker>().Drain();
}
