using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class KeycloakModeTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    private static HttpClient Bearer(KeycloakConsoleAppFactory app, string[] roles)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", KeycloakTokens.Mint(roles));
        return client;
    }

    [Fact]
    public async Task Config_endpoint_advertises_keycloak()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var cfg = await anon.GetFromJsonAsync<Dictionary<string, object>>("/_console/api/auth/config");
        Assert.Equal("keycloak", cfg!["provider"].ToString());
        Assert.Equal("https://kc.test/realms/test", cfg["authority"].ToString());
        Assert.Equal("winche-console", cfg["clientId"].ToString());
    }

    [Fact]
    public async Task Identity_only_endpoints_are_not_mapped()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        // In Keycloak mode no identity API routes are mapped. The only route matching these paths is
        // the SPA's GET catch-all, so a POST to /api/auth/login has no handler (MethodNotAllowed)...
        var login = await anon.PostAsJsonAsync("/_console/api/auth/login", new { email = "x", password = "y" });
        Assert.Equal(HttpStatusCode.MethodNotAllowed, login.StatusCode);
        // ...and a GET to /api/users falls through to the SPA (index.html, text/html) rather than a
        // real users API (which would return application/json).
        var users = await Bearer(app, ["Admin"]).GetAsync("/_console/api/users");
        Assert.Equal(HttpStatusCode.OK, users.StatusCode);
        Assert.Equal("text/html", users.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task State_projects_identity_and_role_from_token()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var client = Bearer(app, ["Member"]);
        var state = await client.GetFromJsonAsync<Dictionary<string, object>>("/_console/api/auth/state");
        Assert.Equal("keycloak", state!["provider"].ToString());
        var user = (System.Text.Json.JsonElement)state["user"];
        Assert.Equal("Member", user.GetProperty("role").GetString());
        Assert.Equal("user@test", user.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Anonymous_data_request_is_unauthorized()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var resp = await anon.GetAsync("/_console/api/database/collections");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Viewer_can_read_but_not_write()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        var read = await Bearer(app, ["Viewer"]).GetAsync("/_console/api/database/collections");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var write = await Bearer(app, ["Viewer"]).PutAsJsonAsync(
            $"/_console/api/database/documents/{B64("users/alice")}",
            new { fields = new { name = new { stringValue = "Alice" } } });
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
    }

    [Fact]
    public async Task Member_can_write()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        var write = await Bearer(app, ["Member"]).PutAsJsonAsync(
            $"/_console/api/database/documents/{B64("users/bob")}",
            new { fields = new { name = new { stringValue = "Bob" } } });
        Assert.Equal(HttpStatusCode.OK, write.StatusCode);
    }
}
