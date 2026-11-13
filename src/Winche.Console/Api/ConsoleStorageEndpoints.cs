using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Storage.Services;
using Winche.Console.Identity;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

public static class ConsoleStorageEndpoints
{
    public sealed record UploadUrlRequest(string Path, string MimeType, long SizeBytes, JsonObject? Metadata);
    public sealed record PathRequest(string Path);
    public sealed record UpdateMetadataRequest(string Path, JsonObject Metadata);

    public static IEndpointRouteBuilder MapConsoleStorageEndpoints(this IEndpointRouteBuilder app, ConsoleRole minRole)
    {
        var group = app.MapGroup("/api/storage");
        var readPolicy = ConsoleRolePolicy.For(minRole);
        var writePolicy = ConsoleRolePolicy.For(minRole < ConsoleRole.Member ? ConsoleRole.Member : minRole);

        // Folder-style browse: immediate subfolders (by name) + files directly in a folder ("" = root), every page.
        group.MapGet("/browse", async (string? path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            var dir = path ?? "";
            var fileList = new List<Winche.Storage.Models.FileRecord>();
            var folders = new List<string>();
            string? token = null;
            do
            {
                var page = await files.ListAsync(dir, new(PageToken: token), ct);
                fileList.AddRange(page.Items);
                folders.AddRange(page.Prefixes.Select(p => p[(p.LastIndexOf('/') + 1)..]));
                token = page.NextPageToken;
            } while (token is not null);
            return Results.Json(new { folders, files = fileList });
        }).RequireAuthorization(readPolicy);

        group.MapGet("/files/{path}", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            var record = await files.GetAsync(decoded, ct);
            return record is null ? Results.NotFound() : Results.Json(record);
        }).RequireAuthorization(readPolicy);

        group.MapDelete("/files/{path}", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            await files.DeleteAsync(decoded, ct: ct);
            return Results.NoContent();
        }).RequireAuthorization(writePolicy);

        // Cascading directory delete: FileStorage.DeleteAsync removes the path plus everything under
        // "<path>/", so passing a directory id wipes the whole subtree in one transaction.
        group.MapDelete("/directories/{path}", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            if (!WincheBase64Url.TryDecode(path, out var decoded)) return Results.BadRequest();
            await files.DeleteAsync(decoded, ct: ct);
            return Results.NoContent();
        }).RequireAuthorization(writePolicy);

        // Create the file record + return a presigned upload URL. The SPA then PUTs the bytes to that URL
        // and calls /confirm. (Paths carry slashes, so these endpoints take the path in the body/query.)
        group.MapPost("/upload-url", async (UploadUrlRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            await files.SetAsync(body.Path, body.MimeType, body.SizeBytes, body.Metadata ?? new JsonObject(), ct: ct);
            var session = await files.GenerateUploadUrlAsync(body.Path, ct);
            return Results.Json(new { uploadUrl = session.Url, expiresAt = session.ExpiresAt });
        }).RequireAuthorization(writePolicy);

        group.MapPost("/confirm", async (PathRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
            Results.Json(await files.ConfirmUploadAsync(body.Path, ct))).RequireAuthorization(writePolicy);

        group.MapGet("/download-url", async (string path, [FromServices] FileStorage files, CancellationToken ct) =>
        {
            var session = await files.GenerateDownloadUrlAsync(path, ct);
            return Results.Json(new { downloadUrl = session.Url, expiresAt = session.ExpiresAt });
        }).RequireAuthorization(readPolicy);

        group.MapPost("/metadata", async (UpdateMetadataRequest body, [FromServices] FileStorage files, CancellationToken ct) =>
            Results.Json(await files.UpdateMetadataAsync(body.Path, body.Metadata ?? new JsonObject(), ct: ct)))
            .RequireAuthorization(writePolicy);

        return app;
    }
}
