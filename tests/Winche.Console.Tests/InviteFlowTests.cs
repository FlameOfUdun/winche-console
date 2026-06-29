using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class InviteFlowTests(PostgresFixture fx)
{
    private sealed class FakeEmailSender : IConsoleEmailSender
    {
        public string? LastInviteLink;
        public Task SendPasswordResetAsync(ConsoleEmailRecipient u, string link, CancellationToken ct = default) => Task.CompletedTask;
        public Task SendInviteAsync(ConsoleEmailRecipient u, string link, CancellationToken ct = default) { LastInviteLink = link; return Task.CompletedTask; }
    }

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

    private static object InviteBody(string email, string role = "Member", bool requireName = false,
        bool requireTwoFactor = false, int expiresInHours = 72) =>
        new { email, role, requireName, requireTwoFactor, expiresInHours };

    [Fact]
    public async Task Admin_creates_invite_and_it_appears_in_the_list()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        var create = await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("invitee@example.com"));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        Assert.NotNull(fake.LastInviteLink);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("pending", created.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(created.GetProperty("link").GetString()));

        var list = await admin.GetFromJsonAsync<JsonElement>("/_console/api/invites");
        Assert.Equal(1, list.GetArrayLength());
        Assert.Equal("invitee@example.com", list[0].GetProperty("email").GetString());
    }

    [Fact]
    public async Task Invite_requires_an_email_sender()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);   // no email sender
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        var create = await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("x@example.com"));
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
    }

    [Fact]
    public async Task Non_admin_cannot_create_invites()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var anon = emailApp.CreateClient();
        await anon.SetupAdminAsync();   // creates the admin but does NOT log this client in

        var create = await anon.PostAsJsonAsync("/_console/api/invites", InviteBody("x@example.com"));
        Assert.Equal(HttpStatusCode.Unauthorized, create.StatusCode);
    }

    [Fact]
    public async Task Non_admin_role_is_forbidden_from_creating_invites()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var emailApp = WithEmail(app, new FakeEmailSender());
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();
        var created = await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "viewer@example.com", role = "Viewer", password = "View3red!" });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);

        using var viewer = emailApp.CreateClient();
        await viewer.LoginAsync("viewer@example.com", "View3red!");
        var create = await viewer.PostAsJsonAsync("/_console/api/invites", InviteBody("x@example.com"));
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task Second_invite_to_same_email_returns_conflict()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var emailApp = WithEmail(app, new FakeEmailSender());
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        var first = await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("dup@example.com"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var second = await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("dup@example.com"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Accept_creates_a_user_who_can_sign_in()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("invitee@example.com"));
        var token = QueryParam(fake.LastInviteLink!, "token");

        using var anon = emailApp.CreateClient();
        var preview = await anon.GetFromJsonAsync<JsonElement>($"/_console/api/invites/accept?token={Uri.EscapeDataString(token)}");
        Assert.Equal("invitee@example.com", preview.GetProperty("email").GetString());

        var accept = await anon.PostAsJsonAsync("/_console/api/invites/accept",
            new { token, password = "Inv1ted!" });
        Assert.Equal(HttpStatusCode.OK, accept.StatusCode);

        using var invitee = emailApp.CreateClient();
        await invitee.LoginAsync("invitee@example.com", "Inv1ted!");

        // Accepted invite drops off the admin list.
        var list = await admin.GetFromJsonAsync<JsonElement>("/_console/api/invites");
        Assert.Equal(0, list.GetArrayLength());
    }

    [Fact]
    public async Task Accept_enforces_required_name()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("named@example.com", requireName: true));
        var token = QueryParam(fake.LastInviteLink!, "token");

        using var anon = emailApp.CreateClient();
        var missing = await anon.PostAsJsonAsync("/_console/api/invites/accept", new { token, password = "Inv1ted!" });
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);

        var ok = await anon.PostAsJsonAsync("/_console/api/invites/accept",
            new { token, password = "Inv1ted!", firstName = "Ann", lastName = "Vee" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public async Task Accept_sets_two_factor_required()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("tf@example.com", requireTwoFactor: true));
        var token = QueryParam(fake.LastInviteLink!, "token");

        using var invitee = emailApp.CreateClient();
        await invitee.PostAsJsonAsync("/_console/api/invites/accept", new { token, password = "Inv1ted!" });
        await invitee.LoginAsync("tf@example.com", "Inv1ted!");

        var state = await invitee.GetFromJsonAsync<JsonElement>("/_console/api/auth/state");
        Assert.True(state.GetProperty("user").GetProperty("mustSetupTwoFactor").GetBoolean());
    }

    private static async Task<Guid> CreateInviteAsync(HttpClient admin, string email)
    {
        var resp = await admin.PostAsJsonAsync("/_console/api/invites", InviteBody(email));
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("id").GetGuid();
    }

    [Fact]
    public async Task Copy_link_returns_a_working_token()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();
        var id = await CreateInviteAsync(admin, "copy@example.com");

        var link = await admin.GetFromJsonAsync<JsonElement>($"/_console/api/invites/{id}/link");
        var token = QueryParam(link.GetProperty("link").GetString()!, "token");

        using var anon = emailApp.CreateClient();
        var preview = await anon.GetAsync($"/_console/api/invites/accept?token={Uri.EscapeDataString(token)}");
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
    }

    [Fact]
    public async Task Revoke_blocks_acceptance()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();
        await admin.PostAsJsonAsync("/_console/api/invites", InviteBody("revoke@example.com"));
        var token = QueryParam(fake.LastInviteLink!, "token");
        var list = await admin.GetFromJsonAsync<JsonElement>("/_console/api/invites");
        var id = list[0].GetProperty("id").GetGuid();

        var revoke = await admin.DeleteAsync($"/_console/api/invites/{id}");
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        using var anon = emailApp.CreateClient();
        var accept = await anon.PostAsJsonAsync("/_console/api/invites/accept", new { token, password = "Inv1ted!" });
        Assert.Equal(HttpStatusCode.Gone, accept.StatusCode);
    }

    [Fact]
    public async Task Resend_issues_a_working_link()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        var fake = new FakeEmailSender();
        using var emailApp = WithEmail(app, fake);
        using var admin = emailApp.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();
        var id = await CreateInviteAsync(admin, "resend@example.com");

        var resend = await admin.PostAsJsonAsync($"/_console/api/invites/{id}/resend", new { });
        Assert.Equal(HttpStatusCode.OK, resend.StatusCode);
        var token = QueryParam(fake.LastInviteLink!, "token");

        using var anon = emailApp.CreateClient();
        var accept = await anon.PostAsJsonAsync("/_console/api/invites/accept", new { token, password = "Inv1ted!" });
        Assert.Equal(HttpStatusCode.OK, accept.StatusCode);
    }
}
