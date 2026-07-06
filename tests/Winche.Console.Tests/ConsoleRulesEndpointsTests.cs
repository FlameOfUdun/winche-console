using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Winche.Database.Constants;
using Winche.Rules;
using Winche.Rules.Expressions;
using Winche.Rules.Json;
using Winche.Storage.Constants;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>
/// Integration tests for the <c>api/rules/*</c> endpoints (see <c>ConsoleRulesEndpoints</c>), exercised
/// against the sample host wired with both <c>UseDatabaseRulesEditor</c> and <c>UseStorageRulesEditor</c>
/// (see <c>tests/SampleHost/Program.cs</c>), whose rules-version store reuses the console's connection
/// string (the auth database). Covers Admin-only gating, validation, save + hot-swap of the keyed live
/// repository, version history + revert, and optimistic concurrency.
/// </summary>
[Collection("postgres")]
public class ConsoleRulesEndpointsTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetRulesAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static RuleSet DocsAllowRead() =>
        RuleSetBuilder.Build(root => root.Match("docs/{id}", m => m.Allow(RuleOperations.Read, Expr.Const(true))));

    private static RuleSet DocsAllowWrite() =>
        RuleSetBuilder.Build(root => root.Match("docs/{id}", m => m.Allow(RuleOperations.Write, Expr.Const(true))));

    private static RuleSet FilesAllowRead() =>
        RuleSetBuilder.Build(root => root.Match("files/{id}", m => m.Allow(RuleOperations.Read, Expr.Const(true))));

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private static async Task CreateUserAsync(ConsoleAppFactory app, string email, string role)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ConsoleUser>>();
        var user = new ConsoleUser { UserName = email, Email = email, EmailConfirmed = true, Active = true };
        await users.CreateAsync(user, "Passw0rd!");
        await users.AddToRoleAsync(user, role);
    }

    [Fact]
    public async Task Anonymous_GetSubsystems_ReturnsUnauthorized()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var anon = app.CreateClient();

        var resp = await anon.GetAsync("/_console/api/rules/subsystems");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Viewer_GetSubsystems_ReturnsForbidden()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        await CreateUserAsync(app, "viewer@example.com", ConsoleRoles.Viewer);

        using var viewer = app.CreateClient();
        await viewer.LoginAsync("viewer@example.com", "Passw0rd!");

        var resp = await viewer.GetAsync("/_console/api/rules/subsystems");

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Validate_MalformedJson_ReturnsStructuredErrors()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var resp = await client.PostAsJsonAsync("/_console/api/rules/database/validate", new { rulesJson = "{ not json" });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await ReadJsonAsync(resp);
        Assert.False(body.GetProperty("ok").GetBoolean());
        Assert.True(body.GetProperty("errors").GetArrayLength() > 0);
    }

    [Fact]
    public async Task Validate_ValidEmptyRuleset_ReturnsOk()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var resp = await client.PostAsJsonAsync("/_console/api/rules/database/validate", new { rulesJson = "{\"matches\":[]}" });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await ReadJsonAsync(resp);
        Assert.True(body.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task Save_PersistsAndHotSwapsLiveRepository()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var ruleSet = DocsAllowRead();
        var json = RuleJson.Serialize(ruleSet);

        var save = await client.PostAsJsonAsync("/_console/api/rules/database",
            new { rulesJson = json, note = (string?)"initial", expectedHeadVersion = (int?)null });
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        var live = await client.GetAsync("/_console/api/rules/database/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        var liveRuleSet = RuleJson.DeserializeRuleSet((await ReadJsonAsync(live)).GetProperty("rulesJson").GetString()!);
        Assert.Equal(ruleSet, liveRuleSet);

        var repo = app.Services.GetRequiredKeyedService<IMutableRuleSetRepository>(WincheDatabaseKeys.RuleEngine);
        Assert.Equal(ruleSet, repo.Current);
    }

    [Fact]
    public async Task Versions_ListsNewestFirst_AndRevertRestoresOldContentAsNewHead()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var v1Rules = DocsAllowRead();
        var save1 = await client.PostAsJsonAsync("/_console/api/rules/database",
            new { rulesJson = RuleJson.Serialize(v1Rules), note = (string?)"v1", expectedHeadVersion = (int?)null });
        Assert.Equal(HttpStatusCode.OK, save1.StatusCode);
        var v1Version = (await ReadJsonAsync(save1)).GetProperty("version").GetInt32();

        var v2Rules = DocsAllowWrite();
        var save2 = await client.PostAsJsonAsync("/_console/api/rules/database",
            new { rulesJson = RuleJson.Serialize(v2Rules), note = (string?)"v2", expectedHeadVersion = (int?)v1Version });
        Assert.Equal(HttpStatusCode.OK, save2.StatusCode);
        var v2Version = (await ReadJsonAsync(save2)).GetProperty("version").GetInt32();

        var versionsResp = await client.GetAsync("/_console/api/rules/database/versions");
        Assert.Equal(HttpStatusCode.OK, versionsResp.StatusCode);
        var versions = (await ReadJsonAsync(versionsResp)).EnumerateArray().ToList();
        Assert.Equal(2, versions.Count);
        Assert.Equal(v2Version, versions[0].GetProperty("version").GetInt32());
        Assert.True(versions[0].GetProperty("isActive").GetBoolean());
        Assert.Equal(v1Version, versions[1].GetProperty("version").GetInt32());
        Assert.False(versions[1].GetProperty("isActive").GetBoolean());

        var revert = await client.PostAsync($"/_console/api/rules/database/revert/{v1Version}", content: null);
        Assert.Equal(HttpStatusCode.OK, revert.StatusCode);
        var revertBody = await ReadJsonAsync(revert);
        var v3Version = revertBody.GetProperty("version").GetInt32();
        Assert.True(v3Version > v2Version);
        Assert.True(revertBody.GetProperty("isActive").GetBoolean());
        Assert.Equal(v1Version, revertBody.GetProperty("revertedFromVersion").GetInt32());

        var live = await client.GetAsync("/_console/api/rules/database/live");
        var liveRuleSet = RuleJson.DeserializeRuleSet((await ReadJsonAsync(live)).GetProperty("rulesJson").GetString()!);
        Assert.Equal(v1Rules, liveRuleSet);
    }

    [Fact]
    public async Task Save_WithStaleExpectedHeadVersion_Returns409()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var save1 = await client.PostAsJsonAsync("/_console/api/rules/database",
            new { rulesJson = RuleJson.Serialize(DocsAllowRead()), note = (string?)null, expectedHeadVersion = (int?)null });
        Assert.Equal(HttpStatusCode.OK, save1.StatusCode);

        var stale = await client.PostAsJsonAsync("/_console/api/rules/database",
            new { rulesJson = RuleJson.Serialize(DocsAllowWrite()), note = (string?)null, expectedHeadVersion = (int?)999 });

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task Storage_Validate_And_Save_HotSwapsLiveRepository()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var validate = await client.PostAsJsonAsync("/_console/api/rules/storage/validate", new { rulesJson = "{\"matches\":[]}" });
        Assert.Equal(HttpStatusCode.OK, validate.StatusCode);
        Assert.True((await ReadJsonAsync(validate)).GetProperty("ok").GetBoolean());

        var ruleSet = FilesAllowRead();
        var save = await client.PostAsJsonAsync("/_console/api/rules/storage",
            new { rulesJson = RuleJson.Serialize(ruleSet), note = (string?)null, expectedHeadVersion = (int?)null });
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        var repo = app.Services.GetRequiredKeyedService<IMutableRuleSetRepository>(WincheStorageKeys.RULE_ENGINE_KEY);
        Assert.Equal(ruleSet, repo.Current);
    }

    // Not covered: 404 for a subsystem whose UseXRulesEditor was never called. The shared
    // ConsoleAppFactory harness (see tests/SampleHost/Program.cs) enables both the database and
    // storage rules editors so the other tests here — and RoleGatingTests/ConsoleDataApiTests/etc.,
    // which reuse the same factory — keep working. Booting a one-subsystem-disabled variant would
    // require either a second WebApplicationFactory subclass or an environment-driven toggle in the
    // sample host purely for this one assertion, which contorts the shared harness for a single 404
    // check that FindRegistration's null-check (exercised implicitly by every {sys} route above)
    // already covers at the unit level.
}
