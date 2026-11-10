using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Rules;
using Winche.Database.Runtime;
using Winche.Database.Runtime.Writes;
using Winche.Database.Values;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Field suggestions for the rules editor: the fields of documents a match pattern covers.</summary>
[Collection("postgres")]
public class RuleFieldSamplerTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await fx.ResetAsync();
        await fx.ResetAuthAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static Dictionary<string, Value> F(params (string K, Value V)[] f) => f.ToDictionary(x => x.K, x => x.V);

    private static async Task SeedAsync(DocumentDatabase db, string tag)
    {
        await db.WriteAsync([
            new SetWrite { Path = $"{tag}u/a", Fields = F(("name", new StringValue("Ann")), ("age", new IntegerValue(30)),
                ("address", new MapValue(F(("city", new StringValue("Oslo")), ("geo", new MapValue(F(("lat", new DoubleValue(1)))))))) ) },
            new SetWrite { Path = $"{tag}u/b", Fields = F(("name", new StringValue("Bo")), ("age", new DoubleValue(4.5))) },
            new SetWrite { Path = $"{tag}u/a/notes/n1", Fields = F(("text", new StringValue("hi")), ("tags", new ArrayValue([]))) },
            new SetWrite { Path = $"{tag}u/b/notes/n2", Fields = F(("text", new StringValue("yo")), ("pinned", new BooleanValue(true))) },
            new SetWrite { Path = $"{tag}u/b/notes/n2/edits/e1", Fields = F(("at", new TimestampValue(DateTimeOffset.UtcNow))) },
        ]);
    }

    private static Dictionary<string, string[]> Map(IReadOnlyList<SampledField> fields) => fields.ToDictionary(f => f.Path, f => f.Types.ToArray());

    [Fact]
    public async Task A_pattern_with_captures_samples_the_documents_it_covers()
    {
        using var app = new ConsoleAppFactory(fx);
        var db = app.Services.GetRequiredService<DocumentDatabase>();
        await SeedAsync(db, "s1");
        var sampler = new RuleFieldSampler(db);

        var users = Map(await sampler.SampleAsync("s1u/{uid}"));
        Assert.Equal(["address", "address.city", "address.geo", "address.geo.lat", "age", "name"], users.Keys.Order());
        Assert.Equal(["float", "int"], users["age"]);
        Assert.Equal(["map"], users["address"]);

        var notes = Map(await sampler.SampleAsync("s1u/{uid}/notes/{noteId}"));
        Assert.Equal(["pinned", "tags", "text"], notes.Keys.Order());
        Assert.Equal(["list"], notes["tags"]);

        var exact = Map(await sampler.SampleAsync("s1u/a"));
        Assert.Contains("address.city", exact.Keys);
        Assert.DoesNotContain("name", Map(await sampler.SampleAsync("s1u/{uid}/{coll}/{id}")).Keys);
        Assert.Contains("text", Map(await sampler.SampleAsync("s1u/{uid}/{coll}/{id}")).Keys);
    }

    [Fact]
    public async Task A_recursive_pattern_samples_below_it()
    {
        using var app = new ConsoleAppFactory(fx);
        var db = app.Services.GetRequiredService<DocumentDatabase>();
        await SeedAsync(db, "s2");

        var below = Map(await new RuleFieldSampler(db).SampleAsync("s2u/{uid}/{rest=**}"));

        Assert.Contains("text", below.Keys);      // notes
        Assert.Contains("at", below.Keys);        // edits, two levels down
        Assert.Equal(["timestamp"], below["at"]);
    }

    [Fact]
    public async Task A_pattern_nothing_matches_has_no_fields()
    {
        using var app = new ConsoleAppFactory(fx);
        var db = app.Services.GetRequiredService<DocumentDatabase>();
        Assert.Empty(await new RuleFieldSampler(db).SampleAsync("nothing/{here}"));
    }

    [Fact]
    public async Task The_endpoint_returns_them()
    {
        using var app = new ConsoleAppFactory(fx);
        await SeedAsync(app.Services.GetRequiredService<DocumentDatabase>(), "s3");
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var db = JsonDocument.Parse(await client.GetStringAsync("/_console/api/rules/database/fields?pattern=" + Uri.EscapeDataString("s3u/{uid}"))).RootElement;
        Assert.Contains(db.GetProperty("fields").EnumerateArray(), f => f.GetProperty("path").GetString() == "address.city");

        var storage = JsonDocument.Parse(await client.GetStringAsync("/_console/api/rules/storage/fields")).RootElement;
        Assert.Contains(storage.GetProperty("fields").EnumerateArray(), f => f.GetProperty("path").GetString() == "mimeType");
    }
}
