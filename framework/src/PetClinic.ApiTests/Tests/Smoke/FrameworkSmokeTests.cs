using System.Net;
using FluentAssertions;
using NUnit.Framework;
using PetClinic.ApiTests.Config;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;

namespace PetClinic.ApiTests.Tests.Smoke;

// The framework's own regression net (design §5.3) — not an AC test, carries no AC id and never
// appears in the traceability. One test per mechanism every one of the 20 scenarios depends on,
// so a break in any of them is caught here rather than as an unexplained red in stage 1.
//
// Plain NUnit, not a Reqnroll binding: no [BeforeScenario] ever fires for a fixture like this
// one, so readiness is awaited once here via [OneTimeSetUp] — the one place in the assembly this
// is legal. scripts/invariants.mjs's I7 forbids the assembly-wide [BeforeTestRun]/[SetUpFixture]
// form precisely because it would make even a `--filter TestCategory=Unit` run wait on the SUT.
[TestFixture]
public sealed class FrameworkSmokeTests
{
    private OwnersService _owners = null!;
    private PetsService _pets = null!;
    private VisitsService _visits = null!;
    private PetTypesService _petTypes = null!;

    [OneTimeSetUp]
    public async Task AwaitReadiness()
    {
        var client = ApiClient.Shared;
        _owners = new OwnersService(client);
        _pets = new PetsService(client);
        _visits = new VisitsService(client);
        _petTypes = new PetTypesService(client);

        await new ReadinessProbe(client, SettingsLoader.Load()).WaitUntilReadyAsync();
    }

    // Mechanism: ApiClient + all four services + models, chained exactly as design §5.3 asks —
    // GET /pettypes -> POST /owners -> POST .../pets -> POST .../visits -> read every entity back.
    [Test]
    public async Task Smoke_full_chain_through_services()
    {
        var tracker = new ResourceTracker(_visits, _pets, _owners, _petTypes);
        try
        {
            var petType = (await _petTypes.GetAll()).EnsureStatus(HttpStatusCode.OK).Body?.FirstOrDefault()
                ?? throw new InvalidOperationException("GET /pettypes returned no pet type to build the chain on.");

            var owner = new Owner
            {
                FirstName = "Smoke",
                LastName = UniqueData.LastName("Chaintest"),
                Address = "1 Smoke Test Street",
                City = "Lviv",
                Telephone = UniqueData.Telephone(),
            };
            var createdOwner = (await _owners.Create(owner)).EnsureStatus(HttpStatusCode.Created).Body
                ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
            var ownerId = createdOwner.Id ?? throw new InvalidOperationException("Created owner carries no id.");
            tracker.TrackOwner(ownerId);

            var pet = new Pet
            {
                Name = UniqueData.PetName("Rex"),
                BirthDate = UniqueData.Date(new DateTime(2020, 5, 14)),
                Type = new PetType { Id = petType.Id, Name = petType.Name },
            };
            var createdPet = (await _owners.AddPet(ownerId, pet)).EnsureStatus(HttpStatusCode.Created).Body
                ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
            var petId = createdPet.Id ?? throw new InvalidOperationException("Created pet carries no id.");
            tracker.TrackPet(petId);

            var visit = new Visit
            {
                Description = UniqueData.VisitDescription("Checkup"),
                Date = UniqueData.Date(DateTime.UtcNow),
            };
            var createdVisit = (await _visits.AddVisit(ownerId, petId, visit)).EnsureStatus(HttpStatusCode.Created).Body
                ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets/{petId}/visits answered 201 with no body.");
            var visitId = createdVisit.Id ?? throw new InvalidOperationException("Created visit carries no id.");
            tracker.TrackVisit(visitId);

            var fetchedOwner = (await _owners.GetById(ownerId)).EnsureStatus(HttpStatusCode.OK).Body
                ?? throw new InvalidOperationException("GET /owners/{ownerId} answered 200 with no body.");
            var fetchedPet = (await _pets.GetById(petId)).EnsureStatus(HttpStatusCode.OK).Body
                ?? throw new InvalidOperationException("GET /pets/{petId} answered 200 with no body.");
            var fetchedVisit = (await _visits.GetById(visitId)).EnsureStatus(HttpStatusCode.OK).Body
                ?? throw new InvalidOperationException("GET /visits/{visitId} answered 200 with no body.");

            fetchedOwner.LastName.Should().Be(owner.LastName, "reading the owner back must return the one this chain just created, not a seeded one");
            fetchedPet.Name.Should().Be(pet.Name, "reading the pet back must return the one this chain just created");
            fetchedPet.OwnerId.Should().Be(ownerId, "the pet read back must still link to the owner that created it");
            fetchedVisit.Description.Should().Be(visit.Description, "reading the visit back must return the one this chain just recorded");
            fetchedVisit.PetId.Should().Be(petId, "the visit read back must still link to the pet it was recorded for");
        }
        finally
        {
            await tracker.Drain();
        }
    }

