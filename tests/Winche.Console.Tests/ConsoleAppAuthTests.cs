using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
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
    public async Task Email_templates_and_emails_from_the_console()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var outbox = app.Services.GetRequiredService<RecordingEmailSender>();

        var templates = (await Json(await client.GetAsync("/_console/api/app-auth/email-templates"))).GetProperty("templates").EnumerateArray().ToArray();
        Assert.Equal(["verifyEmail", "resetPassword", "signIn", "emailChanged"], templates.Select(t => t.GetProperty("kind").GetString()));
        Assert.False(templates[1].GetProperty("isCustom").GetBoolean());

        var bad = await client.PutAsJsonAsync("/_console/api/app-auth/email-templates/resetPassword", new { subject = "Reset", body = "no link" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync("/_console/api/app-auth/email-templates/resetPassword",
            new { subject = "Reset your %APP_NAME% password", body = "Hi,\n\n%LINK%" })).StatusCode);
        var saved = (await Json(await client.GetAsync("/_console/api/app-auth/email-templates"))).GetProperty("templates")[1];
        Assert.True(saved.GetProperty("isCustom").GetBoolean());
        Assert.False(string.IsNullOrEmpty(saved.GetProperty("updatedBy").GetString()));

        var test = await Json(await client.PostAsync("/_console/api/app-auth/email-templates/resetPassword/test", null));
        var to = test.GetProperty("sentTo").GetString()!;
        lock (outbox.Sent) Assert.Equal("[Test] Reset your Sample password", outbox.Sent.Last(m => m.To == to).Subject);

        // A user: the console sends them a reset and marks their email verified.
        var signUp = await Json(await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" }));
        var uid = signUp.GetProperty("user").GetProperty("uid").GetString()!;
        lock (outbox.Sent) Assert.Equal("verifyEmail", outbox.Sent.Last(m => m.To == "ann@example.com").Kind);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/_console/api/app-auth/users/{uid}/sendPasswordReset", null)).StatusCode);
        // Reset emails go out after the answer (so timing doesn't reveal accounts): wait for it.
        for (var i = 0; i < 100; i++) { lock (outbox.Sent) if (outbox.Sent.Last(m => m.To == "ann@example.com").Kind == "resetPassword") break; await Task.Delay(20); }
        lock (outbox.Sent) Assert.Equal("resetPassword", outbox.Sent.Last(m => m.To == "ann@example.com").Kind);
        Assert.True((await Json(await client.PostAsJsonAsync($"/_console/api/app-auth/users/{uid}/verified", new { verified = true }))).GetProperty("emailVerified").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/_console/api/app-auth/email-templates/resetPassword")).StatusCode);
        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        Assert.Equal("Sample", config.GetProperty("email").GetProperty("appName").GetString());
        Assert.Equal("RecordingEmailSender", config.GetProperty("email").GetProperty("sender").GetString());
    }

    [Fact]
    public async Task Providers_show_and_can_be_unlinked()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var signUp = await Json(await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" }));
        var uid = signUp.GetProperty("user").GetProperty("uid").GetString()!;
        var token = signUp.GetProperty("accessToken").GetString()!;
        var payload = Microsoft.IdentityModel.Tokens.Base64UrlEncoder.Encode(JsonSerializer.Serialize(new
        {
            iss = "https://accounts.google.com", aud = "sample.apps.googleusercontent.com", sub = "g-1", exp = DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeSeconds(),
        }));
        var idToken = $"{Microsoft.IdentityModel.Tokens.Base64UrlEncoder.Encode("{\"alg\":\"none\"}")}.{payload}.";
        using var link = new HttpRequestMessage(HttpMethod.Post, "/auth/v1/link/idp") { Content = JsonContent.Create(new { provider = "google", idToken }) };
        link.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        await Json(await client.SendAsync(link));

        var user = (await Json(await client.GetAsync($"/_console/api/app-auth/users/{uid}"))).GetProperty("user");
        Assert.Equal(["password", "google"], user.GetProperty("providers").EnumerateArray().Select(p => p.GetString()));
        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        var google = config.GetProperty("identityProviders")[0];
        Assert.Equal(("google", "Google", true), (google.GetProperty("name").GetString(), google.GetProperty("displayName").GetString(), google.GetProperty("testingOnly").GetBoolean()));

        var after = await Json(await client.DeleteAsync($"/_console/api/app-auth/users/{uid}/providers/google"));
        Assert.Equal(["password"], after.GetProperty("providers").EnumerateArray().Select(p => p.GetString()));
    }

    [Fact]
    public async Task Two_step_sign_in_shows_and_an_admin_can_turn_it_off()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var signUp = await Json(await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" }));
        var uid = signUp.GetProperty("user").GetProperty("uid").GetString()!;
        var bearer = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", signUp.GetProperty("accessToken").GetString());
        using var start = new HttpRequestMessage(HttpMethod.Post, "/auth/v1/me/mfa/totp/start") { Headers = { Authorization = bearer } };
        var secret = (await Json(await client.SendAsync(start))).GetProperty("secret").GetString()!;
        var code = Totp(secret);
        using var confirm = new HttpRequestMessage(HttpMethod.Post, "/auth/v1/me/mfa/totp/confirm") { Content = JsonContent.Create(new { code }), Headers = { Authorization = bearer } };
        await Json(await client.SendAsync(confirm));

        var detail = await Json(await client.GetAsync($"/_console/api/app-auth/users/{uid}"));
        Assert.True(detail.GetProperty("user").GetProperty("mfaEnabled").GetBoolean());
        Assert.Equal(10, detail.GetProperty("mfa").GetProperty("recoveryCodesLeft").GetInt32());
        Assert.Equal("Sample", (await Json(await client.GetAsync("/_console/api/app-auth/config"))).GetProperty("mfa").GetProperty("issuer").GetString());

        var off = await Json(await client.DeleteAsync($"/_console/api/app-auth/users/{uid}/mfa"));
        Assert.False(off.GetProperty("mfaEnabled").GetBoolean());
        await Json(await client.PostAsJsonAsync("/auth/v1/signIn", new { email = "ann@example.com", password = "correct horse battery" }));   // no second step
    }

    /// <summary>The authenticator app's current code (RFC 6238).</summary>
    private static string Totp(string base32)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var bytes = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in base32)
        {
            buffer = (buffer << 5) | alphabet.IndexOf(c);
            bits += 5;
            if (bits >= 8) { bytes.Add((byte)((buffer >> (bits - 8)) & 0xFF)); bits -= 8; }
        }
        var counter = new byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30);
        var hash = System.Security.Cryptography.HMACSHA1.HashData(bytes.ToArray(), counter);
        var o = hash[^1] & 0x0F;
        return ((((hash[o] & 0x7F) << 24) | (hash[o + 1] << 16) | (hash[o + 2] << 8) | hash[o + 3]) % 1_000_000).ToString("D6");
    }

    [Fact]
    public async Task Identity_providers_and_token_mapping_are_managed_with_history()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var providers = await Json(await client.GetAsync("/_console/api/app-auth/settings/providers"));
        Assert.Equal("code", providers.GetProperty("source").GetString());
        Assert.True(providers.GetProperty("editable").GetBoolean());
        Assert.True(providers.GetProperty("settings").GetProperty("trustWincheAuth").GetBoolean());

        var settings = new
        {
            trustWincheAuth = true,
            providers = new[]
            {
                new
                {
                    name = "keycloak", displayName = "TruCorp Keycloak", kind = "keycloak", issuer = "http://127.0.0.1:1/realms/smartairway",
                    audiences = new[] { "smartairway-api" }, validateAudience = true, uidClaim = "sub", requireHttps = false,
                    claims = new[] { new { from = "realm_access.roles", to = "roles" } },
                },
            },
        };
        var noReason = await client.PutAsJsonAsync("/_console/api/app-auth/settings/providers", new { settings, reason = "" });
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        var bad = await client.PutAsJsonAsync("/_console/api/app-auth/settings/providers",
            new { settings = new { providers = new[] { new { name = "Bad Name", issuer = "nope", audiences = Array.Empty<string>() } } }, reason = "test" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("lower-case", await bad.Content.ReadAsStringAsync());

        var saved = await Json(await client.PutAsJsonAsync("/_console/api/app-auth/settings/providers", new { settings, reason = "Trust Keycloak" }));
        Assert.Equal(1, saved.GetProperty("number").GetInt32());
        var after = await Json(await client.GetAsync("/_console/api/app-auth/settings/providers"));
        Assert.Equal("console", after.GetProperty("source").GetString());
        Assert.Equal("keycloak", after.GetProperty("settings").GetProperty("providers")[0].GetProperty("name").GetString());
        Assert.Equal("Trust Keycloak", after.GetProperty("version").GetProperty("reason").GetString());

        // The token test: a Winche Auth token (trusted) and garbage.
        var signUp = await Json(await client.PostAsJsonAsync("/auth/v1/signUp", new { email = "ann@example.com", password = "correct horse battery" }));
        var test = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/settings/providers/test", new { token = signUp.GetProperty("accessToken").GetString() }));
        Assert.True(test.GetProperty("wouldSignIn").GetBoolean());
        Assert.Equal(signUp.GetProperty("user").GetProperty("uid").GetString(), test.GetProperty("auth").GetProperty("uid").GetString());
        var garbage = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/settings/providers/test", new { token = "hello" }));
        Assert.Equal("error", garbage.GetProperty("checks")[0].GetProperty("outcome").GetString());
        var check = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/settings/providers/check", new { issuer = "http://127.0.0.1:1/realms/x", requireHttps = false }));
        Assert.False(check.GetProperty("found").GetBoolean());

        // History, reset, restore.
        var reset = await Json(await client.PostAsJsonAsync("/_console/api/app-auth/settings/auth.identityProviders/reset", new { reason = "Undo" }));
        Assert.True(reset.GetProperty("reset").GetBoolean());
        Assert.Equal("code", (await Json(await client.GetAsync("/_console/api/app-auth/settings/providers"))).GetProperty("source").GetString());
        var history = (await Json(await client.GetAsync("/_console/api/app-auth/settings/history"))).GetProperty("versions").EnumerateArray().ToArray();
        Assert.Equal([2, 1], history.Select(h => h.GetProperty("number").GetInt32()));
        Assert.Equal("Identity providers", history[0].GetProperty("areaTitle").GetString());
        Assert.True(history[0].GetProperty("current").GetBoolean());
        Assert.False(string.IsNullOrEmpty(history[1].GetProperty("by").GetString()));
        var restored = await Json(await client.PostAsJsonAsync($"/_console/api/app-auth/settings/history/{history[1].GetProperty("id").GetInt64()}/restore", new { reason = "Back" }));
        Assert.Equal(3, restored.GetProperty("number").GetInt32());
        Assert.Equal("console", (await Json(await client.GetAsync("/_console/api/app-auth/settings/providers"))).GetProperty("source").GetString());

        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        Assert.True(config.GetProperty("wincheAuth").GetBoolean());
        Assert.Equal("realm_access.roles → roles", config.GetProperty("trustedIssuers")[0].GetProperty("claims")[0].GetString());
    }

    [Fact]
    public async Task With_only_an_external_provider_the_tab_manages_its_settings()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:ExternalOnly", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var state = await Json(await client.GetAsync("/_console/api/auth/state"));
        Assert.True(state.GetProperty("capabilities").GetProperty("authentication").GetBoolean());
        var config = await Json(await client.GetAsync("/_console/api/app-auth/config"));
        Assert.False(config.GetProperty("wincheAuth").GetBoolean());
        Assert.Equal(JsonValueKind.Null, config.GetProperty("tokens").ValueKind);
        Assert.False((await Json(await client.GetAsync("/_console/api/app-auth/settings/providers"))).GetProperty("settings").GetProperty("trustWincheAuth").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/app-auth/users")).StatusCode);   // no Winche Auth users
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/auth/v1/signIn", new { email = "a@b.c", password = "x" })).StatusCode);
    }

    [Fact]
    public async Task Signed_out_callers_get_nothing()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        Assert.True((await client.GetAsync("/_console/api/app-auth/users")).StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Admins_see_the_keycloak_sync_and_can_run_it_now()
    {
        using var app = new ConsoleAppFactory(fx, ("Sample:KeycloakSync", "true"));
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        // Its Keycloak can't be reached, so the sync's runs fail: the status says so.
        JsonElement sync = default;
        for (var i = 0; i < 50; i++)
        {
            sync = (await Json(await client.GetAsync("/_console/api/app-auth/providers/sync"))).GetProperty("syncs")[0];
            if (sync.GetProperty("lastError").ValueKind == JsonValueKind.String) break;
            await Task.Delay(200);
        }
        Assert.Equal(("staff", "Staff Keycloak", "winche-sync"), (sync.GetProperty("provider").GetString(), sync.GetProperty("displayName").GetString(), sync.GetProperty("clientId").GetString()));
        Assert.Equal(JsonValueKind.String, sync.GetProperty("lastError").ValueKind);
        Assert.Equal("ward", sync.GetProperty("attributes").GetProperty("ward").GetString());
        Assert.Equal("https://sample.test/auth/v1/providers/staff/changed", sync.GetProperty("webhookUrl").GetString());
        Assert.False(sync.TryGetProperty("clientSecret", out _));   // never the secrets

        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync("/_console/api/app-auth/providers/staff/sync", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/_console/api/app-auth/providers/google/sync", null)).StatusCode);
    }
}
