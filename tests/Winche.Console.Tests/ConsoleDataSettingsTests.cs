using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Database → Settings and Storage → Settings.</summary>
[Collection("postgres")]
public class ConsoleDataSettingsTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
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

    [Fact]
    public async Task Database_and_storage_settings_are_changed_from_the_console()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var state = await Json(await client.GetAsync("/_console/api/auth/state"));
        Assert.True(state.GetProperty("capabilities").GetProperty("settings").GetProperty("database").GetBoolean());
        Assert.True(state.GetProperty("capabilities").GetProperty("settings").GetProperty("storage").GetBoolean());

        var db = await Json(await client.GetAsync("/_console/api/settings/database"));
        Assert.Equal("code", db.GetProperty("source").GetString());
        var settings = JsonNode.Parse(db.GetProperty("settings").GetRawText())!.AsObject();
        Assert.Equal("patients", settings["indexes"]![0]!["collection"]!.GetValue<string>());
        Assert.True(settings["history"]!["enabled"]!.GetValue<bool>());

        settings["indexes"]!.AsArray().Add(new JsonObject
        {
            ["collection"] = "visits", ["kind"] = "ordered", ["collectionGroup"] = false,
            ["fields"] = new JsonArray(new JsonObject { ["path"] = "at", ["direction"] = "desc" }),
        });
        settings["ttl"] = new JsonArray(new JsonObject { ["collection"] = "sessions", ["field"] = "expiresAt" });
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/_console/api/settings/database", new { settings, reason = "" })).StatusCode);
        await Json(await client.PutAsJsonAsync("/_console/api/settings/database", new { settings, reason = "Visits by date; expire sessions" }));
        var catalog = app.Services.GetRequiredService<Winche.Database.Schema.IndexCatalog>();
        Assert.Contains(catalog.Indexes, i => i.CollectionId == "visits");

        var bad = settings.DeepClone();
        bad["writeLimits"]!["maxDocumentKb"] = 0;
        var refused = await client.PutAsJsonAsync("/_console/api/settings/database", new { settings = bad, reason = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("1 KB to 16 MB", await refused.Content.ReadAsStringAsync());

        var storage = await Json(await client.GetAsync("/_console/api/settings/storage"));
        var s = JsonNode.Parse(storage.GetProperty("settings").GetRawText())!.AsObject();
        Assert.Equal(10, s["maxFileSizeMb"]!.GetValue<double>());
        s["maxFileSizeMb"] = 5;
        await Json(await client.PutAsJsonAsync("/_console/api/settings/storage", new { settings = s, reason = "Smaller uploads" }));
        Assert.Equal(5 * 1048576, app.Services.GetRequiredService<Winche.Storage.Models.StorageLimits>().MaxFileSizeBytes);

        var history = await Json(await client.GetAsync("/_console/api/settings/history?area=database"));
        Assert.Single(history.GetProperty("versions").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/settings/auth.signIn")).StatusCode);   // auth has its own screens
        await Json(await client.GetAsync("/_console/api/settings/database/suggestions"));
    }
}
