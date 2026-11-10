using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Winche.Rules;
using Winche.Rules.Json;
using Winche.Rules.Text;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>The rules editor's text form: api/rules/text/parse and api/rules/text/format.</summary>
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

    [Fact]
    public async Task Parse_returns_the_expression_json()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        const string text = "request.auth.uid == uid && request.resource.data.keys().hasOnly(['name'])";

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse", new { text }));

        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.Equal(RuleText.Parse(text), RuleJson.DeserializeExpr(body.GetProperty("expressionJson").GetString()!));
        Assert.Equal(0, body.GetProperty("warnings").GetArrayLength());
    }

    [Fact]
    public async Task Parse_reports_where_the_text_is_wrong()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse", new { text = "a ==\n  (b" }));

        Assert.False(body.GetProperty("ok").GetBoolean());
        var error = body.GetProperty("error");
        Assert.Equal("Expected ')' but the condition ended", error.GetProperty("message").GetString());
        Assert.Equal((2, 5), (error.GetProperty("line").GetInt32(), error.GetProperty("column").GetInt32()));
    }

    [Fact]
    public async Task Parse_warns_about_a_misspelled_function()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/parse",
            new { text = "request.resource.data.keys().hasonly(['a'])" }));

        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.Equal("Unknown function 'hasonly' — it will always deny.", body.GetProperty("warnings")[0].GetString());
    }

    [Fact]
    public async Task Format_writes_the_text()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        var json = RuleJson.Serialize(RuleText.Parse("!('role' in request.resource.data.diff(resource.data).affectedKeys())"));

        var body = await Json(await client.PostAsJsonAsync("/_console/api/rules/text/format", new { expressionJson = json }));

        Assert.Equal("!('role' in request.resource.data.diff(resource.data).affectedKeys())", body.GetProperty("text").GetString());
        var bad = await client.PostAsJsonAsync("/_console/api/rules/text/format", new { expressionJson = "{ nope" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task A_rule_written_as_text_simulates_with_the_new_functions()
    {
        var (app, client) = await AdminAsync();
        using var _ = app;
        var rules = RuleSetBuilder.Build(r => r.Match("profiles/{uid}", b => b.Allow([RuleOperation.Create],
            RuleText.Parse("request.auth.uid == uid && request.resource.data.keys().hasOnly(['name']) && request.resource.data.name is string"))));

        async Task<bool> Allowed(params (string K, RuleValue V)[] fields)
        {
            var data = RuleValue.Map(fields.ToDictionary(f => f.K, f => f.V));
            var request = RuleValue.Map(new Dictionary<string, RuleValue>
            {
                ["auth"] = RuleValue.Map(new Dictionary<string, RuleValue> { ["uid"] = RuleValue.String("u1") }),
                ["resource"] = RuleValue.Map(new Dictionary<string, RuleValue> { ["data"] = data }),
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

        Assert.True(await Allowed(("name", RuleValue.String("Ann"))));
        Assert.False(await Allowed(("name", RuleValue.String("Ann")), ("role", RuleValue.String("admin"))));
        Assert.False(await Allowed(("name", RuleValue.Int(1))));
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
