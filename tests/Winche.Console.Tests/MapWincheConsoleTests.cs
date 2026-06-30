using System.Net;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class MapWincheConsoleTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Protected_endpoint_requires_auth_and_works_when_logged_in()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);

        using var anon = app.CreateClient();
        var unauth = await anon.GetAsync("/_console/api/data/collections");
        Assert.Equal(HttpStatusCode.Unauthorized, unauth.StatusCode);

        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var ok = await client.GetAsync("/_console/api/data/collections");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }
}
