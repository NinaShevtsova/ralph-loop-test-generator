using System.Text.Json.Serialization;

namespace PetClinic.ApiTests.TestData.Cases;

// §7 request field for POST /pettypes, needed only by the ACs that must create their own type
// (§10.9: deleting an owner or a pet type cascades, so AC-F01-04 and AC-F02-10 use one of these
// instead of an existing directory entry).
public sealed class PetTypeCase
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;
}
