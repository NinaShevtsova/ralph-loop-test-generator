using PetClinic.ApiTests.Http;

namespace PetClinic.ApiTests.Support;

// The BDD chain "create an owner -> remember ownerId -> use it in the next step" cannot live in a
// local variable, because each step is a separate method. Reqnroll resolves one instance of this
// class per scenario, so it is that memory: every request step's response, every entity the
// scenario created, and the tracker that deletes them again in AfterScenario.
public sealed class ScenarioState
{
    private readonly Dictionary<string, ApiResponse> _responses = new();
    private readonly Dictionary<string, object> _entities = new();

    public ResourceTracker Tracker { get; }

    public ScenarioState(ResourceTracker tracker)
    {
        Tracker = tracker;
    }

    public void SetResponse(string key, ApiResponse response) => _responses[key] = response;

    public ApiResponse GetResponse(string key)
    {
        if (!_responses.TryGetValue(key, out var response))
        {
            throw new KeyNotFoundException(
                $"No response stored under key '{key}'. Did the request step that produces it run first?");
        }

        return response;
    }

    public ApiResponse<T> GetResponse<T>(string key) => (ApiResponse<T>)GetResponse(key);

    public void SetEntity<T>(string key, T entity) where T : notnull => _entities[key] = entity;

    public T GetEntity<T>(string key)
    {
        if (!_entities.TryGetValue(key, out var entity))
        {
            throw new KeyNotFoundException(
                $"No entity stored under key '{key}'. Was it created earlier in the scenario?");
        }

        return (T)entity;
    }
}
