using System.Net;
using RestSharp;

namespace PetClinic.ApiTests.Http;

// EnsureStatus is the one place every one of the twenty scenarios routes its response-code checks
// through (design §4.2, rubric item 9): a wrong code fails at the request site with the body in the
// message, instead of surfacing two steps later as a NullReferenceException on a null Body.
public sealed class ApiResponse<T>
{
    public HttpStatusCode StatusCode { get; }
    public T? Body { get; }
    public string? RawContent { get; }
    public IReadOnlyCollection<HeaderParameter> Headers { get; }

    public ApiResponse(HttpStatusCode statusCode, T? body, string? rawContent, IReadOnlyCollection<HeaderParameter>? headers)
    {
        StatusCode = statusCode;
        Body = body;
        RawContent = rawContent;
        Headers = headers ?? Array.Empty<HeaderParameter>();
    }

    public ApiResponse<T> EnsureStatus(HttpStatusCode expected)
    {
        if (StatusCode != expected)
        {
            throw new InvalidOperationException(
                $"Expected HTTP {(int)expected} {expected} but got {(int)StatusCode} {StatusCode}. " +
                $"Response body: {RawContent}");
        }

        return this;
    }
}
