using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class AuthApiTests(PostgresFixture fx) : IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task State_setup_login_logout_flow()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();

        var before = await client.GetFromJsonAsync<StateDto>("/_console/api/auth/state");
        Assert.False(before!.Initialized);
        Assert.Null(before.User);

        await client.SetupAdminAsync();

        // Second setup is rejected.
        var dup = await client.PostAsJsonAsync("/_console/api/auth/setup",
            new { email = "x@y.z", firstName = "x", lastName = "y", password = "Passw0rd!" });
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);

        await client.LoginAsync();
        var after = await client.GetFromJsonAsync<StateDto>("/_console/api/auth/state");
        Assert.True(after!.Initialized);
        Assert.Equal("admin@example.com", after.User!.Email);
        Assert.Equal("Admin", after.User.Role);

        var logout = await client.PostAsync("/_console/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.OK, logout.StatusCode);
    }

    [Fact]
    public async Task Bad_password_is_unauthorized()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        var resp = await client.PostAsJsonAsync("/_console/api/auth/login", new { email = "admin@example.com", password = "wrong" });
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private sealed record StateDto(bool Initialized, bool SelfServiceResetEnabled, UserDto? User);
    private sealed record UserDto(string Email, string Role);
}
