using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Support;

// Scenario-scoped memory, resolved once per scenario through Reqnroll's DI container: the
// response of every request step, the entities a step created, and this scenario's
// ResourceTracker all live here.
//
// ADDRESSED BY KEY, not by recency: a step stores a value under a name, and any later step in
// the same scenario reads it back by that name, however many other steps ran in between. F-02
// and F-03 both chain GET /pettypes -> POST /owners -> POST /owners/{ownerId}/pets: the pet type
// is fetched first and needed third, with the owner registration in between. A holder exposing
// only "the last response" -- or one fixed slot per entity that a later step's write can
// overwrite -- cannot serve that chain, so the store below is a dictionary keyed by name.
public sealed class ScenarioState
{
    private readonly Dictionary<string, object> _values = new();

    public ResourceTracker Tracker { get; }

    public ScenarioState(ResourceTracker tracker)
    {
        Tracker = tracker;
    }

    // Different keys never collide: storing under "PetType" and later under "Owner" leaves
    // "PetType" exactly as it was, however many steps ran in between.
    public void Set<T>(string key, T value) where T : notnull
    {
        _values[key] = value;
    }

    public bool TryGet<T>(string key, out T value)
    {
        if (_values.TryGetValue(key, out var stored) && stored is T typed)
        {
            value = typed;
            return true;
        }

        value = default!;
        return false;
    }

    // Throws naming the missing key and every key that IS present, so a step reading the wrong
    // name -- or reading too early -- fails with something more useful than a
    // NullReferenceException surfacing two steps later.
    public T Get<T>(string key)
    {
        if (TryGet<T>(key, out var value))
        {
            return value;
        }

        var known = _values.Count == 0 ? "(none)" : string.Join(", ", _values.Keys);
        throw new InvalidOperationException(
            $"ScenarioState has no {typeof(T).Name} stored under key '{key}'. Keys present: {known}.");
    }

    // Fixed per-entity convenience ON TOP OF the keyed store above -- not a substitute for it.
    // Each property is just Get/Set under a well-known key, so a step remains free to also store
    // the same or another entity under a second, more specific key without conflict.
    private const string OwnerKey = "Owner";
    private const string PetKey = "Pet";
    private const string PetTypeKey = "PetType";
    private const string VisitKey = "Visit";

    /*
     * The created entity's id, or a named failure -- the second shape of the same guard.
     *
     * `Id` is `int?` on every model, because a POST body is sent without one, so every read of an id
     * needed `?? throw`. Written out, that was 7 copies of "Owner has no id.", 7 of "Pet has no id.",
     * 8 of "Created pet carries no id." and so on -- four entities, four wordings each, all saying the
     * one thing this property now says once.
     */
    public int CreatedOwnerId => IdOf(CreatedOwner.Id, "owner");

    public int CreatedPetId => IdOf(CreatedPet.Id, "pet");

    public int CreatedVisitId => IdOf(CreatedVisit.Id, "visit");

    public int CreatedPetTypeId => IdOf(CreatedPetType.Id, "pet type");

    private static int IdOf(int? id, string what) =>
        id ?? throw new InvalidOperationException(
            $"The created {what} carries no id. The API answered 201 without one, or the body did not deserialise.");

    /*
     * The stored response's body, or a named failure -- the one place that guard lives.
     *
     * It was written out at 63 call sites, the same three lines each time, with the message repeated
     * verbatim up to 13 times ("POST /owners/{ownerId}/pets answered 201 with no body."). Every one of
     * them said the same thing in a different string, so changing what a missing body reports meant
     * 63 edits and the wording had already drifted apart.
     *
     * The message names the KEY rather than the route, and that is not a loss: `EnsureStatus` and
     * `StatusCheck.Expect` already put the verb and the URL into the failure that precedes this one,
     * so a body that is missing after a green status is a deserialisation problem, and the key is
     * what identifies it.
     */
    public T Body<T>(string key) where T : class =>
        Get<ApiResponse<T>>(key).Body
        ?? throw new InvalidOperationException(
            $"'{key}' was stored with a body the tests need, and it is null. " +
            "The status was already checked, so this is a deserialisation problem, not a wrong code.");

    public Owner CreatedOwner
    {
        get => Get<Owner>(OwnerKey);
        set => Set(OwnerKey, value);
    }

    public Pet CreatedPet
    {
        get => Get<Pet>(PetKey);
        set => Set(PetKey, value);
    }

    public PetType CreatedPetType
    {
        get => Get<PetType>(PetTypeKey);
        set => Set(PetTypeKey, value);
    }

    public Visit CreatedVisit
    {
        get => Get<Visit>(VisitKey);
        set => Set(VisitKey, value);
    }
}
