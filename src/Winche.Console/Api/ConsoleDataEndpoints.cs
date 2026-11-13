using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Database.Documents;
using Winche.Database.Querying.Ast;
using Winche.Database.Querying.Ast.Serialization;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Winche.Database.Runtime;
using Winche.Database.Runtime.History;
using Winche.Database.Runtime.Writes;
using Winche.Database.Values;
using Winche.Console.Identity;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

public static class ConsoleDataEndpoints
{
    public sealed record DocumentPayload(
        [property: JsonConverter(typeof(FieldsJsonConverter))] IReadOnlyDictionary<string, Value> Fields);

    public sealed record QueryRequest(string Collection, int? Limit);

    /// <summary>How the console's own writes are attributed: <c>console:</c> plus the user's email (else name or id).</summary>
    internal static string ConsoleActor(ClaimsPrincipal user) =>
        "console:" + (user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name
                      ?? user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub") ?? "unknown");

    /// <summary>
    /// <c>api/database/history</c>: changes newest first — one document (<c>path</c>), everything under a path
    /// (<c>under</c>), or by someone (<c>actor</c>); paged with <c>before</c>. Readable by whoever can read the Database tab.
    /// </summary>
    public static IEndpointRouteBuilder MapConsoleHistoryEndpoints(this IEndpointRouteBuilder app, ConsoleRole minRole)
    {
        app.MapGet("/api/database/history", async (
            string? path, string? under, string? actor, long? before, int? limit,
            [FromServices] DocumentHistory history, CancellationToken ct) =>
        {
            var entries = await history.QueryAsync(new HistoryQuery
            {
                Path = string.IsNullOrWhiteSpace(path) ? null : path.Trim(),
                Under = string.IsNullOrWhiteSpace(under) ? null : under.Trim(),
                Actor = string.IsNullOrWhiteSpace(actor) ? null : actor.Trim(),
                Before = before,
                Limit = limit ?? 50,
            }, ct);
            static JsonNode? Encode(Value? v) => v is null ? null : ValueSerializer.Write(v);
            return Results.Json(new
            {
                entries = entries.Select(e => new
                {
                    seq = e.Seq,
                    type = e.Type,
                    path = e.Path,
                    version = e.Version,
                    at = e.At,
                    actor = e.Actor,
                    recorded = e.Fields is not null,
                    fields = e.Fields?.Select(f => new { field = f.Field, kind = f.Kind, before = Encode(f.Before), after = Encode(f.After) }),
                }),
            });
        }).RequireAuthorization(ConsoleRolePolicy.For(minRole));
        return app;
    }

    public static IEndpointRouteBuilder MapConsoleDataEndpoints(this IEndpointRouteBuilder app, ConsoleRole minRole)
    {
        var group = app.MapGroup("/api/database");
        // Edits made here are the signed-in console user's in the document history (Winche.Database KeepHistory).
        group.AddEndpointFilter(async (ctx, next) =>
        {
            using var _ = DocumentWriteActor.Use(ConsoleActor(ctx.HttpContext.User));
            return await next(ctx);
        });
        var readPolicy = ConsoleRolePolicy.For(minRole);
        var writePolicy = ConsoleRolePolicy.For(minRole < ConsoleRole.Member ? ConsoleRole.Member : minRole);

        // Immediate child collection IDs under a parent document ("" = root collections), via the
        // library's collection lister (Winche.Database 8.3+). Returns full collection paths, paging through all.
        group.MapGet("/collections", async (string? parent, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            var parentPath = parent ?? "";
            var prefix = parentPath.Length == 0 ? "" : parentPath + "/";
            var paths = new List<string>();
            string? token = null;
            do
            {
                var page = await db.ListCollectionIdsAsync(parentPath, pageToken: token, ct: ct);
                paths.AddRange(page.CollectionIds.Select(id => prefix + id));
                token = page.NextPageToken;
            } while (!string.IsNullOrEmpty(token));
            paths.Sort(StringComparer.Ordinal);
            return Results.Json(paths);
        }).RequireAuthorization(readPolicy);

        group.MapDelete("/collections/{path}", async (string path, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var collection)) return Results.BadRequest();
            while (true)
            {
                var result = await db.QueryAsync(new Query(collection, Limit: 500), ct);
                if (result.Documents.Count == 0) break;
                var deletes = result.Documents.Select(d => (Write)new DeleteWrite { Path = d.Path, Cascade = true }).ToList();
                await db.WriteAsync(deletes, ct);
                if (result.Documents.Count < 500) break;
            }
            return Results.NoContent();
        }).RequireAuthorization(writePolicy);

        group.MapGet("/documents/{path}", async (string path, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            var doc = await db.GetAsync(decoded, ct);
            return doc is null ? Results.NotFound() : Results.Json(doc);
        }).RequireAuthorization(readPolicy);

        group.MapPut("/documents/{path}", async (string path, DocumentPayload body, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            await db.WriteAsync(new Write[] { new SetWrite { Path = decoded, Fields = body.Fields } }, ct);
            return Results.Json(await db.GetAsync(decoded, ct));
        }).RequireAuthorization(writePolicy);

        group.MapPatch("/documents/{path}", async (string path, DocumentPayload body, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            var fields = body.Fields.ToDictionary(kv => FieldPath.Parse(kv.Key), kv => kv.Value);
            await db.WriteAsync(new Write[] { new UpdateWrite { Path = decoded, Fields = fields } }, ct);
            return Results.Json(await db.GetAsync(decoded, ct));
        }).RequireAuthorization(writePolicy);

        group.MapDelete("/documents/{path}", async (string path, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            await db.WriteAsync(new Write[] { new DeleteWrite { Path = decoded, Cascade = true } }, ct);
            return Results.NoContent();
        }).RequireAuthorization(writePolicy);

        group.MapPost("/query", async (QueryRequest body, [FromServices] DocumentDatabase db, CancellationToken ct) =>
        {
            var result = await db.QueryAsync(new Query(body.Collection, Limit: body.Limit ?? 100), ct);
            return Results.Json(result);
        }).RequireAuthorization(readPolicy);

        return app;
    }
}
