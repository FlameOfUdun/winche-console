using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleTabsApiTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task CreateUserAsync(ConsoleAppFactory app, string email, string role)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ConsoleUser>>();
        var user = new ConsoleUser { UserName = email, Email = email, EmailConfirmed = true, Active = true };
        await users.CreateAsync(user, "Passw0rd!");
        await users.AddToRoleAsync(user, role);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r) =>
        JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task Nav_hides_tab_from_viewer_shows_to_member()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync();
        await CreateUserAsync(app, "viewer@example.com", ConsoleRoles.Viewer);
        await CreateUserAsync(app, "member@example.com", ConsoleRoles.Member);

        using var viewer = app.CreateClient(); await viewer.LoginAsync("viewer@example.com", "Passw0rd!");
        Assert.Empty((await Json(await viewer.GetAsync("/_console/api/tabs"))).GetProperty("tabs").EnumerateArray());

        using var member = app.CreateClient(); await member.LoginAsync("member@example.com", "Passw0rd!");
        var ids = (await Json(await member.GetAsync("/_console/api/tabs"))).GetProperty("tabs")
            .EnumerateArray().Select(t => t.GetProperty("id").GetString());
        Assert.Contains("analytics", ids);
    }

    [Fact]
    public async Task Layout_returns_tree_and_data_forbids_viewer_serves_member()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync();
        await CreateUserAsync(app, "viewer@example.com", ConsoleRoles.Viewer);
        await CreateUserAsync(app, "member@example.com", ConsoleRoles.Member);

        using var viewer = app.CreateClient(); await viewer.LoginAsync("viewer@example.com", "Passw0rd!");
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync("/_console/api/tabs/analytics")).StatusCode);

        using var member = app.CreateClient(); await member.LoginAsync("member@example.com", "Passw0rd!");
        var layout = await Json(await member.GetAsync("/_console/api/tabs/analytics"));
        Assert.Equal("filter", layout.GetProperty("root").GetProperty("type").GetString());

        var data = await member.PostAsJsonAsync("/_console/api/tabs/analytics/data",
            new { widgetIds = new[] { "kpis" }, filters = new Dictionary<string, string> { ["range"] = "30 days" } });
        Assert.Equal(HttpStatusCode.OK, data.StatusCode);
        var kpis = (await Json(data)).GetProperty("widgets").GetProperty("kpis").GetProperty("stats");
        Assert.Equal(5136, kpis[0].GetProperty("value").GetInt32());
    }

    [Fact]
    public async Task Data_isolates_a_throwing_widget_handler()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync();
        await CreateUserAsync(app, "member@example.com", ConsoleRoles.Member);
        using var member = app.CreateClient(); await member.LoginAsync("member@example.com", "Passw0rd!");

        var resp = await member.PostAsJsonAsync("/_console/api/tabs/analytics/data",
            new { widgetIds = new[] { "kpis", "boom" }, filters = new Dictionary<string, string>() });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var widgets = (await Json(resp)).GetProperty("widgets");
        Assert.Equal(JsonValueKind.Null, widgets.GetProperty("boom").ValueKind);        // failed widget -> null
        Assert.NotEqual(JsonValueKind.Null, widgets.GetProperty("kpis").ValueKind);      // sibling still returned
    }

    [Fact]
    public async Task Data_requires_authentication()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var resp = await anon.PostAsJsonAsync("/_console/api/tabs/analytics/data", new { widgetIds = new[] { "kpis" } });
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
