using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Winche.Console.Api;
using Winche.Console.Identity;

namespace Winche.Console.Project;

/// <summary>
/// The project's thumbnail (Project settings → General), in the config database: one small PNG, JPEG or WebP image.
/// The console shrinks it to 256×256 before sending it. SVG isn't accepted: it can carry scripts.
/// </summary>
public sealed class ProjectImageStore
{
    public const int MaxBytes = 256 * 1024;
    internal const string Table = "winche_console_project_image";
    private static readonly string[] Schema =
    [
        $"""
        CREATE TABLE IF NOT EXISTS {Table} (
            id           int         PRIMARY KEY CHECK (id = 1),
            content_type text        NOT NULL,
            bytes        bytea       NOT NULL,
            updated_at   timestamptz NOT NULL,
            updated_by   text        NULL
        );
        """,
    ];

    public sealed record Image(string ContentType, byte[] Bytes, DateTimeOffset UpdatedAt);

    private readonly NpgsqlDataSource? _db;
    private bool _ready;
    private (bool Known, DateTimeOffset? At) _version;

    public ProjectImageStore(IServiceProvider services) => _db = services.GetKeyedService<NpgsqlDataSource>("WincheConfigOptions");

    /// <summary>False without <c>AddWincheConfig</c>: there's nowhere to keep it.</summary>
    public bool Available => _db is not null;

    private NpgsqlDataSource Db => _db ?? throw new InvalidOperationException("The project image needs AddWincheConfig(…).");

    private async Task EnsureAsync(CancellationToken ct)
    {
        if (_ready) return;
        await Winche.Core.WincheSchema.EnsureAsync(Db, "console-project-image", Schema, ct);
        _ready = true;
    }

    /// <summary>The image's content type from its first bytes (PNG, JPEG, WebP), or null for anything else.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b) =>
        b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }) ? "image/png"
        : b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF ? "image/jpeg"
        : b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8) ? "image/webp"
        : null;

    /// <summary>When the image last changed (null: none), for cache-busting; read once, then kept up to date here.</summary>
    public async Task<DateTimeOffset?> VersionAsync(CancellationToken ct = default)
    {
        if (_db is null) return null;
        if (_version.Known) return _version.At;
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"SELECT updated_at FROM {Table} WHERE id = 1");
        var at = await cmd.ExecuteScalarAsync(ct) is DateTime d ? new DateTimeOffset(DateTime.SpecifyKind(d, DateTimeKind.Utc)) : (DateTimeOffset?)null;
        _version = (true, at);
        return at;
    }

    public async Task<Image?> GetAsync(CancellationToken ct = default)
    {
        if (_db is null) return null;
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"SELECT content_type, bytes, updated_at FROM {Table} WHERE id = 1");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? new Image(r.GetString(0), r.GetFieldValue<byte[]>(1), r.GetFieldValue<DateTimeOffset>(2)) : null;
    }

    public async Task SetAsync(string contentType, byte[] bytes, string? by, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        var now = DateTimeOffset.UtcNow;
        await using var cmd = Db.CreateCommand($"""
            INSERT INTO {Table} (id, content_type, bytes, updated_at, updated_by) VALUES (1, $1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes,
                updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
            """);
        cmd.Parameters.AddWithValue(contentType);
        cmd.Parameters.AddWithValue(bytes);
        cmd.Parameters.AddWithValue(now);
        cmd.Parameters.AddWithValue((object?)by ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
        _version = (true, now);
    }

    public async Task RemoveAsync(CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"DELETE FROM {Table} WHERE id = 1");
        await cmd.ExecuteNonQueryAsync(ct);
        _version = (true, null);
    }
}

public static class ProjectImageEndpoints
{
    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;
    private static IResult Problem(string message) => ConsoleErrors.Problem("project", message, null);

    internal static IEndpointRouteBuilder MapConsoleProjectImageEndpoints(this IEndpointRouteBuilder app)
    {
        // GET api/project/image(?v=…): the image; the console adds ?v=<version> so it can be cached for good.
        app.MapGet("/api/project/image", async (HttpContext http, ProjectImageStore store, CancellationToken ct) =>
        {
            if (await store.GetAsync(ct) is not { } image) return Results.NotFound();
            http.Response.Headers.CacheControl = http.Request.Query.ContainsKey("v") ? "private, max-age=31536000, immutable" : "private, no-cache";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(image.Bytes, image.ContentType, lastModified: image.UpdatedAt);
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        // PUT api/project/image: the image's bytes as the body (PNG, JPEG or WebP, 256 KB at most).
        app.MapPut("/api/project/image", async (HttpContext http, ProjectImageStore store, CancellationToken ct) =>
        {
            if (!store.Available) return Problem("This console has nowhere to keep an image (AddWincheConfig).");
            if (http.Request.ContentLength > ProjectImageStore.MaxBytes) return Problem("The image is too big: 256 KB at most.");
            using var buffer = new MemoryStream();
            await http.Request.Body.CopyToAsync(buffer, ct);
            if (buffer.Length > ProjectImageStore.MaxBytes) return Problem("The image is too big: 256 KB at most.");
            if (buffer.Length == 0) return Problem("Send the image as the request's body.");
            var bytes = buffer.ToArray();
            if (ProjectImageStore.Sniff(bytes) is not { } type) return Problem("Use a PNG, JPEG or WebP image.");
            await store.SetAsync(type, bytes, Who(http.User), ct);
            return Results.Json(new { imageVersion = await store.VersionAsync(ct) });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        app.MapDelete("/api/project/image", async (ProjectImageStore store, CancellationToken ct) =>
        {
            if (store.Available) await store.RemoveAsync(ct);
            return Results.NoContent();
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);
        return app;
    }
}
