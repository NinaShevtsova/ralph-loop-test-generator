using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.Models;

// §11: the "id" field must be absent from a visit-creation request body — submitting it gives a 500.
// JsonIgnoreCondition.WhenWritingNull lets a Visit be built for creation by simply leaving Id unset.
public class Visit
{
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Id { get; set; }

    [JsonPropertyName("petId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PetId { get; set; }

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;
}
