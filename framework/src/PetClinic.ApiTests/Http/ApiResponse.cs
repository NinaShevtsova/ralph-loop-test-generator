using System.Net;
using RestSharp;

namespace PetClinic.ApiTests.Http;

// EnsureStatus is the one place every one of the twenty scenarios routes its response-code checks
// through: a wrong code fails at the request site with the body in the message, instead of
// surfacing two steps later as a NullReferenceException on a null Body.
// What was asked for, kept beside what came back. NULLABLE, because a response built by hand in a
// unit test genuinely has no request behind it and must not have to invent one.
public sealed record RequestContext(Method Method, string Resource);

public sealed class ApiResponse<T>
{
    public HttpStatusCode StatusCode { get; }
    public T? Body { get; }
    public string? RawContent { get; }
    public IReadOnlyCollection<HeaderParameter> Headers { get; }
    public RequestContext? Request { get; }

    public ApiResponse(
        HttpStatusCode statusCode,
        T? body,
        string? rawContent,
        IReadOnlyCollection<HeaderParameter>? headers,
        RequestContext? request = null)
    {
        StatusCode = statusCode;
        Body = body;
        RawContent = rawContent;
        Headers = headers ?? Array.Empty<HeaderParameter>();
        Request = request;
    }

    /*
     * The one line a failure is read from, and the reason this class carries the request at all.
     *
     * Before it, every failure in the suite read `Expected HTTP 204 NoContent but got 404 NotFound.
     * Response body:` -- no verb, no URL, no id. On the commonest failure class of all, a 404, the
     * body is empty by section 7, so the message carried NOTHING an operator could act on. The verb
     * and the resolved URL were both on the RestSharp response and were discarded one line before
     * this object was built.
     */
    public string Describe() =>
        $"{(Request is null ? "(request not recorded)" : $"{Request.Method.ToString().ToUpperInvariant()} {Request.Resource}")} " +
        $"→ {(int)StatusCode} {StatusCode}. Body: {(string.IsNullOrWhiteSpace(RawContent) ? "(empty)" : RawContent)}";

    /*
     * The GUARD role: "this code has to hold or nothing after it means anything".
     *
     * `params`, because more than one code can be correct for one call and the alternative is a
     * hand-written `if`. `ResourceTracker` already had exactly that -- `if (StatusCode != NotFound)
     * EnsureStatus(NoContent)` -- and the branch is where a teardown defect lived.
     */
    public ApiResponse<T> EnsureStatus(params HttpStatusCode[] expected)
    {
        if (expected.Length == 0)
        {
            throw new ArgumentException("EnsureStatus needs at least one acceptable code.", nameof(expected));
        }

        if (!expected.Contains(StatusCode))
        {
            var wanted = string.Join(" or ", expected.Select(code => $"{(int)code} {code}"));
            throw new InvalidOperationException($"Expected HTTP {wanted}. Got {Describe()}");
        }

        return this;
    }
}
