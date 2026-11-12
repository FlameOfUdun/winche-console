using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Npgsql;
using Winche.Console.Users;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Settings → User directory, and the Users tab backed by Keycloak.</summary>
[Collection("postgres")]
public class ConsoleUserDirectoryTests(PostgresFixture fx) : IAsyncLifetime
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
        return text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone();
    }

    private static object Keycloak(FakeKeycloak kc) => new
    {
        kind = "keycloak",
        keycloak = new { serverUrl = kc.Url, realm = "smartairway", clientId = "winche-console", signInEvents = true },
    };

    [Fact]
    public async Task Keycloak_users_are_managed_from_the_console()
    {
        await using var kc = await FakeKeycloak.StartAsync();
        using var app = new ConsoleAppFactory(fx, ("Sample:ExternalOnly", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var before = await Json(await client.GetAsync("/_console/api/app-auth/settings/directory"));
        Assert.Equal("none", before.GetProperty("effectiveKind").GetString());   // no Winche Auth in this app
        Assert.False(before.GetProperty("wincheAuthInstalled").GetBoolean());
        Assert.Equal("NO_DIRECTORY", JsonDocument.Parse(await (await client.GetAsync("/_console/api/app-auth/users")).Content.ReadAsStringAsync()).RootElement.GetProperty("error").GetProperty("code").GetString());

        // Test the connection before saving: a wrong secret, then the right one.
        var wrong = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/settings/directory/test", new { settings = Keycloak(kc), clientSecret = "nope" }));
        Assert.False(wrong.GetProperty("connected").GetBoolean());
        Assert.Contains("Invalid client", wrong.GetProperty("error").GetString());
        var test = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/settings/directory/test", new { settings = Keycloak(kc), clientSecret = FakeKeycloak.Secret }));
        Assert.True(test.GetProperty("connected").GetBoolean());
        Assert.Equal(2, test.GetProperty("users").GetInt32());
        var perms = test.GetProperty("permissions").EnumerateArray().ToDictionary(p => p.GetProperty("role").GetString()!, p => p.GetProperty("granted").GetBoolean());
        Assert.True(perms["manage-users"]);
        Assert.False(perms["view-events"]);

        await Json(await client.PutAsJsonAsync("/_console/api/app-auth/settings/directory",
            new { settings = Keycloak(kc), clientSecret = FakeKeycloak.Secret, reason = "Manage Keycloak users here" }));
        var after = await Json(await client.GetAsync("/_console/api/app-auth/settings/directory"));
        Assert.Equal("keycloak", after.GetProperty("effectiveKind").GetString());
        Assert.Equal(JsonValueKind.Object, after.GetProperty("secret").ValueKind);   // set, never shown
        Assert.DoesNotContain(FakeKeycloak.Secret, after.ToString());

        // The Users tab now lists Keycloak's users.
        var list = await Json(await client.GetAsync("/_console/api/app-auth/users?search=costa"));
        Assert.Equal(1, list.GetProperty("total").GetInt32());
        var ana = list.GetProperty("users")[0];
        Assert.Equal(("u-ana", "Ana Costa", "st-marys"), (ana.GetProperty("uid").GetString(), ana.GetProperty("displayName").GetString(),
            ana.GetProperty("customClaims").GetProperty("org").GetString()));

        var detail = await Json(await client.GetAsync("/_console/api/app-auth/users/u-ana"));
        Assert.Equal(["/clinicians"], detail.GetProperty("user").GetProperty("groups").EnumerateArray().Select(g => g.GetString()));
        Assert.True(detail.GetProperty("user").GetProperty("mfaEnabled").GetBoolean());
        Assert.Equal("smartairway-app", detail.GetProperty("sessions")[0].GetProperty("provider").GetString());
        var ben = await Json(await client.GetAsync("/_console/api/app-auth/users/u-ben"));
        Assert.NotEqual(JsonValueKind.Null, ben.GetProperty("user").GetProperty("lockedOutUntil").ValueKind);

        // Changes happen in Keycloak.
        Assert.True((await Json(await client.PostAsJsonAsync("/_console/api/app-auth/users/u-ana/disabled", new { disabled = true }))).GetProperty("disabled").GetBoolean());
        Assert.Contains("logout u-ana", kc.Calls);
        await Json(await client.PutAsJsonAsync("/_console/api/app-auth/users/u-ana/claims", new { claims = new { org = "trucorp", roles = new[] { "a", "b" } } }));
        Assert.Equal("trucorp", kc.Users[0]["attributes"]!["org"]![0]!.GetValue<string>());
        await Json(await client.PostAsync("/_console/api/app-auth/users/u-ana/sendPasswordReset", null));
        Assert.Contains(kc.Calls, c => c.StartsWith("actions u-ana") && c.Contains("UPDATE_PASSWORD"));
        await Json(await client.DeleteAsync("/_console/api/app-auth/users/u-ana/mfa"));
        Assert.DoesNotContain("u-ana", kc.Otp);
        await Json(await client.PostAsync("/_console/api/app-auth/users/u-ben/unlock", null));
        Assert.DoesNotContain("u-ben", kc.Locked);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/_console/api/app-auth/users/u-ana/sessions/s-1")).StatusCode);
        var unlink = await client.DeleteAsync("/_console/api/app-auth/users/u-ana/providers/google");
        Assert.Equal(HttpStatusCode.BadRequest, unlink.StatusCode);
        Assert.Contains("Keycloak's own admin console", await unlink.Content.ReadAsStringAsync());
        var made = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/users", new { email = "new@example.com", displayName = "New Person" }));
        Assert.Equal("New Person", made.GetProperty("displayName").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/_console/api/app-auth/users", new { email = "new@example.com" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/_console/api/app-auth/users/u-ben")).StatusCode);

        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        Assert.Equal("keycloak", config.GetProperty("directory").GetProperty("kind").GetString());
        Assert.Equal("Attributes", config.GetProperty("directory").GetProperty("capabilities").GetProperty("claimsLabel").GetString());
    }

    [Fact]
    public async Task Keycloak_sign_in_events_become_log_entries()
    {
        await using var kc = await FakeKeycloak.StartAsync();
        kc.Roles = ["view-users", "view-events"];
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        kc.Events.Add(new JsonObject { ["time"] = now - 1000, ["type"] = "LOGIN", ["userId"] = "u-ana", ["clientId"] = "smartairway-app", ["details"] = new JsonObject { ["username"] = "dr.costa@example.com" } });
        kc.Events.Add(new JsonObject { ["time"] = now - 500, ["type"] = "LOGIN_ERROR", ["error"] = "invalid_user_credentials", ["details"] = new JsonObject { ["username"] = "ben@example.com" } });
        var directory = new KeycloakDirectory(new KeycloakDirectorySettings { ServerUrl = kc.Url, Realm = "smartairway", ClientId = "winche-console" }, FakeKeycloak.Secret);
        var events = await directory.SignInEventsAsync(DateTimeOffset.UtcNow.AddMinutes(-5), default);
        Assert.Equal(["LOGIN", "LOGIN_ERROR"], events.Select(e => e["type"]!.GetValue<string>()));   // oldest first
        Assert.Single(await directory.SignInEventsAsync(DateTimeOffset.FromUnixTimeMilliseconds(now - 800), default));

        var logged = new List<(LogLevel Level, Winche.Auth.Logging.AuthEvent Event)>();
        var logger = new CapturingLogger(logged);
        foreach (var e in events) KeycloakSignInEvents.Write(logger, e);
        Assert.Equal(("auth.signIn.keycloak", "u-ana", "ok", "dr.costa@example.com signed in with Keycloak (smartairway-app)."),
            (logged[0].Event.Operation, logged[0].Event.Principal, logged[0].Event.Outcome, logged[0].Event.Message));
        Assert.Equal((LogLevel.Warning, "invalidUserCredentials"), (logged[1].Level, logged[1].Event.Outcome));
    }

    private sealed class CapturingLogger(List<(LogLevel, Winche.Auth.Logging.AuthEvent)> logged) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (state is Winche.Auth.Logging.AuthEvent e) logged.Add((logLevel, e));
        }
    }

    [Fact]
    public async Task Sensitive_settings_need_two_step_sign_in()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:RequireTwoFactor", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var refused = await client.PutAsJsonAsync("/_console/api/app-auth/settings/providers", new { settings = new { trustWincheAuth = true, providers = Array.Empty<object>() }, reason = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Contains("TWO_FACTOR_REQUIRED", await refused.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync("/_console/api/app-auth/settings/directory", new { settings = new { kind = "none" }, reason = "x" })).StatusCode);
        await Json(await client.GetAsync("/_console/api/app-auth/settings/providers"));   // reading is fine
    }
}
