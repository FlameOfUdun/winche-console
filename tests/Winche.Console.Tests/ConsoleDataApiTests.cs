using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleDataApiTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    [Fact]
    public async Task Put_get_query_list_delete_roundtrip()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var put = await client.PutAsJsonAsync(
            $"/_console/api/database/documents/{B64("users/alice")}",
            new { fields = new { name = new { stringValue = "Alice" } } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var get = await client.GetAsync($"/_console/api/database/documents/{B64("users/alice")}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Contains("Alice", await get.Content.ReadAsStringAsync());

        var cols = await client.GetFromJsonAsync<List<string>>("/_console/api/database/collections");
        Assert.Contains("users", cols!);

        var query = await client.PostAsJsonAsync("/_console/api/database/query", new { collection = "users", limit = 10 });
        Assert.Contains("Alice", await query.Content.ReadAsStringAsync());

        var del = await client.DeleteAsync($"/_console/api/database/documents/{B64("users/alice")}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        var after = await client.GetAsync($"/_console/api/database/documents/{B64("users/alice")}");
        Assert.Equal(HttpStatusCode.NotFound, after.StatusCode);
    }

    [Fact]
    public async Task Collections_lists_roots_and_subcollections_by_parent()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        await client.PutAsJsonAsync($"/_console/api/database/documents/{B64("users/alice/posts/p1")}",
            new { fields = new { title = new { stringValue = "Hi" } } });

        // Root: the top-level collection id.
        var roots = await client.GetFromJsonAsync<List<string>>("/_console/api/database/collections");
        Assert.Contains("users", roots!);
        Assert.DoesNotContain("users/alice/posts", roots!);

        // Subcollections under a document: returned as full paths.
        var subs = await client.GetFromJsonAsync<List<string>>(
            $"/_console/api/database/collections?parent={Uri.EscapeDataString("users/alice")}");
        Assert.Contains("users/alice/posts", subs!);
    }
}
