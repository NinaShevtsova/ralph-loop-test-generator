using System.Net;
using FluentAssertions;
using NUnit.Framework;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;

namespace PetClinic.ApiTests.Tests.Smoke;

// Design §5.3: the framework's own regression net. Plain NUnit, no Reqnroll/Gherkin involved --
// these three carry no AC id and never appear in the traceability. They prove the three mechanisms
// every one of the 20 BDD scenarios will depend on, so a broken mechanism fails here instead of
// surfacing three stages downstream as an unexplained step failure.
[TestFixture]
public sealed class FrameworkSmokeTests
{
    private OwnersService _owners = null!;
    private PetsService _pets = null!;
    private VisitsService _visits = null!;
    private PetTypesService _petTypes = null!;
    private ResourceTracker _tracker = null!;

    [OneTimeSetUp]
    public Task OneTimeSetUp() => ReadinessProbe.WaitUntilReady();

    [SetUp]
    public void SetUp()
    {
        _owners = new OwnersService(ApiClient.Shared);
        _pets = new PetsService(ApiClient.Shared);
        _visits = new VisitsService(ApiClient.Shared);
        _petTypes = new PetTypesService(ApiClient.Shared);
        _tracker = new ResourceTracker(_visits, _pets, _owners, _petTypes);
    }

    [TearDown]
    public Task TearDown() => _tracker.Drain();

    [Test]
    public async Task Smoke_full_chain_through_services()
    {
        var directory = await _petTypes.GetAll();
        directory.EnsureStatus(HttpStatusCode.OK);
        directory.Body.Should().NotBeNullOrEmpty();
        directory.Body!.Should().OnlyContain(petType => petType.Id.HasValue && !string.IsNullOrWhiteSpace(petType.Name));

        // Own type (§10.9): this test's owner ends up with exactly one pet, and deleting an owner
        // with one pet cascades onto the pet's type (§11) -- a shared, seeded type must never be
        // the target of that cascade.
        var createdType = await _petTypes.Create(new PetType { Name = UniqueData.PetTypeName("SmokeType") });
        createdType.EnsureStatus(HttpStatusCode.Created);
        var typeId = createdType.Body!.Id!.Value;
        _tracker.TrackPetType(typeId);

        var owner = new Owner
        {
            FirstName = "Smoke",
            LastName = UniqueData.LastName("Smoketest"),
            Address = "1 Smoke Street",
            City = "Smoke City",
            Telephone = UniqueData.Telephone(),
        };
        var createdOwner = await _owners.Create(owner);
        createdOwner.EnsureStatus(HttpStatusCode.Created);
        var ownerId = createdOwner.Body!.Id!.Value;
        _tracker.TrackOwner(ownerId);

        var pet = new Pet
        {
            Name = UniqueData.PetName("SmokePet"),
            BirthDate = UniqueData.Date(DateTime.UtcNow.AddYears(-2)),
            Type = createdType.Body!,
        };
        var createdPet = await _owners.AddPet(ownerId, pet);
        createdPet.EnsureStatus(HttpStatusCode.Created);
        var petId = createdPet.Body!.Id!.Value;
        _tracker.TrackPet(petId);

        var visit = new Visit
        {
            Date = UniqueData.Date(DateTime.UtcNow),
            Description = UniqueData.VisitDescription("Smoke visit"),
        };
        var createdVisit = await _visits.AddToPet(ownerId, petId, visit);
        createdVisit.EnsureStatus(HttpStatusCode.Created);
        var visitId = createdVisit.Body!.Id!.Value;
        _tracker.TrackVisit(visitId);

        var fetchedOwner = await _owners.Get(ownerId);
        fetchedOwner.EnsureStatus(HttpStatusCode.OK);
        fetchedOwner.Body!.LastName.Should().Be(owner.LastName);

        var fetchedPet = await _pets.Get(petId);
        fetchedPet.EnsureStatus(HttpStatusCode.OK);
        fetchedPet.Body!.Name.Should().Be(pet.Name);
        fetchedPet.Body!.Type.Id.Should().Be(typeId);

        var fetchedVisit = await _visits.Get(visitId);
        fetchedVisit.EnsureStatus(HttpStatusCode.OK);
        fetchedVisit.Body!.Description.Should().Be(visit.Description);
    }

