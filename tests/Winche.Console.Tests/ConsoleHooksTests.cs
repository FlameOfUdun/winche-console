using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>The Hooks page: hooks saved with a reason, signing secrets, a test send, the delivery log.</summary>
[Collection("postgres")]
public class ConsoleHooksTests(PostgresFixture fx) : IAsyncLifetime
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
              IF to_regclass('winche_hook_deliveries') IS NOT NULL THEN TRUNCATE winche_hook_deliveries; END IF;
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

    private static async Task<(WebApplication App, string Url, List<(string Signature, string Body)> Got)> ReceiverAsync()
    {
        var b = WebApplication.CreateBuilder();
        b.WebHost.UseUrls("http://127.0.0.1:0");
        b.Logging.ClearProviders();
        var app = b.Build();
        var got = new List<(string, string)>();
        app.MapPost("/hook", async (HttpRequest r) =>
        {
            var body = await new StreamReader(r.Body).ReadToEndAsync();
            lock (got) got.Add((r.Headers["Winche-Signature"].ToString(), body));
            return Results.Ok("thanks");
        });
        await app.StartAsync();
        return (app, app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First().TrimEnd('/') + "/hook", got);
    }

    [Fact]
    public async Task Hooks_are_set_up_tested_and_their_deliveries_listed()
    {
        var (receiver, url, got) = await ReceiverAsync();
        await using var _ = receiver;
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var state = await Json(await client.GetAsync("/_console/api/auth/state"));
        Assert.True(state.GetProperty("capabilities").GetProperty("hooks").GetBoolean());
        var page = await Json(await client.GetAsync("/_console/api/hooks"));
        Assert.Equal(["database", "storage", "auth"], page.GetProperty("sources").EnumerateArray().Select(s => s.GetProperty("name").GetString()));
        Assert.Equal(["database.deleteDocuments", "functions.run", "storage.deleteFiles", "auth.setClaims"], page.GetProperty("actions").EnumerateArray().Select(a => a.GetProperty("name").GetString()));

        var webhook = new
        {
            id = "visits", name = "New visits", enabled = true,
            when = new { source = "database", events = new[] { "created" }, path = "patients/{patientId}" },
            @do = new { kind = "webhook", url },
        };
        var bad = new { id = "x", name = "Bad", enabled = true, when = new { source = "auth", events = Array.Empty<string>(), path = (string?)null },
            @do = new { kind = "storage.deleteFiles", options = new Dictionary<string, string> { ["folder"] = "patients/{patientId}/" } } };
        var refused = await client.PutAsJsonAsync("/_console/api/hooks", new { settings = new { hooks = new object[] { webhook, bad } }, reason = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("{patientId}, which this trigger doesn't provide", await refused.Content.ReadAsStringAsync());

        await Json(await client.PutAsJsonAsync("/_console/api/hooks", new { settings = new { hooks = new object[] { webhook } }, reason = "Tell the ward system" }));
        var secret = (await Json(await client.GetAsync("/_console/api/hooks/visits/secret"))).GetProperty("secret").GetString()!;
        Assert.StartsWith("whsec_", secret);

        var test = await Json(await client.PostAsJsonAsync("/_console/api/hooks/test", new { hook = webhook }));
        Assert.True(test.GetProperty("ok").GetBoolean());
        Assert.Equal(200, test.GetProperty("status").GetInt32());
        Assert.Equal("example-patientId", test.GetProperty("sample").GetProperty("vars").GetProperty("patientId").GetString());
        var (signature, body) = got.Single();
        Assert.True(Winche.Webhooks.WebhookSignature.Verify(secret, signature, body));   // signed with the secret the console shows

        // A real change goes through the queue and shows in the log.
        await app.Services.GetRequiredService<Winche.Database.Runtime.DocumentDatabase>().WriteAsync(
            [new Winche.Database.Runtime.Writes.SetWrite { Path = "patients/p1", Fields = new Dictionary<string, Winche.Database.Values.Value> { ["ward"] = new Winche.Database.Values.StringValue("A3") } }]);
        JsonElement deliveries = default;
        for (var i = 0; i < 100; i++)
        {
            deliveries = (await Json(await client.GetAsync("/_console/api/hooks/deliveries?hookId=visits"))).GetProperty("deliveries");
            if (deliveries.GetArrayLength() > 0 && deliveries[0].GetProperty("status").GetString() == "delivered") break;
            await Task.Delay(100);
        }
        Assert.Equal(("delivered", "p1"), (deliveries[0].GetProperty("status").GetString(), deliveries[0].GetProperty("event").GetProperty("vars").GetProperty("patientId").GetString()));
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/_console/api/hooks/deliveries/{deliveries[0].GetProperty("id").GetString()}/retry", null)).StatusCode);
    }
}
