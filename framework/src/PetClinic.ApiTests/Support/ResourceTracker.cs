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

    /*
     * Every list is drained even when one of them fails, and the failures are reported together.
     *
     * The order still matters -- visits before pets before owners before pet types, because the API
     * refuses to delete a parent that still has children. What changed is what happens when a delete
     * answers something other than 204 or 404. It used to throw straight out of the first `DeleteAll`,
     * so the three later lists were never touched AND the first list was never cleared: `ids.Clear()`
     * sat after the loop. One 500 on a visit left an owner, a pet and a pet type in the database, and
     * the next scenario saw another scenario's data.
     *
     * The comment that used to sit below claimed "Draining clears every list it touches, so calling
     * Drain() again has nothing left to delete and cannot throw". That held on the happy path only,
     * which is the one path where it does not matter.
     */
    public async Task Drain()
    {
        var failures = new List<Exception>();

        foreach (var (ids, delete) in new (List<int>, Func<int, Task<ApiResponse<object?>>>)[]
                 {
                     (_visitIds, _visits.Delete),
                     (_petIds, _pets.Delete),
                     (_ownerIds, _owners.Delete),
                     (_petTypeIds, _petTypes.Delete),
                 })
        {
            try
            {
                await DeleteAll(ids, delete);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
        }

        if (failures.Count == 1) throw failures[0];
        if (failures.Count > 1)
        {
            throw new AggregateException(
                $"{failures.Count} of the four teardown passes failed; every pass still ran.", failures);
        }
    }

    /*
     * 204 or 404 -- the record went, or it was already gone, and neither is a teardown failure. Any
     * other status still throws, so a genuinely broken teardown is never silent.
     *
     * `ids.Clear()` is in a `finally`, and that is the load-bearing half: it used to sit after the
     * loop, so a throw halfway through left the ids behind and a second `Drain()` would retry deletes
     * that had already succeeded. The two ideas are one fix -- drain everything, then report.
     *
     * The `if (StatusCode != NotFound) EnsureStatus(NoContent)` this replaces expressed "204 or 404"
     * as a branch. `EnsureStatus` takes `params` now, so the pair is stated once and there is no
     * branch left to get wrong.
     */
    private static async Task DeleteAll(List<int> ids, Func<int, Task<ApiResponse<object?>>> delete)
    {
        try
        {
            foreach (var id in ids)
            {
                (await delete(id)).EnsureStatus(HttpStatusCode.NoContent, HttpStatusCode.NotFound);
            }
        }
        finally
        {
            ids.Clear();
        }
    }
}
