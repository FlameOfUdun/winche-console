using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Settings → Winche Auth's sign-in settings, changed from the console.</summary>
[Collection("postgres")]
public class ConsoleSignInSettingsTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
        await using var conn = new NpgsqlConnection(fx.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("""
            DO $$ BEGIN
              IF to_regclass('winche_settings') IS NOT NULL THEN TRUNCATE winche_settings; END IF;
              IF to_regclass('winche_secrets') IS NOT NULL THEN TRUNCATE winche_secrets; END IF;
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
    public async Task Sign_in_settings_are_changed_from_the_console()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var got = await Json(await client.GetAsync("/_console/api/app-auth/settings/signin"));
        Assert.True(got.GetProperty("available").GetBoolean());
        Assert.Equal("code", got.GetProperty("source").GetString());
        Assert.True(got.GetProperty("appSender").GetBoolean());
        var settings = JsonNode.Parse(got.GetProperty("settings").GetRawText())!.AsObject();
        Assert.Equal("google", settings["providers"]![0]!["kind"]!.GetValue<string>());

        settings["anonymous"] = false;
        settings["lockout"]!["maxFailedSignIns"] = 3;
        settings["email"]!["sender"] = "smtp";
        settings["email"]!["smtp"] = new JsonObject { ["host"] = "smtp.example.com", ["port"] = 587, ["security"] = "startTls", ["username"] = "mailer", ["fromAddress"] = "no-reply@example.com" };

        // A reason is required, and settings that can't work are refused with reasons.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/_console/api/app-auth/settings/signin", new { settings, reason = "" })).StatusCode);
        var bad = settings.DeepClone();
        bad["emailLink"] = new JsonObject { ["enabled"] = true, ["linkUrl"] = "not a url" };
        var refused = await client.PutAsJsonAsync("/_console/api/app-auth/settings/signin", new { settings = bad, reason = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("link address", await refused.Content.ReadAsStringAsync());

        await Json(await client.PutAsJsonAsync("/_console/api/app-auth/settings/signin", new { settings, smtpPassword = "smtp-pass", reason = "No guests; our own mail server" }));
        var after = await Json(await client.GetAsync("/_console/api/app-auth/settings/signin"));
        Assert.Equal("console", after.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Object, after.GetProperty("smtpPassword").ValueKind);
        Assert.DoesNotContain("smtp-pass", after.ToString());

        // The Sign-in methods tab (config) shows what's in force.
        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        Assert.False(config.GetProperty("anonymous").GetBoolean());
        Assert.Equal(3, config.GetProperty("protection").GetProperty("maxFailedSignIns").GetInt32());

        var history = await Json(await client.GetAsync("/_console/api/app-auth/settings/history"));
        Assert.Contains(history.GetProperty("versions").EnumerateArray(), v => v.GetProperty("area").GetString() == "auth.signIn");
    }

    [Fact]
    public async Task Test_email_reports_an_unreachable_server()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var settings = JsonNode.Parse((await Json(await client.GetAsync("/_console/api/app-auth/settings/signin"))).GetProperty("settings").GetRawText())!;
        settings["email"]!["smtp"] = new JsonObject { ["host"] = "127.0.0.1", ["port"] = 1, ["security"] = "none", ["fromAddress"] = "no-reply@example.com" };
        var resp = await client.PostAsJsonAsync("/_console/api/app-auth/settings/signin/testEmail", new { settings, to = "me@example.com" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Contains("didn't take the message", await resp.Content.ReadAsStringAsync());
    }
}
