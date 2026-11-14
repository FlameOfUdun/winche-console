using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleOverviewTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => fx.ResetAuthAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task The_overview_lists_the_products_the_caller_may_see_and_the_project_is_public_on_the_sign_in_config()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();

        var config = JsonDocument.Parse(await client.GetStringAsync("/_console/api/auth/config")).RootElement;
        Assert.False(string.IsNullOrEmpty(config.GetProperty("project").GetProperty("name").GetString()));   // before sign-in
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/_console/api/overview")).StatusCode);

        await client.LoginAsync();
        var overview = JsonDocument.Parse(await client.GetStringAsync("/_console/api/overview")).RootElement;
        var products = overview.GetProperty("products").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();
        Assert.Contains("database", products);
        Assert.Contains("storage", products);
        Assert.Contains("authentication", products);
        var db = overview.GetProperty("products").EnumerateArray().First(p => p.GetProperty("id").GetString() == "database");
        Assert.True(db.GetProperty("on").GetBoolean());
        Assert.Contains(db.GetProperty("stats").EnumerateArray(), s => s.GetProperty("label").GetString() == "collections");
        Assert.Equal(JsonValueKind.Array, overview.GetProperty("changes").ValueKind);
    }
}
