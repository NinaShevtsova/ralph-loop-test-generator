using System.Text.Json;
using Reqnroll;

namespace PetClinic.ApiTests.TestData;

// Resolves one scenario's data block: the data FILE from the feature's flow tag (@F01/@F02/@F03),
// the block inside it from the scenario's @AC-Fxx-yy tag (D-15 — Reqnroll's generated test-method
// names are mangled, so the tag is the only stable key), and the case object inside that block
// from the requested T. Resolved through Reqnroll's DI: ScenarioContext and FeatureContext are
// already registered per scenario/feature, so no explicit registration is needed for this class.
public sealed class TestDataProvider
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly ScenarioContext _scenarioContext;
    private readonly FeatureContext _featureContext;

    public TestDataProvider(ScenarioContext scenarioContext, FeatureContext featureContext)
    {
        _scenarioContext = scenarioContext;
        _featureContext = featureContext;
    }

    // Data files are copied next to the test assembly (csproj: Data/**/*.json, PreserveNewest).
    private static string DataDirectory => Path.Combine(AppContext.BaseDirectory, "Data");

    public T For<T>()
    {
        var acTag = ResolveAcTag();
        var filePath = ResolveDataFile();
        return LoadCase<T>(filePath, acTag);
    }

    // Internal seam: the exact JSON lookup and deserialisation For<T>() uses, taking a raw file path
    // and block key instead of pulling them from ScenarioContext/FeatureContext. This is what lets
    // FrameworkSmokeTests's Smoke_data_resolves_by_method_name prove the provider's own resolution
    // mechanism from a plain NUnit fixture, which has neither context to construct a TestDataProvider
    // from (D-15) — the two callers share this one method, so they cannot silently diverge.
    internal static T LoadCase<T>(string filePath, string blockKey)
    {
        using var stream = File.OpenRead(filePath);
        using var document = JsonDocument.Parse(stream);

        if (!document.RootElement.TryGetProperty(blockKey, out var block))
        {
            throw new InvalidOperationException($"'{filePath}' has no block for key '{blockKey}'.");
        }

        var propertyName = CasePropertyName(typeof(T));
        if (!block.TryGetProperty(propertyName, out var element))
        {
            var known = string.Join(", ", EnumeratePropertyNames(block));
            throw new InvalidOperationException(
                $"Block '{blockKey}' in '{filePath}' has no '{propertyName}' entry needed to build a {typeof(T).Name}. " +
                $"Entries present: {(known.Length == 0 ? "(none)" : known)}.");
        }

        return element.Deserialize<T>(JsonOptions)
            ?? throw new InvalidOperationException(
                $"Block '{blockKey}' entry '{propertyName}' in '{filePath}' deserialised to null for {typeof(T).Name}.");
    }

    // OwnerCase -> "owner", PetTypeCase -> "petType": strips the "Case" suffix and lower-cases the
    // first letter, so a data file's JSON keys ("owner", "pet", ...) need no separate lookup table.
    private static string CasePropertyName(Type caseType)
    {
        const string suffix = "Case";
        var name = caseType.Name.EndsWith(suffix, StringComparison.Ordinal)
            ? caseType.Name[..^suffix.Length]
            : caseType.Name;
        return char.ToLowerInvariant(name[0]) + name[1..];
    }

    private string ResolveAcTag()
    {
        var acTag = _scenarioContext.ScenarioInfo.Tags.FirstOrDefault(tag => tag.StartsWith("AC-", StringComparison.Ordinal));
        if (acTag is null)
        {
            var tags = string.Join(", ", _scenarioContext.ScenarioInfo.Tags);
            throw new InvalidOperationException(
                $"Scenario '{_scenarioContext.ScenarioInfo.Title}' carries no '@AC-Fxx-yy' tag. " +
                $"Tags present: {(tags.Length == 0 ? "(none)" : tags)}.");
        }

        return acTag;
    }

    // Found by the flow tag, not looked up in a hard-coded map: a feature tagged @F01 reads the
    // one file in Data/ whose name starts with "F01". A closed map would mean a flow added after
    // this stage cannot be given data at all, because TestData/ is outside the stage-1 fence.
    private string ResolveDataFile()
    {
        var flowTag = _featureContext.FeatureInfo.Tags.FirstOrDefault(IsFlowTag);
        if (flowTag is null)
        {
            var tags = string.Join(", ", _featureContext.FeatureInfo.Tags);
            throw new InvalidOperationException(
                $"Feature '{_featureContext.FeatureInfo.Title}' carries no flow tag (e.g. '@F01'). " +
                $"Tags present: {(tags.Length == 0 ? "(none)" : tags)}.");
        }

        var matches = Directory.EnumerateFiles(DataDirectory, $"{flowTag}*.json").ToArray();
        if (matches.Length != 1)
        {
            throw new InvalidOperationException(
                $"Expected exactly one data file starting with '{flowTag}' in '{DataDirectory}', found {matches.Length}.");
        }

        return matches[0];
    }

    private static bool IsFlowTag(string tag) => tag.Length >= 3 && tag[0] == 'F' && char.IsDigit(tag[1]);

    private static IEnumerable<string> EnumeratePropertyNames(JsonElement block)
    {
        foreach (var property in block.EnumerateObject())
        {
            yield return property.Name;
        }
    }
}
