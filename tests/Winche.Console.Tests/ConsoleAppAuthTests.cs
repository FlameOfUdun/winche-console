using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>The Authentication tab (api/app-auth): the app's Winche Auth users.</summary>
[Collection("postgres")]
public class ConsoleAppAuthTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
        await using var conn = new NpgsqlConnection(fx.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("""
            DO $$ BEGIN
              IF to_regclass('auth_users') IS NOT NULL THEN TRUNCATE auth_users CASCADE; END IF;
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

    [Fact]
    public async Task Admins_manage_the_apps_users()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var state = await Json(await client.GetAsync("/_console/api/auth/state"));
        Assert.True(state.GetProperty("capabilities").GetProperty("authentication").GetBoolean());

        // A user signs up through the app's API, then signs in on a second device.
        var signUp = await Json(await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" }));
        var uid = signUp.GetProperty("user").GetProperty("uid").GetString()!;
        await Json(await client.PostAsJsonAsync("/auth/v1/signIn", new { email = "ann@example.com", password = "correct horse battery" }));
        var made = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/users", new { email = "bob@example.com", displayName = "Bob" }));
        Assert.Equal("Bob", made.GetProperty("displayName").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/_console/api/app-auth/users", new { email = "bob@example.com" })).StatusCode);

        var list = await Json(await client.GetAsync("/_console/api/app-auth/users"));
        Assert.Equal(2, list.GetProperty("total").GetInt32());
        var found = await Json(await client.GetAsync("/_console/api/app-auth/users?search=ann"));
        Assert.Equal(uid, found.GetProperty("users")[0].GetProperty("uid").GetString());

        var detail = await Json(await client.GetAsync($"/_console/api/app-auth/users/{uid}"));
        Assert.Equal(2, detail.GetProperty("sessions").GetArrayLength());
        Assert.Equal("password", detail.GetProperty("user").GetProperty("providers")[0].GetString());

        var claims = await Json(await client.PutAsJsonAsync($"/_console/api/app-auth/users/{uid}/claims", new { claims = new { role = "clinician", level = 2 } }));
        Assert.Equal("clinician", claims.GetProperty("customClaims").GetProperty("role").GetString());
        var bad = await client.PutAsJsonAsync($"/_console/api/app-auth/users/{uid}/claims", new { claims = new { uid = "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("INVALID_CLAIMS", await bad.Content.ReadAsStringAsync());

        var sessionId = detail.GetProperty("sessions")[0].GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/_console/api/app-auth/users/{uid}/sessions/{sessionId}")).StatusCode);
        Assert.Equal(1, (await Json(await client.PostAsync($"/_console/api/app-auth/users/{uid}/signOut", null))).GetProperty("sessions").GetInt32());

        Assert.True((await Json(await client.PostAsJsonAsync($"/_console/api/app-auth/users/{uid}/disabled", new { disabled = true }))).GetProperty("disabled").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/auth/v1/signIn", new { email = "ann@example.com", password = "correct horse battery" })).StatusCode);
        await Json(await client.PostAsJsonAsync($"/_console/api/app-auth/users/{uid}/disabled", new { disabled = false }));
        await Json(await client.PostAsync($"/_console/api/app-auth/users/{uid}/unlock", null));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/_console/api/app-auth/users/{uid}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/_console/api/app-auth/users/{uid}")).StatusCode);

        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        Assert.Equal(10, config.GetProperty("emailPassword").GetProperty("minLength").GetInt32());
        Assert.True(config.GetProperty("anonymous").GetBoolean());
        Assert.Equal("https://sample.test", config.GetProperty("tokens").GetProperty("issuer").GetString());
        var keys = config.GetProperty("keys").GetArrayLength();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/_console/api/app-auth/keys/rotate", null)).StatusCode);
        Assert.Equal(keys + 1, (await Json(await client.GetAsync("/_console/api/app-auth/config"))).GetProperty("keys").GetArrayLength());

        // Sign-ins reach the Logs Explorer as resource "auth".
        await client.PostAsJsonAsync("/auth/v1/signIn", new { email = "nobody@example.com", password = "wrong password!" });
        JsonElement[] auth = [];
        for (var i = 0; i < 50 && auth.Length == 0; i++)
        {
            await Task.Delay(100);
            auth = [.. (await Json(await client.GetAsync("/_console/api/logs/app?resource=auth&f=outcome:invalidCredentials"))).GetProperty("entries").EnumerateArray()];
        }
        var entry = Assert.Single(auth);
        Assert.Equal("auth.signIn", entry.GetProperty("operation").GetString());
        Assert.Equal("nobody@example.com", entry.GetProperty("principal").GetString());
        Assert.Equal("Warning", entry.GetProperty("level").GetString());
    }

    [Fact]
    public async Task Signed_out_callers_get_nothing()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        Assert.True((await client.GetAsync("/_console/api/app-auth/users")).StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);
    }
}
