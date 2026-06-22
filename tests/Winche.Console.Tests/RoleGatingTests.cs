using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class RoleGatingTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    private static async Task CreateUserAsync(ConsoleAppFactory app, string email, string role)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ConsoleUser>>();
        var user = new ConsoleUser { UserName = email, Email = email, EmailConfirmed = true, Active = true };
        await users.CreateAsync(user, "Passw0rd!");
        await users.AddToRoleAsync(user, role);
    }

    [Fact]
    public async Task Viewer_can_read_but_not_write()
    {
        await fx.ResetAuthAsync();
        await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();               // first user = Admin
        await CreateUserAsync(app, "viewer@example.com", ConsoleRoles.Viewer);

        using var viewer = app.CreateClient();
        await viewer.LoginAsync("viewer@example.com", "Passw0rd!");

        var read = await viewer.GetAsync("/_console/api/usage");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var write = await viewer.PutAsJsonAsync($"/_console/api/data/documents/{B64("users/alice")}",
            new { fields = new { name = new { stringValue = "Alice" } } });
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
    }

    [Fact]
    public async Task Member_can_write()
    {
        await fx.ResetAuthAsync();
        await fx.ResetAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        await CreateUserAsync(app, "member@example.com", ConsoleRoles.Member);

        using var member = app.CreateClient();
        await member.LoginAsync("member@example.com", "Passw0rd!");
        var write = await member.PutAsJsonAsync($"/_console/api/data/documents/{B64("users/bob")}",
            new { fields = new { name = new { stringValue = "Bob" } } });
        Assert.Equal(HttpStatusCode.OK, write.StatusCode);
    }

    [Fact]
    public async Task Anonymous_is_unauthorized()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var resp = await anon.GetAsync("/_console/api/usage");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
