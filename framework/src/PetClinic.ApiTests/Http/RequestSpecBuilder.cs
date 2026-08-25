using RestSharp;

namespace PetClinic.ApiTests.Http;

// Fluent factory over a RestRequest, built from the shared RequestSpec (design §4). Every service
// method builds its request through this instead of constructing RestRequest by hand, so the
// default Accept header is never something a call site can forget.
public sealed class RequestSpecBuilder
{
    private readonly RequestSpec _spec;
    private readonly Method _method;
    private readonly List<(string Name, string Value)> _pathParams = new();
    private readonly List<(string Name, string Value)> _queryParams = new();

    private string _path = string.Empty;
    private object? _body;

    public RequestSpecBuilder(RequestSpec spec, Method method)
    {
        _spec = spec;
        _method = method;
    }

    public RequestSpecBuilder WithPath(string path)
    {
        _path = path;
        return this;
    }

    public RequestSpecBuilder WithPathParam(string name, object value)
    {
        _pathParams.Add((name, value.ToString() ?? string.Empty));
        return this;
    }

    public RequestSpecBuilder WithQuery(string name, object value)
    {
        _queryParams.Add((name, value.ToString() ?? string.Empty));
        return this;
    }

    public RequestSpecBuilder WithBody(object body)
    {
        _body = body;
        return this;
    }

    public RestRequest Build()
    {
        var request = new RestRequest(_path, _method);
        request.AddHeader("Accept", _spec.Accept);

        foreach (var (name, value) in _pathParams)
        {
            request.AddUrlSegment(name, value);
        }

        foreach (var (name, value) in _queryParams)
        {
            request.AddQueryParameter(name, value);
        }

        if (_body is not null)
        {
            request.AddJsonBody(_body, _spec.ContentType);
        }

        return request;
    }
}
