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
              IF to_regclass('winche_console_app_usage') IS NOT NULL THEN TRUNCATE winche_console_app_usage; END IF;
              IF to_regclass('winche_console_project_image') IS NOT NULL THEN TRUNCATE winche_console_project_image; END IF;
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
    public async Task Apps_are_registered_named_in_their_options_counted_and_others_can_be_refused()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:ProjectSetup", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        await Json(await client.PostAsJsonAsync("/_console/api/project", new { name = "Clinic records", id = "clinic-records", products = new[] { "authentication" } }));

        var empty = await Json(await client.GetAsync("/_console/api/apps/registered"));
        Assert.True(empty.GetProperty("available").GetBoolean());
        Assert.Equal(0, empty.GetProperty("apps").GetArrayLength());
        // Refusing unregistered apps needs one registered first.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/_console/api/apps/policy", new { registeredOnly = true })).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/apps/registered", new { name = "Clinic", androidPackage = "not a package" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/apps/registered", new { name = "Clinic", webOrigins = new[] { "https://app.example.com/path" } })).StatusCode);
        var id = (await Json(await client.PostAsJsonAsync("/_console/api/apps/registered",
            new { name = "Clinic app", androidPackage = "com.example.clinic", webOrigins = new[] { "HTTPS://App.Example.com/" } }))).GetProperty("id").GetString()!;
        Assert.Matches("^app-[a-z2-9]{12}$", id);

        // Its options file and /.well-known/winche?app= name it; an unknown id is a 404.
        Assert.Contains($"appId: '{id}'", (await Json(await client.GetAsync($"/_console/api/apps?platforms=android&app={id}"))).GetProperty("file").GetString());
        Assert.Equal(id, (await Json(await client.GetAsync($"/.well-known/winche?app={id}"))).GetProperty("app").GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/.well-known/winche?app=app-nope")).StatusCode);

        // Requests are counted per app (unnamed ones apart).
        var email = $"ann-{Guid.NewGuid():N}@example.com";
        var signUp = new HttpRequestMessage(HttpMethod.Post, "/auth/v1/signUp") { Content = JsonContent.Create(new { email = email, password = "correct horse battery" }) };
        signUp.Headers.Add("X-Winche-App", id);
        await Json(await client.SendAsync(signUp));
        await client.PostAsJsonAsync("/auth/v1/signIn", new { email = email, password = "correct horse battery" });
        var listed = await Json(await client.GetAsync("/_console/api/apps/registered"));
        var registered = listed.GetProperty("apps")[0];
        Assert.Equal("https://app.example.com", registered.GetProperty("webOrigins")[0].GetString());
        Assert.Equal(1, registered.GetProperty("usage").GetProperty("today").GetInt64());
        Assert.Equal(1, listed.GetProperty("unregistered").GetProperty("today").GetInt64());

        // Only registered apps: the unnamed request is refused, the named one goes through.
        await Json(await client.PutAsJsonAsync("/_console/api/apps/policy", new { registeredOnly = true }));
        var refused = await client.PostAsJsonAsync("/auth/v1/signIn", new { email = email, password = "correct horse battery" });
        Assert.Contains("app-not-registered", await refused.Content.ReadAsStringAsync());
        var named = new HttpRequestMessage(HttpMethod.Post, $"/auth/v1/signIn?winche_app={id}") { Content = JsonContent.Create(new { email = email, password = "correct horse battery" }) };
        Assert.DoesNotContain("app-not-registered", await (await client.SendAsync(named)).Content.ReadAsStringAsync());

        // Removing the last app turns the refusal off with it.
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/_console/api/apps/registered/{id}")).StatusCode);
        Assert.False((await Json(await client.GetAsync("/_console/api/apps/registered"))).GetProperty("registeredOnly").GetBoolean());
    }

    [Fact]
    public async Task The_project_is_renamed_keeping_its_id_and_takes_a_thumbnail()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:ProjectSetup", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        await Json(await client.PostAsJsonAsync("/_console/api/project", new { name = "Clinic records", id = "clinic-records", products = Array.Empty<string>() }));

        var renamed = await Json(await client.PutAsJsonAsync("/_console/api/project", new { name = "Clinic", id = "clinic-records" }));
        Assert.Equal("Clinic", renamed.GetProperty("name").GetString());
        Assert.Equal("clinic-records", renamed.GetProperty("id").GetString());

        var project = await Json(await client.GetAsync("/_console/api/project"));
        Assert.Equal(JsonValueKind.Null, project.GetProperty("imageVersion").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/project/image")).StatusCode);

        // Only PNG, JPEG or WebP, judged by the bytes: an SVG (which can carry scripts) is refused whatever it claims.
        var svg = new ByteArrayContent("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"u8.ToArray());
        svg.Headers.ContentType = new("image/png");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsync("/_console/api/project/image", svg)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsync("/_console/api/project/image", new ByteArrayContent(new byte[300 * 1024]))).StatusCode);

        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        await Json(await client.PutAsync("/_console/api/project/image", new ByteArrayContent(png)));
        project = await Json(await client.GetAsync("/_console/api/project"));
        Assert.False(string.IsNullOrEmpty(project.GetProperty("imageVersion").GetString()));
        var image = await client.GetAsync($"/_console/api/project/image?v={project.GetProperty("imageVersion").GetString()}");
        Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(png, await image.Content.ReadAsByteArrayAsync());
        Assert.Contains("immutable", image.Headers.CacheControl?.ToString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/_console/api/project/image")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/project/image")).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Json(await client.GetAsync("/_console/api/project"))).GetProperty("imageVersion").ValueKind);
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
