using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// §7 request fields for POST .../visits and POST /visits. petId is never a data-file value: it
// comes from the pet the scenario just created, not from a literal in JSON.
public sealed class VisitCase
{
    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;
}
