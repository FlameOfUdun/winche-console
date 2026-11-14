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
        settings["dropUndeclaredIndexes"] = false;   // the console always drops indexes it no longer lists
        await Json(await client.PutAsJsonAsync("/_console/api/settings/database", new { settings, reason = "Visits by date; expire sessions" }));
        settings["dropUndeclaredIndexes"] = true;
        Assert.True((await Json(await client.GetAsync("/_console/api/settings/database"))).GetProperty("settings").GetProperty("dropUndeclaredIndexes").GetBoolean());
        var catalog = app.Services.GetRequiredService<Winche.Database.Schema.IndexCatalog>();
        Assert.Contains(catalog.Indexes, i => i.CollectionId == "visits");

        // As text: read, checked, and saved (merged into the settings, with a reason).
        var asText = await Json(await client.GetAsync("/_console/api/settings/database/indexes"));
        Assert.Contains("expire when expiresAt", asText.GetProperty("text").GetString());
        var parsed = await Json(await client.PostAsJsonAsync("/_console/api/settings/database/indexes/parse", new { text = "collection s {\n  index (a b)\n}" }));
        Assert.False(parsed.GetProperty("ok").GetBoolean());
        Assert.Equal(2, parsed.GetProperty("error").GetProperty("line").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/_console/api/settings/database/indexes", new { text = "collection {", reason = "x" })).StatusCode);
        await Json(await client.PutAsJsonAsync("/_console/api/settings/database/indexes", new
        {
            text = "collection visits {\n  index (patientId, at desc)\n}\n\ncollection sessions {\n  expire when endsAt\n}\n",
            reason = "Visits per patient",
        }));
        var saved = await Json(await client.GetAsync("/_console/api/settings/database"));
        Assert.Equal("endsAt", saved.GetProperty("settings").GetProperty("ttl")[0].GetProperty("field").GetString());
        Assert.Equal(1, saved.GetProperty("settings").GetProperty("indexes").GetArrayLength());
        Assert.Equal("Visits per patient", saved.GetProperty("version").GetProperty("reason").GetString());
        settings = JsonNode.Parse(saved.GetProperty("settings").GetRawText())!.AsObject();

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
        Assert.Equal(2, history.GetProperty("versions").GetArrayLength());   // the form, then the text
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/settings/auth.signIn")).StatusCode);   // auth has its own screens
        await Json(await client.GetAsync("/_console/api/settings/database/suggestions"));
    }

    [Fact]
    public async Task Where_files_are_kept_is_shown_and_a_move_needs_a_location_this_app_can_use()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var location = await Json(await client.GetAsync("/_console/api/settings/storage/location"));
        Assert.Equal("the app's own archive (NoOpArchive)", location.GetProperty("activeLabel").GetString());
        Assert.Equal(JsonValueKind.Null, location.GetProperty("move").ValueKind);
        Assert.Empty(location.GetProperty("kinds").EnumerateArray());   // no S3 package in this app

        var bucket = new { kind = "s3", s3 = new { bucket = "files", region = "auto", serviceUrl = "https://acct.r2.cloudflarestorage.com", accessKey = "AK" } };
        var test = await Json(await client.PostAsJsonAsync("/_console/api/settings/storage/location/test", new { location = bucket, secretKey = "s" }));
        Assert.False(test.GetProperty("ok").GetBoolean());
        Assert.Contains("add the package", test.GetProperty("steps")[0].GetProperty("error").GetString());

        var move = await client.PostAsJsonAsync("/_console/api/settings/storage/location/move", new { location = bucket, secretKey = "s", reason = "To R2" });
        Assert.Equal(HttpStatusCode.BadRequest, move.StatusCode);
        Assert.Contains("didn't pass its test", await move.Content.ReadAsStringAsync());
        var finish = await client.PostAsJsonAsync("/_console/api/settings/storage/location/move/finish", new { reason = "x" });
        Assert.Contains("Switch to the new location first", await finish.Content.ReadAsStringAsync());
    }
}
