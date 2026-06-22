using System.Net.Http.Json;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Cookie-flow helpers: create the first admin, then log in to get a cookie'd client.</summary>
public static class AuthTestHelpers
{
    public static async Task SetupAdminAsync(this HttpClient client, string email = "admin@example.com", string password = "Passw0rd!")
    {
        var resp = await client.PostAsJsonAsync("/_console/api/auth/setup",
            new { email, firstName = "Root", lastName = "Admin", password });
        resp.EnsureSuccessStatusCode();
    }

    /// <summary>Logs in on the given client (cookies persist on that client) and asserts success.</summary>
    public static async Task LoginAsync(this HttpClient client, string email = "admin@example.com", string password = "Passw0rd!")
    {
        var resp = await client.PostAsJsonAsync("/_console/api/auth/login", new { email, password });
        Assert.Equal(System.Net.HttpStatusCode.OK, resp.StatusCode);
    }
}
