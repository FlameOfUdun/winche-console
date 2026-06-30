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
    public async Task Index_opts_module_bootstrap_out_of_rocket_loader()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();

        var resp = await client.GetAsync("/_console");
        var html = await resp.Content.ReadAsStringAsync();
        // Cloudflare Rocket Loader rewrites type="module" and breaks the SPA; the bootstrap script tag
        // must carry the data-cfasync="false" opt-out so module loading survives behind Cloudflare.
        Assert.Matches("<script(?=[^>]*data-cfasync=\"false\")(?=[^>]*type=\"module\")[^>]*>", html);
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
