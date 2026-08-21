using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.Models;

public sealed class Visit
{
    // §11: submitting `id` in the request body causes a 500. Nullable + WhenWritingNull lets a
    // request be built by simply leaving Id unset, instead of it defaulting to 0 and being sent.
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Id { get; set; }

    // Required only when creating through POST /visits; the nested route takes it from the path.
    [JsonPropertyName("petId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PetId { get; set; }

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;
}
