using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// §7 request fields for POST /owners/{ownerId}/pets, minus `type`: the type is resolved at
// runtime from GET /pettypes or a scenario's own POST /pettypes (§10.9), never carried as a
// literal in the data file. name is a BASE value; UniqueData appends the unique suffix.
public sealed class PetCase
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("birthDate")]
    public string BirthDate { get; set; } = string.Empty;
}
