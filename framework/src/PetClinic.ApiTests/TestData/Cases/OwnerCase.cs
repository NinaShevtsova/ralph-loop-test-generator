using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// §7 request fields for POST/PUT /owners. lastName is a BASE value: UniqueData appends the
// unique, format-safe suffix at the point of use, not here.
public sealed class OwnerCase
{
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
}
