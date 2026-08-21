using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// Base values for a pet test case (design §4.3): UniqueData appends the letters-only suffix to
// name at runtime; the type is resolved separately from the pet types directory, not from here.
public sealed class PetCase
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("birthDate")]
    public string BirthDate { get; set; } = string.Empty;
}
