using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class UserManagementTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Task.CompletedTask;

    private sealed record UserItem(string Id, string Email, string? Role, bool Active, bool TwoFactorRequired, bool LockedOut);

    private static async Task<HttpClient> AdminClient(ConsoleAppFactory app)
    {
        var c = app.CreateClient();
        await c.SetupAdminAsync();
        await c.LoginAsync();
        return c;
    }

    private static async Task<UserItem> Find(HttpClient admin, string email)
    {
        var users = await admin.GetFromJsonAsync<List<UserItem>>("/_console/api/users");
        return users!.Single(u => u.Email == email);
    }

    [Fact]
    public async Task Create_update_resetpassword_delete()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);

        // Create a Member.
        var create = await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "m@example.com", firstName = "Mem", lastName = "Ber", role = "Member", password = "Passw0rd!" });
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);

        var member = await Find(admin, "m@example.com");
        Assert.Equal("Member", member.Role);
        Assert.True(member.Active);

        // The member can log in.
        using (var mc = app.CreateClient())
            await mc.LoginAsync("m@example.com", "Passw0rd!");

        // Update: demote to Viewer + deactivate + require 2FA.
        var upd = await admin.PutAsJsonAsync($"/_console/api/users/{member.Id}",
            new { role = "Viewer", active = false, twoFactorRequired = true, firstName = "Renamed" });
        Assert.Equal(HttpStatusCode.OK, upd.StatusCode);
        var after = await Find(admin, "m@example.com");
        Assert.Equal("Viewer", after.Role);
        Assert.False(after.Active);
        Assert.True(after.TwoFactorRequired);

        // Deactivated account cannot log in.
        using (var mc = app.CreateClient())
        {
            var login = await mc.PostAsJsonAsync("/_console/api/auth/login", new { email = "m@example.com", password = "Passw0rd!" });
            Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
        }

        // Reset password, reactivate, then the member logs in with the new password.
        await admin.PutAsJsonAsync($"/_console/api/users/{member.Id}", new { active = true });
        var reset = await admin.PostAsJsonAsync($"/_console/api/users/{member.Id}/reset-password", new { newPassword = "N3wPass!" });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        using (var mc = app.CreateClient())
            await mc.LoginAsync("m@example.com", "N3wPass!");

        // Delete.
        var del = await admin.DeleteAsync($"/_console/api/users/{member.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        var list = await admin.GetFromJsonAsync<List<UserItem>>("/_console/api/users");
        Assert.DoesNotContain(list!, u => u.Email == "m@example.com");
    }

    [Fact]
    public async Task Last_admin_cannot_be_demoted_or_deleted()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);
        var self = await Find(admin, "admin@example.com");

        var demote = await admin.PutAsJsonAsync($"/_console/api/users/{self.Id}", new { role = "Viewer" });
        Assert.Equal(HttpStatusCode.BadRequest, demote.StatusCode);

        var del = await admin.DeleteAsync($"/_console/api/users/{self.Id}");
        Assert.Equal(HttpStatusCode.BadRequest, del.StatusCode);
    }

    [Fact]
    public async Task Admin_cannot_delete_their_own_account()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);
        // A second admin exists, so the last-admin guard would NOT fire — only the self-delete guard applies.
        await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "admin2@example.com", role = "Admin", password = "Passw0rd!" });

        var self = await Find(admin, "admin@example.com");
        var deleteSelf = await admin.DeleteAsync($"/_console/api/users/{self.Id}");
        Assert.Equal(HttpStatusCode.BadRequest, deleteSelf.StatusCode);

        // The current admin can still delete the other admin.
        var other = await Find(admin, "admin2@example.com");
        var deleteOther = await admin.DeleteAsync($"/_console/api/users/{other.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteOther.StatusCode);
    }

    [Fact]
    public async Task Non_admin_cannot_manage_users()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);
        await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "v@example.com", role = "Viewer", password = "Passw0rd!" });

        using var viewer = app.CreateClient();
        await viewer.LoginAsync("v@example.com", "Passw0rd!");
        var resp = await viewer.GetAsync("/_console/api/users");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Self_can_update_profile_and_password()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);

        var prof = await admin.PutAsJsonAsync("/_console/api/auth/profile", new { firstName = "New", lastName = "Name" });
        Assert.Equal(HttpStatusCode.OK, prof.StatusCode);

        var pwd = await admin.PostAsJsonAsync("/_console/api/auth/password",
            new { currentPassword = "Passw0rd!", newPassword = "Ch4nged!" });
        Assert.Equal(HttpStatusCode.OK, pwd.StatusCode);

        using var again = app.CreateClient();
        await again.LoginAsync("admin@example.com", "Ch4nged!");
    }
}
