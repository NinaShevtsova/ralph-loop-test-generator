using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

public class PetTypeCase
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;
}
