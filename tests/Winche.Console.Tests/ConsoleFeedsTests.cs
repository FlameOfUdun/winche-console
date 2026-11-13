using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleFeedsTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Every_packages_background_deliveries_and_their_dead_letters_are_shown_and_can_be_discarded()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var feeds = await client.GetFromJsonAsync<JsonElement>("/_console/api/feeds");
        var names = feeds.GetProperty("feeds").EnumerateArray().Select(f => f.GetProperty("feed").GetString()).ToList();
        Assert.Contains("database", names);
        Assert.Contains("storage", names);

        // A change a storage hook gave up on (as the feed runner records it).
        await using (var db = NpgsqlDataSource.Create(fx.ConnectionString))
        await using (var cmd = db.CreateCommand("""
            INSERT INTO winche_feed_dead_letters (feed, consumer, txid, seq, record, error, attempts)
            VALUES ('storage', 'hooks:Example|docs/{f=**}', '5', 1, '{"type":"registered","path":"docs/a.pdf"}', 'boom', 3)
            """))
            await cmd.ExecuteNonQueryAsync();

        var letters = (await client.GetFromJsonAsync<JsonElement>("/_console/api/feeds/storage/dead-letters")).GetProperty("deadLetters");
        var letter = Assert.Single(letters.EnumerateArray());
        Assert.Equal(("docs/a.pdf", "boom"), (letter.GetProperty("record").GetProperty("path").GetString(), letter.GetProperty("error").GetString()));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/_console/api/feeds/storage/dead-letters/{letter.GetProperty("id").GetInt64()}")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>("/_console/api/feeds/storage/dead-letters")).GetProperty("deadLetters").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/_console/api/feeds/nope/dead-letters")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/_console/api/feeds/storage/retry", new { })).StatusCode);
    }
}
