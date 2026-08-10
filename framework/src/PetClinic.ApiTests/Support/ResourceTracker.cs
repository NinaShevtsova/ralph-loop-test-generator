using System.Net;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Services;

namespace PetClinic.ApiTests.Support;

public sealed class ResourceTracker
{
    private readonly VisitsService _visits;
    private readonly PetsService _pets;
    private readonly OwnersService _owners;
    private readonly PetTypesService _petTypes;

    private readonly List<int> _visitIds = new();
    private readonly List<int> _petIds = new();
    private readonly List<int> _ownerIds = new();
    private readonly List<int> _petTypeIds = new();

    public ResourceTracker(VisitsService visits, PetsService pets, OwnersService owners, PetTypesService petTypes)
    {
        _visits = visits;
        _pets = pets;
        _owners = owners;
        _petTypes = petTypes;
    }

    public void TrackVisit(int visitId) => _visitIds.Add(visitId);

    public void TrackPet(int petId) => _petIds.Add(petId);

    public void TrackOwner(int ownerId) => _ownerIds.Add(ownerId);

    public void TrackPetType(int petTypeId) => _petTypeIds.Add(petTypeId);

    // §10.6/§11: an owner with two pets of the same type answers 404 on delete and removes nothing,
    // so the order below is mandatory, not stylistic.
    public async Task Drain()
    {
        await DrainGroup(_visitIds, _visits.Delete);
        await DrainGroup(_petIds, _pets.Delete);
        await DrainGroup(_ownerIds, _owners.Delete);
        await DrainGroup(_petTypeIds, _petTypes.Delete);
    }

    // Removes an id once its delete is confirmed gone (204 or already-404). Any other status is left
    // in place for the next Drain() to retry, and is not swallowed — it is surfaced via EnsureStatus.
    private static async Task DrainGroup(List<int> ids, Func<int, Task<ApiResponse>> delete)
    {
        foreach (var id in ids.ToArray())
        {
            var response = await delete(id);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                ids.Remove(id);
                continue;
            }

            response.EnsureStatus(HttpStatusCode.NoContent);
            ids.Remove(id);
        }
    }
}
