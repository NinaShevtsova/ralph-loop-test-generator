using System.Net;
using FluentAssertions;
using PetClinic.ApiTests.Http;
using Reqnroll;
using Reqnroll.Bindings;

namespace PetClinic.ApiTests.Support;

/*
 * Which of two things a wrong response code means, decided by the SCENARIO rather than by the code.
 *
 * `EnsureStatus` throws the same InvalidOperationException whichever role it is playing, so a broken
 * precondition and an unmet acceptance criterion looked identical in the report. Rubric item 19 asks
 * for the opposite: an error for "the setup broke", a failure for "the AC does not hold", so the
 * reader can tell them apart without reading the code.
 *
 * The role cannot be chosen at the call site, and that is the whole reason this class exists. Five
 * sentences carry both [Given] and [When] -- "an owner is registered" is the acceptance criterion of
 * AC-F01-01 and the precondition of three other ACs -- so the SAME method body serves both roles.
 * Splitting by call site would mean duplicating those five steps, which is the reuse-by-rewording the
 * step inventory exists to forbid.
 *
 * Reqnroll resolves the role AFTER a step has already been matched to a binding, and an `And`
 * resolves to whatever keyword opened its block. That is the question this class asks.
 *
 * It says NOTHING about matching, and an earlier version of this comment blurred the two at the cost
 * of an attempt on AC-F02-09. Matching still depends on the attribute: a step reached through
 * `Given`/`And` needs a binding carrying [Given], and a When-only step in a Given chain answers
 * "No matching step definition found" -- a matching error, before any role question is reached.
 *
 * Only step definitions get this. `ResourceTracker` drains in [AfterScenario] and the smoke tests are
 * plain NUnit -- neither has a current step, and a teardown failure is infrastructure in every case,
 * so both keep `EnsureStatus` and its unconditional throw.
 */
public sealed class StatusCheck
{
    private readonly ScenarioContext _context;

    public StatusCheck(ScenarioContext context)
    {
        _context = context;
    }

    public ApiResponse<T> Expect<T>(ApiResponse<T> response, params HttpStatusCode[] expected)
    {
        if (expected.Length == 0)
        {
            throw new ArgumentException("Expect needs at least one acceptable code.", nameof(expected));
        }

        // A precondition that did not hold is not a verdict on the AC — nothing was tested yet.
        if (_context.StepContext.StepInfo.StepDefinitionType == StepDefinitionType.Given)
        {
            return response.EnsureStatus(expected);
        }

        var because = $"the contract answers this here. {response.Describe()}";
        if (expected.Length == 1)
        {
            response.StatusCode.Should().Be(expected[0], because);
        }
        else
        {
            response.StatusCode.Should().BeOneOf(expected, because);
        }

        return response;
    }
}
