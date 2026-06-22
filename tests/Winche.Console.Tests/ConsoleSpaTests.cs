using System.Net;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleSpaTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Root_serves_index_with_injected_base_href()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();

        var resp = await client.GetAsync("/_console");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var html = await resp.Content.ReadAsStringAsync();
        Assert.Contains("<base href=\"/_console/\">", html);
        Assert.Contains("id=\"root\"", html);
    }

    [Fact]
    public async Task Unknown_client_route_falls_back_to_index()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();

        var resp = await client.GetAsync("/_console/data/users");   // client-side route
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains("id=\"root\"", await resp.Content.ReadAsStringAsync());
    }
}