    // §11: an owner with two pets of the same type answers 404 on delete while both pets still
    // exist -- deleting successfully here is only possible if Drain() removes the pets before the
    // owner. Registration order is deliberately scrambled (owner and pet type tracked before either
    // pet) to prove the deletion order is a property of Drain() itself, not of registration order.
    // A synthetic, never-created pet id is tracked alongside the real ones to prove 404 is
    // swallowed specifically for a resource that is genuinely already gone, decoupled from the
    // ordering proof above.
    [Test]
    public async Task Smoke_tracker_cleans_up_in_order()
    {
        var createdType = await _petTypes.Create(new PetType { Name = UniqueData.PetTypeName("OrderType") });
        createdType.EnsureStatus(HttpStatusCode.Created);
        var typeId = createdType.Body!.Id!.Value;

        var createdOwner = await _owners.Create(new Owner
        {
            FirstName = "Order",
            LastName = UniqueData.LastName("Ordertest"),
            Address = "2 Order Street",
            City = "Order City",
            Telephone = UniqueData.Telephone(),
        });
        createdOwner.EnsureStatus(HttpStatusCode.Created);
        var ownerId = createdOwner.Body!.Id!.Value;

        _tracker.TrackOwner(ownerId);
        _tracker.TrackPetType(typeId);

        var sharedType = createdType.Body!;
        var createdPet1 = await _owners.AddPet(ownerId, new Pet
        {
            Name = UniqueData.PetName("OrderPetOne"),
            BirthDate = UniqueData.Date(DateTime.UtcNow.AddYears(-1)),
            Type = sharedType,
        });
        createdPet1.EnsureStatus(HttpStatusCode.Created);
        var pet1Id = createdPet1.Body!.Id!.Value;

        var createdPet2 = await _owners.AddPet(ownerId, new Pet
        {
            Name = UniqueData.PetName("OrderPetTwo"),
            BirthDate = UniqueData.Date(DateTime.UtcNow.AddYears(-1)),
            Type = sharedType,
        });
        createdPet2.EnsureStatus(HttpStatusCode.Created);
        var pet2Id = createdPet2.Body!.Id!.Value;

        var createdVisit = await _visits.AddToPet(ownerId, pet1Id, new Visit
        {
            Date = UniqueData.Date(DateTime.UtcNow),
            Description = UniqueData.VisitDescription("Order visit"),
        });
        createdVisit.EnsureStatus(HttpStatusCode.Created);
        var visitId = createdVisit.Body!.Id!.Value;

        _tracker.TrackVisit(visitId);
        _tracker.TrackPet(pet1Id);
        _tracker.TrackPet(pet2Id);
        _tracker.TrackPet(999_999_999);

        await _tracker.Drain();

        (await _owners.Get(ownerId)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _pets.Get(pet1Id)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _pets.Get(pet2Id)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _visits.Get(visitId)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _petTypes.Get(typeId)).StatusCode.Should().Be(HttpStatusCode.NotFound);

        await _tracker.Drain();
    }

    // Drives the real TestDataProvider lookup (file read, JSON parse, section-by-type resolution)
    // through its Resolve seam -- a plain NUnit test carries no FeatureContext/ScenarioContext to
    // derive the file name and key from, so those are passed in directly instead of being derived by
    // a hand-rolled duplicate of the provider's own directory and section-naming conventions.
    [Test]
    public void Smoke_data_resolves_by_method_name()
    {
        var methodName = TestContext.CurrentContext.Test.Name;
        var dataDirectory = Path.Combine(AppContext.BaseDirectory, "Data");

        var owner = TestDataProvider.Resolve<OwnerCase>(dataDirectory, "FrameworkSmokeTests.json", methodName);

        owner.Should().NotBeNull();
        owner.LastName.Should().Be("Databy");
    }
}
