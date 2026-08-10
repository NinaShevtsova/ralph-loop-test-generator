using System.Net;

namespace PetClinic.ApiTests.Http;

public class ApiResponse
{
    public HttpStatusCode StatusCode { get; }
    public string? RawContent { get; }
    public IReadOnlyDictionary<string, string> Headers { get; }

    public ApiResponse(HttpStatusCode statusCode, string? rawContent, IReadOnlyDictionary<string, string> headers)
    {
        StatusCode = statusCode;
        RawContent = rawContent;
        Headers = headers;
    }

    public void EnsureStatus(HttpStatusCode expected)
    {
        if (StatusCode != expected)
        {
            throw new InvalidOperationException(
                $"Expected status {(int)expected} ({expected}) but received {(int)StatusCode} ({StatusCode}). " +
                $"Response body: {RawContent}");
        }
    }
}

public sealed class ApiResponse<T> : ApiResponse
{
    public T? Body { get; }

    public ApiResponse(HttpStatusCode statusCode, T? body, string? rawContent, IReadOnlyDictionary<string, string> headers)
        : base(statusCode, rawContent, headers)
    {
        Body = body;
    }
}
