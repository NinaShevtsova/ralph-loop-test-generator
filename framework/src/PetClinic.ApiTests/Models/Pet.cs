using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.Models;

public class Pet
{
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("birthDate")]
    public string BirthDate { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public PetType Type { get; set; } = new();

    [JsonPropertyName("ownerId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? OwnerId { get; set; }

    [JsonPropertyName("visits")]
    public List<Visit> Visits { get; set; } = new();
}
