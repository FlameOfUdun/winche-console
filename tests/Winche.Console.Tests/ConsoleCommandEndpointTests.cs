using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleCommandEndpointTests(PostgresFixture fx) : IAsyncLifetime
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

    // POST with the CSRF header set (cookie-mode requests must carry it).
    private static Task<HttpResponseMessage> PostAsync(HttpClient client, string url, object body, bool header = true)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (header) req.Headers.Add("X-Winche-Console", "1");
        return client.SendAsync(req);
    }

    [Fact]
    public async Task Admin_with_valid_input_returns_ok()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();

        var resp = await PostAsync(admin, "/_console/api/tabs/ops/commands/echo",
            new { input = new { name = "hi" }, inputs = new Dictionary<string, string>() });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await Json(resp);
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("echo:hi", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Member_below_command_min_role_is_forbidden()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();
        await CreateUserAsync(app, "member@example.com", ConsoleRoles.Member);
        using var member = app.CreateClient(); await member.LoginAsync("member@example.com", "Passw0rd!");

        var resp = await PostAsync(member, "/_console/api/tabs/ops/commands/echo",
            new { input = new { name = "hi" }, inputs = new Dictionary<string, string>() });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Unknown_command_returns_not_found()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();

        var resp = await PostAsync(admin, "/_console/api/tabs/ops/commands/nope",
            new { inputs = new Dictionary<string, string>() });
        // No POST route is registered for an unknown command id. The console's SPA fallback
        // (group.MapGet("/{**path}")) matches the path for GET, so an unmatched POST surfaces as
        // 405 MethodNotAllowed rather than 404 — either way the request never reaches a handler.
        Assert.Equal(HttpStatusCode.MethodNotAllowed, resp.StatusCode);
    }

    [Fact]
    public async Task Invalid_input_returns_invalid_with_field_errors()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();

        var resp = await PostAsync(admin, "/_console/api/tabs/ops/commands/echo",
            new { input = new { }, inputs = new Dictionary<string, string>() });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await Json(resp);
        Assert.Equal("invalid", body.GetProperty("status").GetString());
        Assert.True(body.GetProperty("fieldErrors").TryGetProperty("name", out _));
    }

    [Fact]
    public async Task Missing_csrf_header_returns_bad_request()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();

        var resp = await PostAsync(admin, "/_console/api/tabs/ops/commands/echo",
            new { input = new { name = "hi" }, inputs = new Dictionary<string, string>() }, header: false);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Row_command_receives_row_key()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();

        var resp = await PostAsync(admin, "/_console/api/tabs/ops/commands/remove",
            new { rowKey = "a", inputs = new Dictionary<string, string>() });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await Json(resp);
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("removed:a", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Manifest_exposes_command_form()
    {
        await fx.ResetAuthAsync(); await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient(); await admin.SetupAdminAsync(); await admin.LoginAsync();

        var layout = await Json(await admin.GetAsync("/_console/api/tabs/ops"));
        var echo = layout.GetProperty("commands").GetProperty("echo");
        var form = echo.GetProperty("form");
        Assert.Equal("name", form[0].GetProperty("key").GetString());
    }
}
