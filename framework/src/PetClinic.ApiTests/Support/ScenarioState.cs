using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;

namespace PetClinic.ApiTests.Support;

// The chain "create an owner -> remember ownerId -> use it in the next step" cannot live in a local
// variable when the steps are different methods. Reqnroll's DI resolves one instance of this class
// per scenario, so it is that shared memory: the entities created so far, the most recent response
// of any of the 22 request steps, and the ResourceTracker that deletes them all in AfterScenario.
public sealed class ScenarioState
{
    public ScenarioState(ResourceTracker tracker)
    {
        Tracker = tracker;
    }

    public ResourceTracker Tracker { get; }

    public Owner? CreatedOwner { get; set; }
    public Pet? CreatedPet { get; set; }
    public PetType? CreatedPetType { get; set; }
    public Visit? CreatedVisit { get; set; }

    // Each of the 22 routes answers with a different body shape (a single entity, a list, or
    // nothing), so the response is kept as `object` here and recovered through LastResponseAs<T>
    // rather than through 22 separately typed properties.
    public object? LastResponse { get; set; }

    public ApiResponse<T> LastResponseAs<T>()
    {
        if (LastResponse is ApiResponse<T> typed)
        {
            return typed;
        }

        throw new InvalidOperationException(
            $"Expected the last response to be ApiResponse<{typeof(T).Name}> but it was " +
            $"{LastResponse?.GetType().FullName ?? "null"}.");
    }
}
