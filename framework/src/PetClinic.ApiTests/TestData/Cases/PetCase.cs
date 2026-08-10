using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

public class PetCase
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("birthDate")]
    public string BirthDate { get; set; } = string.Empty;
}
