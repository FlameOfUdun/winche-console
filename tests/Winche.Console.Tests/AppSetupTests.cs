using System.Net;
using System.Text.Json;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>How an app connects: /.well-known/winche, and the Project settings → General's winche_options.dart.</summary>
[Collection("postgres")]
public class AppSetupTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => fx.ResetAuthAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<JsonElement> Json(HttpResponseMessage resp)
    {
        var text = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.IsSuccessStatusCode, $"{(int)resp.StatusCode} {text}");
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    [Fact]
    public async Task The_public_setup_says_which_services_run_where_without_signing_in()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        var setup = await Json(await client.GetAsync("/.well-known/winche"));
        Assert.Equal("winche", setup.GetProperty("projectId").GetString());
        Assert.Equal("http://localhost", setup.GetProperty("baseUrl").GetString());
        var services = setup.GetProperty("services").EnumerateArray().ToDictionary(s => s.GetProperty("id").GetString()!, s => s.GetProperty("path").GetString());
        Assert.Equal("/documents/v1", services["database"]);
        Assert.Equal("/files/v1", services["storage"]);
    }

    [Fact]
    public async Task The_apps_page_writes_winche_options_dart_for_the_platforms_asked()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/_console/api/apps")).StatusCode);
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var page = await Json(await client.GetAsync("/_console/api/apps?platforms=android,ios,nonsense"));
        var file = page.GetProperty("file").GetString()!;
        Assert.Contains("abstract final class DefaultWincheOptions", file);
        Assert.Contains("static final android = WincheOptions(", file);
        Assert.Contains("static final ios = WincheOptions(", file);
        Assert.DoesNotContain("static final web", file);
        Assert.DoesNotContain("nonsense", file);
        Assert.Contains("baseUrl: Uri.parse('http://localhost'),", file);
        Assert.Contains("WincheFlutter.initializeApp", page.GetProperty("snippet").GetString());
    }
}
