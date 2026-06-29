using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class EmailFlowTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Task.CompletedTask;

    private sealed class FakeEmailSender : IConsoleEmailSender
    {
        public string? LastResetLink;
        public string? LastInviteLink;
        public Task SendPasswordResetAsync(ConsoleEmailRecipient u, string link, CancellationToken ct = default) { LastResetLink = link; return Task.CompletedTask; }
        public Task SendInviteAsync(ConsoleEmailRecipient u, string link, CancellationToken ct = default) { LastInviteLink = link; return Task.CompletedTask; }
    }

    private sealed record UserItem(string Id, string Email);

    private static WebApplicationFactory<Program> WithEmail(ConsoleAppFactory app, FakeEmailSender fake) =>
        app.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IConsoleEmailSender>(fake)));

    private static string QueryParam(string url, string key)
    {
        var query = new Uri(url).Query.TrimStart('?');
        foreach (var pair in query.Split('&'))
        {
            var kv = pair.Split('=', 2);
            if (kv.Length == 2 && kv[0] == key) return Uri.UnescapeDataString(kv[1]);
        }
        return "";
    }

    [Fact]
    public async Task Forgot_password_emails_a_working_reset_link()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var client = emailApp.CreateClient();
        await client.SetupAdminAsync();

        var state = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/_console/api/auth/state");
        Assert.True(state.GetProperty("selfServiceResetEnabled").GetBoolean());

        var forgot = await client.PostAsJsonAsync("/_console/api/auth/forgot-password", new { email = "admin@example.com" });
        Assert.Equal(HttpStatusCode.OK, forgot.StatusCode);
        Assert.NotNull(fake.LastResetLink);

        var token = QueryParam(fake.LastResetLink!, "token");
        var email = QueryParam(fake.LastResetLink!, "email");
        var reset = await client.PostAsJsonAsync("/_console/api/auth/reset-password",
            new { email, token, newPassword = "Reset3d!" });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        using var fresh = emailApp.CreateClient();
        await fresh.LoginAsync("admin@example.com", "Reset3d!");
    }

    [Fact]
    public async Task Direct_create_requires_a_password()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        // No password → rejected even when email is configured (invites now go through /api/invites).
        var noPwd = await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "invitee@example.com", role = "Member" });
        Assert.Equal(HttpStatusCode.BadRequest, noPwd.StatusCode);

        // With a password → created.
        var withPwd = await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "invitee@example.com", role = "Member", password = "Inv1ted!" });
        Assert.Equal(HttpStatusCode.OK, withPwd.StatusCode);

        using var invitee = emailApp.CreateClient();
        await invitee.LoginAsync("invitee@example.com", "Inv1ted!");
    }

    [Fact]
    public async Task Email_features_are_off_without_an_adapter()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);   // no email sender registered
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();

        var state = await admin.GetFromJsonAsync<System.Text.Json.JsonElement>("/_console/api/auth/state");
        Assert.False(state.GetProperty("selfServiceResetEnabled").GetBoolean());

        var forgot = await admin.PostAsJsonAsync("/_console/api/auth/forgot-password", new { email = "admin@example.com" });
        Assert.Equal(HttpStatusCode.NotFound, forgot.StatusCode);

        var reset = await admin.PostAsJsonAsync("/_console/api/auth/reset-password",
            new { email = "admin@example.com", token = "x", newPassword = "y" });
        Assert.Equal(HttpStatusCode.NotFound, reset.StatusCode);

        await admin.LoginAsync();
        // Direct create without a password is always rejected (invites go through /api/invites).
        var invite = await admin.PostAsJsonAsync("/_console/api/users", new { email = "x@example.com", role = "Viewer" });
        Assert.Equal(HttpStatusCode.BadRequest, invite.StatusCode);
    }
}