    // Mechanism: ResourceTracker.Drain() — the mandatory order visits -> pets -> owners -> pettypes,
    // 404 swallowed specifically, a second drain safe. Two pets of the SAME type is the one case
    // §11 documents as order-dependent: deleting the owner before its pets answers 404 and removes
    // nothing, and a tracker that swallowed that 404 too would leave the owner behind while looking
    // green. Draining in the mandatory order avoids that 404 in the first place.
    [Test]
    public async Task Smoke_tracker_cleans_up_in_order()
    {
        var petType = (await _petTypes.Create(new PetType { Name = UniqueData.PetTypeName("SmokeOrderType") }))
            .EnsureStatus(HttpStatusCode.Created).Body
            ?? throw new InvalidOperationException("POST /pettypes answered 201 with no body.");
        var petTypeId = petType.Id ?? throw new InvalidOperationException("Created pet type carries no id.");

        var owner = (await _owners.Create(new Owner
        {
            FirstName = "Smoke",
            LastName = UniqueData.LastName("Ordertest"),
            Address = "1 Smoke Test Street",
            City = "Lviv",
            Telephone = UniqueData.Telephone(),
        })).EnsureStatus(HttpStatusCode.Created).Body
            ?? throw new InvalidOperationException("POST /owners answered 201 with no body.");
        var ownerId = owner.Id ?? throw new InvalidOperationException("Created owner carries no id.");

        var petTypeRef = new PetType { Id = petTypeId, Name = petType.Name };
        var petA = (await _owners.AddPet(ownerId, new Pet { Name = UniqueData.PetName("Alpha"), BirthDate = UniqueData.Date(new DateTime(2019, 1, 1)), Type = petTypeRef }))
            .EnsureStatus(HttpStatusCode.Created).Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var petAId = petA.Id ?? throw new InvalidOperationException("Created pet carries no id.");

        var petB = (await _owners.AddPet(ownerId, new Pet { Name = UniqueData.PetName("Beta"), BirthDate = UniqueData.Date(new DateTime(2019, 1, 1)), Type = petTypeRef }))
            .EnsureStatus(HttpStatusCode.Created).Body
            ?? throw new InvalidOperationException("POST /owners/{ownerId}/pets answered 201 with no body.");
        var petBId = petB.Id ?? throw new InvalidOperationException("Created pet carries no id.");

        var visit = (await _visits.AddVisit(ownerId, petAId, new Visit { Description = UniqueData.VisitDescription("Order check"), Date = UniqueData.Date(DateTime.UtcNow) }))
            .EnsureStatus(HttpStatusCode.Created).Body
            ?? throw new InvalidOperationException("POST .../visits answered 201 with no body.");
        var visitId = visit.Id ?? throw new InvalidOperationException("Created visit carries no id.");

        var tracker = new ResourceTracker(_visits, _pets, _owners, _petTypes);
        tracker.TrackVisit(visitId);
        tracker.TrackPet(petAId);
        tracker.TrackPet(petBId);
        tracker.TrackOwner(ownerId);
        tracker.TrackPetType(petTypeId);

        // A record removed by something other than the tracker, tracked anyway: Drain() must
        // swallow the 404 this produces without letting it stop the rest of the drain.
        (await _visits.Delete(visitId)).EnsureStatus(HttpStatusCode.NoContent);

        var firstDrain = async () => await tracker.Drain();
        await firstDrain.Should().NotThrowAsync("a 404 on an already-removed record must be swallowed, not propagated");

        (await _owners.GetById(ownerId)).StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the owner had two pets of the same type — deleting it before its pets would 404 and remove nothing (§11); the mandatory order avoids that");
        (await _pets.GetById(petAId)).StatusCode.Should().Be(HttpStatusCode.NotFound, "the first pet must be gone after the drain");
        (await _pets.GetById(petBId)).StatusCode.Should().Be(HttpStatusCode.NotFound, "the second pet must be gone after the drain");
        (await _petTypes.GetById(petTypeId)).StatusCode.Should().Be(HttpStatusCode.NotFound, "the pet type must be gone once every pet of it is");

        var secondDrain = async () => await tracker.Drain();
        await secondDrain.Should().NotThrowAsync("draining an already-empty tracker must be a no-op, not a failure");
    }

    // Mechanism: TestDataProvider resolving its JSON block by the running test's own method name,
    // out of Data/FrameworkSmokeTests.json. Calls TestDataProvider.LoadCase — the same internal
    // seam For<T>() itself delegates to — rather than a from-scratch reimplementation, so this test
    // and every scenario's For<T>() call share one lookup/deserialisation path that cannot diverge.
    // A plain NUnit fixture has neither a ScenarioContext nor a FeatureContext to build a
    // TestDataProvider instance from (D-15), which is why the seam is a static entry point keyed by
    // file path + block key rather than the instance method itself.
    [Test]
    public void Smoke_data_resolves_by_method_name()
    {
        var owner = LoadCase<OwnerCase>();

        owner.FirstName.Should().Be("Smoke");
        owner.LastName.Should().Be("Databee");
        owner.City.Should().Be("Kyiv");
        owner.Telephone.Should().Be("0671234567");
    }

    private static T LoadCase<T>([System.Runtime.CompilerServices.CallerMemberName] string methodName = "")
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Data", "FrameworkSmokeTests.json");
        return TestDataProvider.LoadCase<T>(path, methodName);
    }
}
