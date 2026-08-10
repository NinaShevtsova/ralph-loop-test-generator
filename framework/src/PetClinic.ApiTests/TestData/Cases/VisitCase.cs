using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

public class VisitCase
{
    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;
}
