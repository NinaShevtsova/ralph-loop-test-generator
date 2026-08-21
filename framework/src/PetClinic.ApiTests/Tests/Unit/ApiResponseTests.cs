using System.Net;
using FluentAssertions;
using NUnit.Framework;
using PetClinic.ApiTests.Http;

namespace PetClinic.ApiTests.Tests.Unit;

// Proves, by running rather than by inspection, the one property every one of the twenty scenarios
// relies on: EnsureStatus is silent on the expected code and throws with both codes and the
// response body on a mismatch (design §4, rubric item 9). No HTTP, no Docker — [Category("Unit")]
// so the gate can run this before the SUT exists.
[TestFixture]
[Category("Unit")]
public sealed class ApiResponseTests
{
    [Test]
    public void EnsureStatus_does_not_throw_when_the_status_matches()
    {
        var response = new ApiResponse<string>(HttpStatusCode.OK, "pettypes", "pettypes", headers: null);

        var act = () => response.EnsureStatus(HttpStatusCode.OK);

        act.Should().NotThrow();
    }

    [Test]
    public void EnsureStatus_throws_with_both_codes_and_the_response_body_on_a_mismatch()
    {
        const string rawContent = "{\"message\":\"Validation failed\"}";
        var response = new ApiResponse<string>(HttpStatusCode.BadRequest, body: null, rawContent, headers: null);

        response.RawContent.Should().Be(rawContent);

        var act = () => response.EnsureStatus(HttpStatusCode.Created);

        var exception = act.Should().Throw<InvalidOperationException>().Which;
        exception.Message.Should().Contain(((int)HttpStatusCode.Created).ToString());
        exception.Message.Should().Contain(((int)HttpStatusCode.BadRequest).ToString());
        exception.Message.Should().Contain(rawContent);
    }
}
