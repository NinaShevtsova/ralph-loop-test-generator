using System.Text.Json;
using Reqnroll;

namespace PetClinic.ApiTests.TestData;

// DATA PROVIDER (D-15): the file is the one named after the scenario's flow (@F01/@F02/@F03 on the
// Feature line), the key is the scenario's own @AC-Fxx-yy tag. Reqnroll's generated test-method names
// are mangled, which is why the tag -- never a hand-written string -- is the stable key. Resolved
// through Reqnroll's DI, one instance per scenario, the same way ScenarioState is.
public sealed class TestDataProvider
{
    private static readonly IReadOnlyDictionary<string, string> FeatureFiles = new Dictionary<string, string>
    {
        ["F01"] = "F01-owner-lifecycle.json",
        ["F02"] = "F02-owner-pet-lifecycle.json",
        ["F03"] = "F03-pet-visit-flow.json",
    };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly FeatureContext _featureContext;
    private readonly ScenarioContext _scenarioContext;
    private readonly string _dataDirectory;

    public TestDataProvider(FeatureContext featureContext, ScenarioContext scenarioContext)
    {
        _featureContext = featureContext;
        _scenarioContext = scenarioContext;
        _dataDirectory = Path.Combine(AppContext.BaseDirectory, "Data");
    }

    // Every case class name ends in "Case" (OwnerCase, PetCase, VisitCase, PetTypeCase); the section
    // of the AC block it reads is that name with the suffix stripped and lower-cased at the head
    // (OwnerCase -> "owner", PetTypeCase -> "petType") -- the same shape the design's own example
    // block uses ("owner", "pet") under one AC key.
    public T For<T>()
    {
        var fileName = ResolveFeatureFile();
        var acTag = ResolveAcTag();
        return Resolve<T>(_dataDirectory, fileName, acTag);
    }

    // Seam for PetClinic.ApiTests.Tests.Smoke.FrameworkSmokeTests: the file+key lookup this method
    // performs is the mechanism the smoke suite proves, but a plain NUnit test carries no
    // FeatureContext/ScenarioContext to derive fileName/key from -- so the smoke test passes them in
    // directly instead of re-implementing the file read, parse and section lookup itself.
    internal static T Resolve<T>(string dataDirectory, string fileName, string key)
    {
        var acBlock = LoadAcBlock(dataDirectory, fileName, key);
        var sectionName = SectionNameFor<T>();

        if (!acBlock.TryGetProperty(sectionName, out var section))
        {
            throw new InvalidOperationException(
                $"AC block '{key}' in '{fileName}' has no '{sectionName}' section for {typeof(T).Name}.");
        }

        return section.Deserialize<T>(JsonOptions) ?? throw new InvalidOperationException(
            $"The '{sectionName}' section of '{key}' in '{fileName}' deserialised to null.");
    }

    private string ResolveFeatureFile()
    {
        var flowTag = _featureContext.FeatureInfo.Tags.FirstOrDefault(tag => FeatureFiles.ContainsKey(tag));
        if (flowTag is null)
        {
            throw new InvalidOperationException(
                $"Feature '{_featureContext.FeatureInfo.Title}' carries no known flow tag " +
                $"({string.Join(", ", FeatureFiles.Keys)}). TestDataProvider cannot resolve its data file.");
        }

        return FeatureFiles[flowTag];
    }

    private string ResolveAcTag()
    {
        var acTag = _scenarioContext.ScenarioInfo.Tags.FirstOrDefault(tag => tag.StartsWith("AC-", StringComparison.Ordinal));
        if (acTag is null)
        {
            throw new InvalidOperationException(
                $"Scenario '{_scenarioContext.ScenarioInfo.Title}' carries no '@AC-' tag. " +
                "TestDataProvider keys every case by that tag, never by a hand-written string.");
        }

        return acTag;
    }

    private static JsonElement LoadAcBlock(string dataDirectory, string fileName, string acTag)
    {
        var path = Path.Combine(dataDirectory, fileName);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Test data file '{fileName}' was not found at '{path}'.", path);
        }

        using var stream = File.OpenRead(path);
        using var document = JsonDocument.Parse(stream);

        if (!document.RootElement.TryGetProperty(acTag, out var acBlock))
        {
            throw new InvalidOperationException($"No JSON block found for '{acTag}' in '{fileName}'.");
        }

        // The owning JsonDocument is disposed at the end of this method; Clone() detaches the
        // element so it survives past that point.
        return acBlock.Clone();
    }

    private static string SectionNameFor<T>()
    {
        const string suffix = "Case";
        var typeName = typeof(T).Name;
        var baseName = typeName.EndsWith(suffix, StringComparison.Ordinal)
            ? typeName[..^suffix.Length]
            : typeName;

        return char.ToLowerInvariant(baseName[0]) + baseName[1..];
    }
}
