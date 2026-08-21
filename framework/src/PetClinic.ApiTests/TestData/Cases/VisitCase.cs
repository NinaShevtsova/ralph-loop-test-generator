using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// Base values for a visit test case (design §4.3): petId is resolved at runtime from the pet the
// scenario created, not carried in the data file.
public sealed class VisitCase
{
    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;
}
