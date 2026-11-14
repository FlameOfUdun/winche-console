using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>The Functions page: deploy, versions, run, deploy key. Deploying needs Deno (WINCHE_DENO).</summary>
[Collection("postgres")]
public class ConsoleFunctionsTests(PostgresFixture fx) : IAsyncLifetime
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
              IF to_regclass('winche_function_deployments') IS NOT NULL THEN TRUNCATE winche_function_deployments; END IF;
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
    public async Task Functions_are_deployed_run_and_rolled_back_from_the_console()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var state = await Json(await client.GetAsync("/_console/api/auth/state"));
        Assert.True(state.GetProperty("capabilities").GetProperty("functions").GetBoolean());
        var page = await Json(await client.GetAsync("/_console/api/functions"));
        Assert.Equal(JsonValueKind.Null, page.GetProperty("current").ValueKind);
        if (Environment.GetEnvironmentVariable("WINCHE_DENO") is not { Length: > 0 })
        {
            Assert.Contains("Deno", page.GetProperty("runtimeProblem").GetString());   // said plainly when it's missing
            return;
        }

        var refused = await client.PostAsJsonAsync("/_console/api/functions/deploy", new { files = new Dictionary<string, string> { ["index.ts"] = "export const = ;" }, note = "Broken" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("doesn't build", await refused.Content.ReadAsStringAsync());

        string Code(string greeting) => $$"""
            import { callable } from "@winche/functions";
            export const hello = callable(async (data: { name: string }, ctx) => {
              const n = (await ctx.db.query("people")).length;
              console.log("people:", n);
              return `{{greeting}} ${data.name} (${ctx.auth?.uid ?? "server"})`;
            });
            """;
        var v1 = await Json(await client.PostAsJsonAsync("/_console/api/functions/deploy", new { files = new Dictionary<string, string> { ["index.ts"] = Code("Hello") }, note = "First" }));
        Assert.Equal((1, "hello"), (v1.GetProperty("version").GetInt32(), v1.GetProperty("functions")[0].GetProperty("name").GetString()));
        await Json(await client.PostAsJsonAsync("/_console/api/functions/deploy", new { files = new Dictionary<string, string> { ["index.ts"] = Code("Hi") }, note = "Second" }));

        var run = await Json(await client.PostAsJsonAsync("/_console/api/functions/run", new { name = "hello", data = new { name = "Ann" }, asUid = "u1" }));
        Assert.Equal(("Hi Ann (u1)", "people: 0"), (run.GetProperty("result").GetString(), run.GetProperty("logs")[0].GetProperty("message").GetString()));

        await Json(await client.PostAsJsonAsync("/_console/api/functions/versions/1/rollback", new { note = (string?)null }));
        run = await Json(await client.PostAsJsonAsync("/_console/api/functions/run", new { name = "hello", data = new { name = "Ann" } }));
        Assert.Equal("Hello Ann (server)", run.GetProperty("result").GetString());
        var versions = await Json(await client.GetAsync("/_console/api/functions/versions"));
        Assert.Equal([3, 2, 1], versions.GetProperty("versions").EnumerateArray().Select(v => v.GetProperty("version").GetInt32()));

        // CI: a token with the functions scope deploys (named in the versions); it can't run functions or do anything else.
        var made = await Json(await client.PostAsJsonAsync("/_console/api/tokens", new { name = "gitlab-main", scopes = new[] { "functions" }, days = 30 }));
        using var ci = app.CreateClient();
        ci.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", made.GetProperty("secret").GetString());
        var deployed = await Json(await ci.PostAsJsonAsync("/_console/api/functions/deploy", new { files = new Dictionary<string, string> { ["index.ts"] = Code("Hey") }, note = "From CI" }));
        Assert.Equal((4, "gitlab-main (CI token by admin@example.com)"), (deployed.GetProperty("version").GetInt32(), deployed.GetProperty("by").GetString()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await ci.PostAsJsonAsync("/_console/api/functions/run", new { name = "hello" })).StatusCode);
        // Deploy keys are gone (nothing answers there: the SPA's fallback only serves GET).
        Assert.Contains((await client.PostAsync("/_console/api/functions/deploy-key", null)).StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
        Assert.Contains((await ci.PostAsJsonAsync("/functions/v1/deploy", new { files = new Dictionary<string, string>() })).StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }
}
