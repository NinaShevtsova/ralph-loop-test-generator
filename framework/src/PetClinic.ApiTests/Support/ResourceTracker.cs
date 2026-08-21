using System.Net;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Services;

namespace PetClinic.ApiTests.Support;

// Registry of every id a scenario created, drained in the one order the SUT tolerates:
// visits → pets → owners → pettypes (§10.6, §11 — an owner with two pets of the same type 404s,
// deleting nothing, unless its pets are already gone). A cascade elsewhere in the same delete
// (§11: deleting an owner's last pet also drops that pet's type; deleting a type in use drops
// every pet of it) can make a later id in this list already gone, which is exactly the 404 this
// class swallows.
public sealed class ResourceTracker
{
    private readonly List<int> _visitIds = new();
    private readonly List<int> _petIds = new();
    private readonly List<int> _ownerIds = new();
    private readonly List<int> _petTypeIds = new();

    private readonly VisitsService _visits;
    private readonly PetsService _pets;
    private readonly OwnersService _owners;
    private readonly PetTypesService _petTypes;

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

    public async Task Drain()
    {
        await DeleteAll(_visitIds, _visits.Delete);
        await DeleteAll(_petIds, _pets.Delete);
        await DeleteAll(_ownerIds, _owners.Delete);
        await DeleteAll(_petTypeIds, _petTypes.Delete);
    }

    // Only a 404 is swallowed — the record is already gone, which is not a teardown failure. Any
    // other status is surfaced through EnsureStatus rather than caught, so a teardown that is
    // genuinely broken still throws instead of failing silently. Draining clears every list it
    // touches, so calling Drain() again has nothing left to delete and cannot throw.
    private static async Task DeleteAll(List<int> ids, Func<int, Task<ApiResponse<object?>>> delete)
    {
        foreach (var id in ids)
        {
            var response = await delete(id);
            if (response.StatusCode != HttpStatusCode.NotFound)
            {
                response.EnsureStatus(HttpStatusCode.NoContent);
            }
        }

        ids.Clear();
    }
}
