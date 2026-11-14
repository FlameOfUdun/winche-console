using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleProjectTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
        await fx.ResetRulesAsync();   // published rules would make the console look "already in use" (carried over)
        await using var conn = new NpgsqlConnection(fx.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("""
            DO $$ BEGIN
              IF to_regclass('winche_settings') IS NOT NULL THEN TRUNCATE winche_settings; END IF;
            END $$;
            """, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<JsonElement> Json(HttpResponseMessage resp)
    {
        var text = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.IsSuccessStatusCode, $"{(int)resp.StatusCode} {text}");
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static bool Started(JsonElement project, string product) =>
        project.GetProperty("products").EnumerateArray().Single(p => p.GetProperty("id").GetString() == product).GetProperty("started").GetBoolean();

    [Fact]
    public async Task Products_are_off_until_the_project_is_created_and_each_is_started()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:ProjectSetup", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var project = await Json(await client.GetAsync("/_console/api/project"));
        Assert.True(project.GetProperty("setup").GetBoolean());
        Assert.False(project.GetProperty("created").GetBoolean());

        // Not started: the public APIs refuse, and /.well-known/winche lists nothing.
        var refused = await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("service-disabled", await refused.Content.ReadAsStringAsync());
        Assert.Equal(0, (await Json(await client.GetAsync("/.well-known/winche"))).GetProperty("services").GetArrayLength());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/project", new { name = "Clinic", id = "Bad Id", products = Array.Empty<string>() })).StatusCode);
        project = await Json(await client.PostAsJsonAsync("/_console/api/project", new { name = "Clinic records", id = "clinic-records", products = new[] { "authentication" } }));
        Assert.True(project.GetProperty("created").GetBoolean());
        Assert.True(Started(project, "authentication"));
        Assert.False(Started(project, "functions"));
        Assert.Equal("Clinic records", (await Json(await client.GetAsync("/_console/api/auth/config"))).GetProperty("project").GetProperty("name").GetString());

        // Authentication runs; functions still refuse until started.
        await Json(await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" }));
        Assert.Contains("service-disabled", await (await client.PostAsJsonAsync("/functions/v1/call/hello", new { data = 1 })).Content.ReadAsStringAsync());
        project = await Json(await client.PostAsync("/_console/api/project/products/functions/start", null));
        Assert.True(Started(project, "functions"));
        Assert.DoesNotContain("service-disabled", await (await client.PostAsJsonAsync("/functions/v1/call/hello", new { data = 1 })).Content.ReadAsStringAsync());

        var wellKnown = await Json(await client.GetAsync("/.well-known/winche"));
        Assert.Equal("clinic-records", wellKnown.GetProperty("projectId").GetString());
        Assert.Equal(["auth", "functions"], wellKnown.GetProperty("services").EnumerateArray().Select(s => s.GetProperty("id").GetString()).Order());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/project", new { name = "Again", id = "again" })).StatusCode);
    }

    [Fact]
    public async Task Other_projects_are_listed_for_the_switcher()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:ProjectSetup", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var links = await Json(await client.GetAsync("/_console/api/project/links"));
        Assert.True(links.GetProperty("editable").GetBoolean());
        Assert.Equal(0, links.GetProperty("links").GetArrayLength());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/project/links", new { name = "Staging", consoleUrl = "ftp://x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/project/links", new { name = " ", consoleUrl = "https://staging.example.com/_console" })).StatusCode);
        links = await Json(await client.PostAsJsonAsync("/_console/api/project/links", new { name = "Staging", consoleUrl = "https://staging.example.com/_console/" }));
        Assert.Equal("https://staging.example.com/_console", links.GetProperty("links")[0].GetProperty("consoleUrl").GetString());
        // The same console twice is refused, with or without the trailing slash.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/project/links", new { name = "Again", consoleUrl = "https://staging.example.com/_console" })).StatusCode);
        await Json(await client.PostAsJsonAsync("/_console/api/project/links", new { name = "Production", consoleUrl = "https://example.com/_console" }));

        links = await Json(await client.DeleteAsync("/_console/api/project/links?url=" + Uri.EscapeDataString("https://staging.example.com/_console")));
        Assert.Equal(["Production"], links.GetProperty("links").EnumerateArray().Select(l => l.GetProperty("name").GetString()));
        Assert.Equal(["Production"], (await Json(await client.GetAsync("/_console/api/project/links"))).GetProperty("links").EnumerateArray().Select(l => l.GetProperty("name").GetString()));
    }

    [Fact]
    public async Task A_console_already_in_use_keeps_every_product_on()
    {
        using (var before = new ConsoleAppFactory(fx))
        {
            using var c = before.CreateClient();
            await c.SetupAdminAsync();   // in use before setup existed
        }
        using var app = new ConsoleAppFactory(fx, ("Sample:ProjectSetup", "true"));
        using var client = app.CreateClient();
        await client.LoginAsync();
        var project = await Json(await client.GetAsync("/_console/api/project"));
        Assert.True(project.GetProperty("created").GetBoolean());
        Assert.All(project.GetProperty("products").EnumerateArray(), p => Assert.True(p.GetProperty("started").GetBoolean()));
    }
}
