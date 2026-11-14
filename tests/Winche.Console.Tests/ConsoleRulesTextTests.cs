using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Winche.Rules;
using Winche.Rules.Json;
using Winche.Rules.Text;
using Xunit;
using Winche.Values;

namespace Winche.Console.Tests;

/// <summary>The rules file the editor uses: api/rules/text/parse and api/rules/text/format.</summary>
[Collection("postgres")]
public class ConsoleRulesTextTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => fx.ResetAuthAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<JsonElement> Json(HttpResponseMessage resp)
    {
        resp.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private async Task<(ConsoleAppFactory App, HttpClient Client)> AdminAsync()
    {
        var app = new ConsoleAppFactory(fx);
        var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        return (app, client);
    }

    private const string File = """
        match profiles/{uid} {
          allow create: if request.auth.uid == uid
            && request.resource.data.keys().hasOnly(['name'])
            && request.resource.data.name is string;
        }
        """;

    [Fact]
    public async Task Parse_returns_the_rules_json()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse", new { text = File }));

        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.Equal(RuleText.ParseRuleSet(File), RuleJson.DeserializeRuleSet(body.GetProperty("rulesJson").GetString()!));
        Assert.Equal(0, body.GetProperty("warnings").GetArrayLength());
    }

    [Fact]
    public async Task Parse_knows_functions_and_paths_and_formats_them_back()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        const string text = """
            function isOwner(uid) {
              return request.auth.uid == uid;
            }

            match users/{uid} {
              allow get: if isOwner(uid) || get(/admins/$(request.auth.uid)).active == true;
              allow update: if isOwner(uid) && changes only ['name'] && typo();
            }

            """;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse", new { text }));
        Assert.True(body.GetProperty("ok").GetBoolean());
        var warning = Assert.Single(body.GetProperty("warnings").EnumerateArray());   // the file's own function isn't one
        Assert.Contains("'typo'", warning.GetString());

        var formatted = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/format",
            new { rulesJson = body.GetProperty("rulesJson").GetString() }));
        Assert.Equal(text.Replace("\r\n", "\n"), formatted.GetProperty("text").GetString());
    }

    [Fact]
    public async Task Parse_reports_where_the_file_is_wrong()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse",
            new { text = "match users/{uid} {\n  allow read: if request.auth = null;\n}" }));

        Assert.False(body.GetProperty("ok").GetBoolean());
        var error = body.GetProperty("error");
        Assert.Equal("Use '==' to compare", error.GetProperty("message").GetString());
        Assert.Equal((2, 31), (error.GetProperty("line").GetInt32(), error.GetProperty("column").GetInt32()));
    }

    [Fact]
    public async Task Parse_warns_about_a_misspelled_function()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse",
            new { text = "match a/{b} {\n  allow create: if request.resource.data.keys().hasonly(['a']);\n}" }));

        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.Equal("Unknown function 'hasonly' — it will always deny.", body.GetProperty("warnings")[0].GetString());
    }

    [Fact]
    public async Task Parse_warns_about_resource_data_in_list_rules()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse", new
        {
            text = "match a/{id} {\n  allow read: if resource.data.owner == request.auth.uid;\n  allow update: if resource.data.owner == request.auth.uid;\n}\n" +
                   "match b/{id} {\n  allow get: if resource.data.x == 1;\n}",
        }));

        var warnings = body.GetProperty("warnings").EnumerateArray().Select(w => w.GetString()!).ToList();
        var warning = Assert.Single(warnings);   // a/{id} allows list; b/{id} only get
        Assert.StartsWith("match a/{id}: in a rule that allows list", warning);
    }

    [Fact]
    public async Task Format_writes_the_file()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        var rulesJson = RuleJson.Serialize(RuleText.ParseRuleSet(File));

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/format", new { rulesJson }));

        Assert.Equal(RuleText.ParseRuleSet(File), RuleText.ParseRuleSet(body.GetProperty("text").GetString()!));
        var bad = await client.PostAsJsonAsync("/_console/api/rules/text/format", new { rulesJson = "{ nope" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task A_rule_written_as_text_simulates_with_the_new_functions()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        var rules = RuleText.ParseRuleSet(File);

        async Task<bool> Allowed(params (string K, Value V)[] fields)
        {
            var data = new MapValue(fields.ToDictionary(f => f.K, f => f.V));
            var request = new MapValue(new Dictionary<string, Value>
            {
                ["auth"] = new MapValue(new Dictionary<string, Value> { ["uid"] = new StringValue("u1") }),
                ["resource"] = new MapValue(new Dictionary<string, Value> { ["data"] = data }),
            });
            var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/database/simulate", new
            {
                rulesJson = RuleJson.Serialize(rules),
                operation = "Create",
                documentPath = "profiles/u1",
                requestJson = JsonSerializer.Serialize(request, RuleJson.Options),
            }));
            return body.GetProperty("allowed").GetBoolean();
        }

        Assert.True(await Allowed(("name", new StringValue("Ann"))));
        Assert.False(await Allowed(("name", new StringValue("Ann")), ("role", new StringValue("admin"))));
        Assert.False(await Allowed(("name", new IntegerValue(1))));
    }

    [Fact]
    public async Task A_structured_simulation_sees_auth_resource_and_the_incoming_data_as_a_real_call_does()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        var rules = RuleText.ParseRuleSet("""
            match /posts/{postId} {
              allow update: if request.auth.uid == resource.data.owner && request.auth.token.email_verified == true
                && request.resource.data.likes is int && request.method == 'update' && resource.id == postId;
            }
            """);

        async Task<bool> Allowed(object? auth, object? existing, object? incoming)
        {
            var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/database/simulate", new
            {
                rulesJson = RuleJson.Serialize(rules), operation = "Update", documentPath = "posts/p1", structured = true,
                auth, existing, incoming,
            }));
            return body.GetProperty("allowed").GetBoolean();
        }

        var ann = new { uid = "ann", claims = new Dictionary<string, object> { ["email_verified"] = true } };
        var owned = new Dictionary<string, object> { ["owner"] = "ann" };
        var likes = new Dictionary<string, object> { ["likes"] = new Dictionary<string, string> { ["$integer"] = "3" } };
        Assert.True(await Allowed(ann, owned, likes));
        Assert.False(await Allowed(null, owned, likes));                                                   // signed out
        Assert.False(await Allowed(new { uid = "bob", claims = new Dictionary<string, object> { ["email_verified"] = true } }, owned, likes));
        Assert.False(await Allowed(new { uid = "ann", claims = new Dictionary<string, object>() }, owned, likes));   // not verified
        Assert.False(await Allowed(ann, owned, new Dictionary<string, object> { ["likes"] = "3" }));         // text, not a number
        Assert.False(await Allowed(ann, null, likes));                                                     // nothing there
    }

    [Fact]
    public async Task Text_endpoints_need_an_admin()
    {
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        var resp = await client.PostAsJsonAsync("/_console/api/rules/text/parse", new { text = "true" });
        Assert.True(resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);
    }
}
