using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Api;
using Winche.Database.Runtime;
using Winche.Database.Runtime.Writes;
using Winche.Storage.Services;

namespace Winche.Console.Sample;

/// <summary>
/// Seeds a few documents + file records on startup so the console has something to browse.
/// Idempotent — re-seeding overwrites the same paths. Writes go through the same unguarded cores
/// the console itself uses (<see cref="DocumentDatabase"/> / <see cref="FileStorage"/>), and documents
/// are built from the console's own tagged-value JSON shape via <c>ConsoleDataEndpoints.DocumentPayload</c>.
/// </summary>
internal static class SampleData
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static async Task SeedAsync(IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DocumentDatabase>();
        var files = scope.ServiceProvider.GetRequiredService<FileStorage>();

        await PutDocument(db, "users/alice", """{"fields":{"name":{"stringValue":"Alice"},"role":{"stringValue":"admin"}}}""", ct);
        await PutDocument(db, "users/bob", """{"fields":{"name":{"stringValue":"Bob"},"role":{"stringValue":"editor"}}}""", ct);
        await PutDocument(db, "posts/welcome", """{"fields":{"title":{"stringValue":"Welcome to Winche"},"author":{"stringValue":"alice"}}}""", ct);

        await files.SetAsync("docs/readme.txt", "text/plain", 1024, new JsonObject(), ct);
        await files.SetAsync("images/logo.png", "image/png", 20480, new JsonObject(), ct);
    }

    private static async Task PutDocument(DocumentDatabase db, string path, string fieldsJson, CancellationToken ct)
    {
        var payload = JsonSerializer.Deserialize<ConsoleDataEndpoints.DocumentPayload>(fieldsJson, Web)!;
        await db.WriteAsync(new Write[] { new SetWrite { Path = path, Fields = payload.Fields } }, ct);
    }
}
