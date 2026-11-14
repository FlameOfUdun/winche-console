using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleTokenTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
        await using var conn = new NpgsqlConnection(fx.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("""
            DO $$ BEGIN
              IF to_regclass('winche_console_tokens') IS NOT NULL THEN TRUNCATE winche_console_tokens; END IF;
              IF to_regclass('winche_console_cli_codes') IS NOT NULL THEN TRUNCATE winche_console_cli_codes; END IF;
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

    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static HttpClient Bearer(ConsoleAppFactory app, string token)
    {
        var c = app.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Winche_login_is_allowed_in_the_browser_and_the_token_acts_as_that_user_until_logout()
    {
        using var app = new ConsoleAppFactory(fx);
        using var browser = app.CreateClient();
        await browser.SetupAdminAsync();
        await browser.LoginAsync();

        // The CLI's PKCE pair; the signed-in user allows it, and the browser is sent back to the CLI with a code.
        var verifier = B64(RandomNumberGenerator.GetBytes(32));
        var challenge = B64(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var approved = await Json(await browser.PostAsJsonAsync("/_console/api/cli-login/approve",
            new { challenge, port = 9005, state = "s1", name = "winche CLI on laptop" }));
        var redirect = new Uri(approved.GetProperty("redirect").GetString()!);
        Assert.Equal(("127.0.0.1", 9005, "/callback"), (redirect.Host, redirect.Port, redirect.AbsolutePath));
        var query = System.Web.HttpUtility.ParseQueryString(redirect.Query);
        Assert.Equal("s1", query["state"]);

        using var anon = app.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.PostAsJsonAsync("/_console/api/cli-login/token", new { code = query["code"], verifier = "wrong" })).StatusCode);
        // A wrong verifier used the code up: the CLI starts again.
        approved = await Json(await browser.PostAsJsonAsync("/_console/api/cli-login/approve", new { challenge, port = 9005, state = "s2", name = "winche CLI on laptop" }));
        var code = System.Web.HttpUtility.ParseQueryString(new Uri(approved.GetProperty("redirect").GetString()!).Query)["code"];
        var login = await Json(await anon.PostAsJsonAsync("/_console/api/cli-login/token", new { code, verifier }));
        Assert.Equal(("admin@example.com", "Admin"), (login.GetProperty("user").GetString(), login.GetProperty("role").GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.PostAsJsonAsync("/_console/api/cli-login/token", new { code, verifier })).StatusCode);   // once

        // The token is the user: it reaches admin endpoints, and shows in the list.
        using var cli = Bearer(app, login.GetProperty("token").GetString()!);
        await Json(await cli.GetAsync("/_console/api/rules/database/versions"));
        var tokens = await Json(await cli.GetAsync("/_console/api/tokens"));
        var mine = tokens.GetProperty("tokens").EnumerateArray().Single();
        Assert.Equal(("cli", "winche CLI on laptop", "admin@example.com"), (mine.GetProperty("kind").GetString(), mine.GetProperty("name").GetString(), mine.GetProperty("user").GetString()));
        Assert.False(mine.TryGetProperty("secret", out _));
        // A token can't approve another CLI or make CI tokens: only a person in the browser can.
        Assert.Equal(HttpStatusCode.Forbidden, (await cli.PostAsJsonAsync("/_console/api/cli-login/approve", new { challenge, port = 9005, state = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await cli.PostAsJsonAsync("/_console/api/tokens", new { name = "x", scopes = new[] { "rules" }, days = 1 })).StatusCode);

        // winche logout revokes it.
        Assert.Equal(HttpStatusCode.NoContent, (await cli.DeleteAsync("/_console/api/tokens/current")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await cli.GetAsync("/_console/api/rules/database/versions")).StatusCode);
    }

    [Fact]
    public async Task A_ci_token_only_does_what_its_scopes_allow_and_stops_when_revoked()
    {
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/_console/api/tokens", new { name = "x", scopes = new[] { "everything" }, days = 30 })).StatusCode);
        var made = await Json(await admin.PostAsJsonAsync("/_console/api/tokens", new { name = "gitlab-main", scopes = new[] { "rules" }, days = 30 }));
        var secret = made.GetProperty("secret").GetString()!;
        Assert.StartsWith("wct_", secret);
        using var ci = Bearer(app, secret);

        await Json(await ci.GetAsync("/_console/api/rules/database/versions"));                                  // rules: yes
        Assert.Equal(HttpStatusCode.Unauthorized, (await ci.GetAsync("/_console/api/tokens")).StatusCode);       // anything else: no
        Assert.Equal(HttpStatusCode.Unauthorized, (await ci.GetAsync("/_console/api/app-auth/config")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Bearer(app, secret[..^1] + "x").GetAsync("/_console/api/rules/database/versions")).StatusCode);

        var listed = (await Json(await admin.GetAsync("/_console/api/tokens"))).GetProperty("tokens").EnumerateArray().Single();
        Assert.Equal(("ci", "gitlab-main", "rules"), (listed.GetProperty("kind").GetString(), listed.GetProperty("name").GetString(), listed.GetProperty("scopes")[0].GetString()));
        Assert.Equal(JsonValueKind.String, listed.GetProperty("lastUsedAt").ValueKind);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/_console/api/tokens/{listed.GetProperty("id").GetString()}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ci.GetAsync("/_console/api/rules/database/versions")).StatusCode);
    }
}
