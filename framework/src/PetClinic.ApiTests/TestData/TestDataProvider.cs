using System.Text.Json;
using System.Text.Json.Nodes;
using Reqnroll;

namespace PetClinic.ApiTests.TestData;

// DATA PROVIDER (design §4): resolves the JSON block for a scenario's own data from the file
// matching its flow and the key matching its own @AC-Fxx-yy tag, so one reused step sentence works
// with every scenario's own data and never a hand-written string key (D-15).
public static class TestDataProvider
{
    private const string DataDirectoryName = "Data";
    private const string CaseTypeSuffix = "Case";

    // The path every real request step and the F00 canary use: the tag comes from the running
    // scenario itself, never from a literal the agent could let drift out of sync with the feature.
    public static T For<T>(ScenarioContext scenarioContext) => For<T>(ResolveAcTag(scenarioContext));

    // Seam for the plain-NUnit smoke tests (S14): they run outside Reqnroll and carry no
    // ScenarioContext to derive a tag from, so they pass the AC tag in directly.
    public static T For<T>(string acTag)
    {
        var flowTag = FlowTagFrom(acTag);
        var filePath = ResolveFeatureFile(flowTag);

        var root = JsonNode.Parse(File.ReadAllText(filePath))?.AsObject()
            ?? throw new InvalidOperationException($"'{filePath}' does not contain a JSON object.");

        var block = root[acTag]?.AsObject()
            ?? throw new InvalidOperationException($"'{filePath}' has no data block for tag '{acTag}'.");

        var caseKey = CaseKeyFor<T>();
        var node = block[caseKey]
            ?? throw new InvalidOperationException(
                $"Data block '{acTag}' in '{filePath}' has no '{caseKey}' entry for {typeof(T).Name}.");

        return node.Deserialize<T>()
            ?? throw new InvalidOperationException($"'{acTag}.{caseKey}' in '{filePath}' deserialised to null.");
    }

    // Never a hand-written string key (D-15): Reqnroll's generated test-method names are mangled,
    // so the scenario's own tag is the only identifier stable enough to key data on.
    internal static string ResolveAcTag(ScenarioContext scenarioContext)
    {
        var acTags = scenarioContext.ScenarioInfo.Tags
            .Where(tag => tag.StartsWith("AC-", StringComparison.Ordinal))
            .ToArray();

        if (acTags.Length != 1)
        {
            throw new InvalidOperationException(
                $"Expected exactly one 'AC-' tag on scenario '{scenarioContext.ScenarioInfo.Title}', " +
                $"found {acTags.Length}.");
        }

        return acTags[0];
    }

    // Resolution by the flow segment of the tag over the files actually on disk, not a closed map:
    // TestData/ sits outside the stage-1 fence, so a map entry per flow would make a flow added
    // after this stage ran impossible for stage 1 to give data to.
    internal static string ResolveFeatureFile(string flowTag)
    {
        var dataDirectory = Path.Combine(AppContext.BaseDirectory, DataDirectoryName);
        var matches = Directory.EnumerateFiles(dataDirectory, $"{flowTag}*.json").ToArray();

        if (matches.Length != 1)
        {
            throw new InvalidOperationException(
                $"Expected exactly one data file starting with '{flowTag}' in '{dataDirectory}', " +
                $"found {matches.Length}.");
        }

        return matches[0];
    }

    // "AC-F01-01" -> "F01": the flow segment is what a data file's name has to start with.
    private static string FlowTagFrom(string acTag)
    {
        var parts = acTag.Split('-');
        if (parts.Length < 3)
        {
            throw new InvalidOperationException($"Tag '{acTag}' does not match the 'AC-Fxx-yy' shape.");
        }

        return parts[1];
    }

    // "OwnerCase" -> "owner", "PetTypeCase" -> "petType": the JSON key a case is stored under is
    // derived from the type name, so a fifth Case type needs no lookup table maintained here.
    private static string CaseKeyFor<T>()
    {
        var name = typeof(T).Name;
        var trimmed = name.EndsWith(CaseTypeSuffix, StringComparison.Ordinal)
            ? name[..^CaseTypeSuffix.Length]
            : name;

        return char.ToLowerInvariant(trimmed[0]) + trimmed[1..];
    }
}
