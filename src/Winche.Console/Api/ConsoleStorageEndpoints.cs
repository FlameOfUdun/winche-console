using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Storage.Services;
using Winche.Console.Identity;

namespace Winche.Console.Api;

public static class ConsoleStorageEndpoints
{
    public sealed record ListRequest(string Directory, string? MimeType);
    public sealed record UploadUrlRequest(string Path, string MimeType, long SizeBytes, JsonObject? Metadata);
    public sealed record PathRequest(string Path);
    public sealed record UpdateMetadataRequest(string Path, JsonObject Metadata);

    public static IEndpointRouteBuilder MapConsoleStorageEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/storage");

        group.MapPost("/list", async (ListRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
            Results.Json(await files.ListAsync(body.Directory, body.MimeType, ct))).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        // Folder-style browse: immediate subdirectories + files directly in a directory ("" = root),
        // using the library's directory lister (Winche.Storage 6.3+) instead of raw SQL.
        group.MapGet("/browse", async (string? path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            var dir = path ?? "";
            var fileList = await files.ListAsync(dir, null, ct);
            var folders = new List<string>();
            string? token = null;
            do
            {
                var page = await files.ListDirectoryIdsAsync(dir, pageToken: token, ct: ct);
                folders.AddRange(page.DirectoryIds);
                token = page.NextPageToken;
            } while (!string.IsNullOrEmpty(token));
            folders.Sort(StringComparer.Ordinal);
            return Results.Json(new { folders, files = fileList });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        group.MapGet("/files/{path}", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            if (!ConsolePathEncoding.TryDecode(path, out var decoded)) return Results.BadRequest();
            var record = await files.GetAsync(decoded, ct);
            return record is null ? Results.NotFound() : Results.Json(record);
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        group.MapDelete("/files/{path}", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            if (!ConsolePathEncoding.TryDecode(path, out var decoded)) return Results.BadRequest();
            await files.DeleteAsync(decoded, ct);
            return Results.NoContent();
        }).RequireAuthorization(ConsoleRoles.MemberPolicy);

        // Create the file record + return a presigned upload URL. The SPA then PUTs the bytes to that URL
        // and calls /confirm. (Paths carry slashes, so these endpoints take the path in the body/query.)
        group.MapPost("/upload-url", async (UploadUrlRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            await files.SetAsync(body.Path, body.MimeType, body.SizeBytes, body.Metadata ?? new JsonObject(), ct);
            var session = await files.GenerateUploadUrlAsync(body.Path, ct);
            return Results.Json(new { uploadUrl = session.Url, expiresAt = session.ExpiresAt });
        }).RequireAuthorization(ConsoleRoles.MemberPolicy);

        group.MapPost("/confirm", async (PathRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
            Results.Json(await files.ConfirmUploadAsync(body.Path, ct))).RequireAuthorization(ConsoleRoles.MemberPolicy);

        group.MapGet("/download-url", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            var session = await files.GenerateDownloadUrlAsync(path, ct);
            return Results.Json(new { downloadUrl = session.Url, expiresAt = session.ExpiresAt });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        group.MapPost("/metadata", async (UpdateMetadataRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
            Results.Json(await files.UpdateMetadataAsync(body.Path, body.Metadata ?? new JsonObject(), ct)))
            .RequireAuthorization(ConsoleRoles.MemberPolicy);

        return app;
    }
}
