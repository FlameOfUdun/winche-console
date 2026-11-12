using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>The Logs tab (api/logs/app) and the Database / Storage Logs sub-tabs (api/logs/database|storage).</summary>
[Collection("postgres")]
public class ConsoleLogsTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
        try
        {
            await using var conn = new NpgsqlConnection(fx.ConsoleAuthConnectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("""
                DO $$ BEGIN
                  IF to_regclass('console_logs') IS NOT NULL THEN TRUNCATE console_logs; END IF;
                  IF to_regclass('console_log_settings') IS NOT NULL THEN TRUNCATE console_log_settings; END IF;
                END $$;
                """, conn);
            await cmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException ex) when (ex.SqlState == "3D000") { }
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<JsonElement> Json(HttpResponseMessage resp)
    {
        Assert.True(resp.IsSuccessStatusCode, $"{(int)resp.StatusCode} {await resp.Content.ReadAsStringAsync()}");
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task<JsonElement[]> Entries(HttpClient client, string query, int atLeast)
    {
        for (var i = 0; i < 60; i++)
        {
            var body = await Json(await client.GetAsync("/_console/api/logs/" + query));
            var entries = body.GetProperty("entries").EnumerateArray().ToArray();
            if (entries.Length >= atLeast) return entries;
            await Task.Delay(100);
        }
        throw new Xunit.Sdk.XunitException($"fewer than {atLeast} entries for {query}");
    }

    private static string[] Messages(IEnumerable<JsonElement> entries) => [.. entries.Select(e => e.GetProperty("message").GetString()!)];

    [Fact]
    public async Task Entries_are_kept_and_shown_per_scope_with_filters()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var factory = app.Services.GetRequiredService<ILoggerFactory>();
        factory.CreateLogger("Winche.Database.Runtime.Listening").LogWarning("Slow query on {Collection} with no index", "sessions");
        factory.CreateLogger("Winche.Storage.Hooks").LogError(new InvalidOperationException("SES rejected"), "Hook delivery for {Path} failed", "uploads/u1/r.pdf");
        factory.CreateLogger("SmartAirway.Reports").LogError("Report email failed for {UserId}: {ErrorId}", "u42", "3f9c0a1b2c4d");
        factory.CreateLogger("SmartAirway.Reports").LogInformation("Not kept: below the minimum level");

        var all = await Entries(client, "app", 3);
        Assert.Equal(3, all.Length);
        Assert.Equal("Report email failed for u42: 3f9c0a1b2c4d", all[0].GetProperty("message").GetString());   // newest first
        Assert.Equal("u42", all[0].GetProperty("userId").GetString());
        Assert.Equal("Error", all[0].GetProperty("level").GetString());
        Assert.Contains(":", all[0].GetProperty("instance").GetString());

        var database = await Entries(client, "database", 1);
        Assert.Equal(["Slow query on sessions with no index"], Messages(database));
        var storage = await Entries(client, "storage", 1);
        Assert.Equal(["Hook delivery for uploads/u1/r.pdf failed"], Messages(storage));
        Assert.Contains("SES rejected", storage[0].GetProperty("exception").GetString());
        Assert.Equal("uploads/u1/r.pdf", storage[0].GetProperty("properties").GetProperty("Path").GetString());

        // Filters: level, source, text (error ids are structured values), paging.
        Assert.Equal(2, (await Entries(client, "app?level=Error", 2)).Length);
        Assert.Equal(["Report email failed for u42: 3f9c0a1b2c4d"], Messages(await Entries(client, "app?category=SmartAirway", 1)));
        Assert.Equal(["Report email failed for u42: 3f9c0a1b2c4d"], Messages(await Entries(client, "app?q=3F9C0A1B", 1)));
        Assert.Equal(["Hook delivery for uploads/u1/r.pdf failed"], Messages(await Entries(client, "app?q=ses%20rejected", 1)));
        var newest = all[0].GetProperty("id").GetInt64();
        var oldest = all[2].GetProperty("id").GetInt64();
        Assert.Equal(2, (await Entries(client, $"app?before={newest}", 2)).Length);
        var newer = await Entries(client, $"app?after={oldest}", 2);
        Assert.True(newer[0].GetProperty("id").GetInt64() < newer[1].GetProperty("id").GetInt64());   // live: oldest first

        var categories = await Json(await client.GetAsync("/_console/api/logs/app/categories"));
        Assert.Contains("SmartAirway.Reports", categories.EnumerateArray().Select(c => c.GetString()));
        Assert.Equal(["Winche.Database.Runtime.Listening"],
            (await Json(await client.GetAsync("/_console/api/logs/database/categories"))).EnumerateArray().Select(c => c.GetString()!).ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/_console/api/logs/app?level=loud")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/logs/nope")).StatusCode);

        var state = await Json(await client.GetAsync("/_console/api/auth/state"));
        var logs = state.GetProperty("capabilities").GetProperty("logs");
        Assert.True(logs.GetProperty("app").GetBoolean() && logs.GetProperty("database").GetBoolean() && logs.GetProperty("storage").GetBoolean());
    }

    [Fact]
    public async Task Only_admins_see_logs()
    {
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ConsoleUser>>();
            var member = new ConsoleUser { UserName = "member@example.com", Email = "member@example.com", EmailConfirmed = true, Active = true };
            await users.CreateAsync(member, "Passw0rd!");
            await users.AddToRoleAsync(member, ConsoleRoles.Member);
        }
        using var client = app.CreateClient();
        await client.LoginAsync("member@example.com", "Passw0rd!");

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/_console/api/logs/app")).StatusCode);
        var logs = (await Json(await client.GetAsync("/_console/api/auth/state"))).GetProperty("capabilities").GetProperty("logs");
        Assert.False(logs.GetProperty("app").GetBoolean());
        Assert.False(logs.GetProperty("database").GetBoolean());
    }

    [Fact]
    public async Task Levels_set_in_the_console_apply_on_every_instance_and_reset_to_the_code()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        using var other = new ConsoleAppFactory(fx);   // a second instance of the app, same database
        _ = other.Services;
        var reports = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("SmartAirway.Reports.ReportEmailService");
        var otherReports = other.Services.GetRequiredService<ILoggerFactory>().CreateLogger("SmartAirway.Reports.ReportEmailService");

        var levels = await Json(await client.GetAsync("/_console/api/logs/levels"));
        Assert.Equal("code", levels.GetProperty("source").GetString());
        Assert.Equal("Warning", levels.GetProperty("defaultLevel").GetString());

        reports.LogDebug("before: not kept");
        var bad = await client.PutAsJsonAsync("/_console/api/logs/levels",
            new { defaultLevel = "Warning", overrides = new[] { new { category = "SmartAirway.Reports", level = "Loud", until = (DateTimeOffset?)null } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var past = await client.PutAsJsonAsync("/_console/api/logs/levels",
            new { defaultLevel = "Warning", overrides = new[] { new { category = "X", level = "Debug", until = (DateTimeOffset?)DateTimeOffset.UtcNow.AddMinutes(-1) } } });
        Assert.Contains("already ended", await past.Content.ReadAsStringAsync());

        var put = await client.PutAsJsonAsync("/_console/api/logs/levels", new
        {
            defaultLevel = "Warning",
            overrides = new[] { new { category = "SmartAirway.Reports", level = "Debug", until = (DateTimeOffset?)DateTimeOffset.UtcNow.AddHours(1) } },
        });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        levels = await Json(await client.GetAsync("/_console/api/logs/levels"));
        Assert.Equal("console", levels.GetProperty("source").GetString());
        Assert.Equal("admin@example.com", levels.GetProperty("updatedBy").GetString());
        Assert.Equal("Debug", levels.GetProperty("overrides")[0].GetProperty("level").GetString());

        // Debug from that source is kept now — on this instance at once (though the host logs Information and up)…
        reports.LogDebug("after: kept here");
        app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("SmartAirway.Other").LogDebug("other source: not kept");
        // …and on the other instance once it has synced.
        for (var i = 0; i < 50; i++)
        {
            otherReports.LogDebug("after: kept on the other instance {Attempt}", i);
            var found = (await Json(await client.GetAsync("/_console/api/logs/app?q=other%20instance"))).GetProperty("entries").GetArrayLength();
            if (found > 0) break;
            await Task.Delay(100);
        }
        var messages = Messages(await Entries(client, "app?level=Debug", 2));
        Assert.Contains("after: kept here", messages);
        Assert.Contains(messages, m => m.StartsWith("after: kept on the other instance", StringComparison.Ordinal));
        Assert.DoesNotContain("before: not kept", messages);
        Assert.DoesNotContain("other source: not kept", messages);

        // Reset: back to the code's levels.
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/_console/api/logs/levels")).StatusCode);
        Assert.Equal("code", (await Json(await client.GetAsync("/_console/api/logs/levels"))).GetProperty("source").GetString());
        reports.LogDebug("after reset: not kept");
        reports.LogWarning("marker");
        await Entries(client, "app?q=marker", 1);
        Assert.DoesNotContain("after reset: not kept", Messages(await Entries(client, "app?level=Debug", 1)));
    }
}
