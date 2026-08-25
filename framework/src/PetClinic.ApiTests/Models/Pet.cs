using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.Models;

public sealed class Pet
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

    // Nullable and omitted-when-null rather than defaulting to `new()`: §7 lists `visits` as a
    // read-only response field, so a request body must be able to leave it out entirely. A non-null
    // empty list would still serialise as `"visits": []` on every PUT (AC-F02-05 forbids exactly that
    // shape), whereas a GET response populates this normally on deserialisation either way.
    [JsonPropertyName("visits")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<Visit>? Visits { get; set; }
}
