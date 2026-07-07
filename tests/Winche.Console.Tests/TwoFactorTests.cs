using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class TwoFactorTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Task.CompletedTask;

    private sealed record SetupDto(string SharedKey, string AuthenticatorUri);
    private sealed record UserItem(string Id, string Email);

    private static async Task<HttpClient> AdminClient(ConsoleAppFactory app)
    {
        var c = app.CreateClient();
        await c.SetupAdminAsync();
        await c.LoginAsync();
        return c;
    }

    /// <summary>Enrolls 2FA on an already-logged-in client and returns the authenticator base32 key.</summary>
    private static async Task<string> EnrollAsync(HttpClient client)
    {
        var setup = await client.PostAsync("/_console/api/auth/2fa/setup", null);
        Assert.Equal(HttpStatusCode.OK, setup.StatusCode);
        var dto = await setup.Content.ReadFromJsonAsync<SetupDto>();
        var key = dto!.SharedKey.Replace(" ", "").ToUpperInvariant();
        var enable = await client.PostAsJsonAsync("/_console/api/auth/2fa/enable", new { code = Totp(key) });
        Assert.Equal(HttpStatusCode.OK, enable.StatusCode);
        return key;
    }

    [Fact]
    public async Task Enroll_then_login_requires_and_accepts_code()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);
        var key = await EnrollAsync(admin);

        // A fresh login now requires the second factor.
        using var fresh = app.CreateClient();
        var login = await fresh.PostAsJsonAsync("/_console/api/auth/login", new { email = "admin@example.com", password = "Passw0rd!" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Contains("requiresTwoFactor", await login.Content.ReadAsStringAsync());

        // Completing the challenge signs in fully.
        var two = await fresh.PostAsJsonAsync("/_console/api/auth/login/2fa", new { code = Totp(key) });
        Assert.Equal(HttpStatusCode.OK, two.StatusCode);
        var protectedRead = await fresh.GetAsync("/_console/api/database/collections");
        Assert.Equal(HttpStatusCode.OK, protectedRead.StatusCode);
    }

    [Fact]
    public async Task Admin_required_forces_setup_gate()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);

        // Create a Member and mark them as 2FA-required.
        await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "m@example.com", role = "Member", password = "Passw0rd!" });
        var users = await admin.GetFromJsonAsync<List<UserItem>>("/_console/api/users");
        var member = users!.Single(u => u.Email == "m@example.com");
        await admin.PutAsJsonAsync($"/_console/api/users/{member.Id}", new { twoFactorRequired = true });

        // The member can log in (no authenticator yet) but is gated from everything but enrollment.
        using var mc = app.CreateClient();
        await mc.LoginAsync("m@example.com", "Passw0rd!");
        var gated = await mc.GetAsync("/_console/api/database/collections");
        Assert.Equal(HttpStatusCode.Forbidden, gated.StatusCode);
        Assert.Contains("two_factor_setup_required", await gated.Content.ReadAsStringAsync());

        var state = await mc.GetFromJsonAsync<System.Text.Json.JsonElement>("/_console/api/auth/state");
        Assert.True(state.GetProperty("user").GetProperty("mustSetupTwoFactor").GetBoolean());

        // Enrolling lifts the gate.
        await EnrollAsync(mc);
        var ok = await mc.GetAsync("/_console/api/database/collections");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public async Task Disable_is_blocked_when_required()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var admin = await AdminClient(app);
        await admin.PostAsJsonAsync("/_console/api/users",
            new { email = "m@example.com", role = "Member", password = "Passw0rd!" });
        var users = await admin.GetFromJsonAsync<List<UserItem>>("/_console/api/users");
        var member = users!.Single(u => u.Email == "m@example.com");

        using var mc = app.CreateClient();
        await mc.LoginAsync("m@example.com", "Passw0rd!");
        await EnrollAsync(mc);   // enroll while not yet required

        // Admin now requires 2FA; the member can no longer disable it.
        await admin.PutAsJsonAsync($"/_console/api/users/{member.Id}", new { twoFactorRequired = true });
        var disable = await mc.PostAsync("/_console/api/auth/2fa/disable", null);
        Assert.Equal(HttpStatusCode.Forbidden, disable.StatusCode);
    }

    // --- RFC 6238 TOTP (matches ASP.NET Core Identity's authenticator) ---

    private static string Totp(string base32Key)
    {
        var key = Base32Decode(base32Key);
        var counter = (long)(DateTimeOffset.UtcNow - DateTimeOffset.UnixEpoch).TotalSeconds / 30;
        var counterBytes = BitConverter.GetBytes(counter);
        if (BitConverter.IsLittleEndian) Array.Reverse(counterBytes);
        using var hmac = new HMACSHA1(key);
        var hash = hmac.ComputeHash(counterBytes);
        var offset = hash[^1] & 0x0F;
        var bin = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16)
                  | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
        return (bin % 1_000_000).ToString("D6");
    }

    private static byte[] Base32Decode(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        input = input.TrimEnd('=').ToUpperInvariant();
        var bits = 0; var value = 0; var output = new List<byte>();
        foreach (var c in input)
        {
            var idx = alphabet.IndexOf(c);
            if (idx < 0) continue;
            value = (value << 5) | idx; bits += 5;
            if (bits >= 8) { output.Add((byte)((value >> (bits - 8)) & 0xFF)); bits -= 8; }
        }
        return output.ToArray();
    }
}
