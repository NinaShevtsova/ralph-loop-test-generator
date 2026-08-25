using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.Models;

public sealed class Owner
{
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Id { get; set; }

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

    // Nullable and omitted-when-null, same reasoning as `Pet.Visits`: §7 lists `pets` as a read-only
    // response field, so a request body (POST /owners, PUT /owners/{ownerId}) must be able to omit it
    // rather than send `"pets": []`.
    [JsonPropertyName("pets")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<Pet>? Pets { get; set; }
}
