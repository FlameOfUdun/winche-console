using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>The Database tab's History sub-tab (api/database/history) over Winche.Database's KeepHistory.</summary>
[Collection("postgres")]
public class ConsoleHistoryTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAuthAsync();
        await fx.ResetAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    private static async Task<JsonElement> Json(HttpResponseMessage resp)
    {
        Assert.True(resp.IsSuccessStatusCode, $"{(int)resp.StatusCode} {await resp.Content.ReadAsStringAsync()}");
        return JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    [Fact]
    public async Task Console_edits_are_recorded_with_who_and_the_field_changes()
    {
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        await admin.LoginAsync();

        await Json(await admin.PutAsJsonAsync($"/_console/api/database/documents/{B64("people/p1")}",
            new { fields = new { name = new { stringValue = "Ann" } } }));
        await Json(await admin.PutAsJsonAsync($"/_console/api/database/documents/{B64("people/p1")}",
            new { fields = new { name = new { stringValue = "Annie" }, phone = new { stringValue = "123" } } }));
        await Json(await admin.PutAsJsonAsync($"/_console/api/database/documents/{B64("teams/t1")}",
            new { fields = new { name = new { stringValue = "Red" } } }));

        var history = await Json(await admin.GetAsync("/_console/api/database/history?path=people/p1"));
        var entries = history.GetProperty("entries").EnumerateArray().ToArray();
        Assert.Equal(2, entries.Length);
        Assert.Equal("modified", entries[0].GetProperty("type").GetString());
        Assert.Equal("console:admin@example.com", entries[0].GetProperty("actor").GetString());
        var fields = entries[0].GetProperty("fields").EnumerateArray().ToArray();
        Assert.Equal(["changed:name", "added:phone"], fields.Select(f => $"{f.GetProperty("kind").GetString()}:{f.GetProperty("field").GetString()}"));
        Assert.Equal("Ann", fields[0].GetProperty("before").GetProperty("stringValue").GetString());
        Assert.Equal("Annie", fields[0].GetProperty("after").GetProperty("stringValue").GetString());
        Assert.Equal("added", entries[1].GetProperty("type").GetString());

        var under = await Json(await admin.GetAsync("/_console/api/database/history?under=teams"));
        Assert.Equal(["teams/t1"], under.GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("path").GetString()!));
        var paged = await Json(await admin.GetAsync($"/_console/api/database/history?limit=1&before={entries[0].GetProperty("seq").GetInt64()}"));
        Assert.Equal("people/p1", paged.GetProperty("entries")[0].GetProperty("path").GetString());

        var state = await Json(await admin.GetAsync("/_console/api/auth/state"));
        Assert.True(state.GetProperty("capabilities").GetProperty("history").GetBoolean());
    }

    [Fact]
    public async Task Viewers_can_read_history_like_the_data()
    {
        using var app = new ConsoleAppFactory(fx);
        using var admin = app.CreateClient();
        await admin.SetupAdminAsync();
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ConsoleUser>>();
            var viewer = new ConsoleUser { UserName = "viewer@example.com", Email = "viewer@example.com", EmailConfirmed = true, Active = true };
            await users.CreateAsync(viewer, "Passw0rd!");
            await users.AddToRoleAsync(viewer, ConsoleRoles.Viewer);
        }
        using var client = app.CreateClient();
        await client.LoginAsync("viewer@example.com", "Passw0rd!");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/_console/api/database/history")).StatusCode);

        using var anon = app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/_console/api/database/history")).StatusCode);
    }
}
