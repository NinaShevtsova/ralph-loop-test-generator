using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// Base values for a pet type test case (design §4.3): used only by the ACs that create their own
// type (§10.9) — the rest take an existing type from the pet types directory.
public sealed class PetTypeCase
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;
}
