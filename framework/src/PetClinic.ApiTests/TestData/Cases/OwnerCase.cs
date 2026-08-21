using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// Base values for an owner test case (design §4.3): UniqueData appends the letters-only suffix to
// lastName at runtime, so this carries only what the data file itself supplies.
public sealed class OwnerCase
{
    [JsonPropertyName("firstName")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("lastName")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("address")]
    public string Address { get; set; } = string.Empty;

    [JsonPropertyName("city")]
    public string City { get; set; } = string.Empty;

    [JsonPropertyName("telephone")]
    public string Telephone { get; set; } = string.Empty;
}
