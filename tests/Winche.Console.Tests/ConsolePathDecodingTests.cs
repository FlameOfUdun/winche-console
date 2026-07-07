using System.Net;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsolePathDecodingTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Malformed_base64_document_path_returns_400()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        // "!!!!" is not valid base64.
        var resp = await client.GetAsync("/_console/api/database/documents/!!!!");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Malformed_base64_file_path_returns_400()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var resp = await client.GetAsync("/_console/api/storage/files/!!!!");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
