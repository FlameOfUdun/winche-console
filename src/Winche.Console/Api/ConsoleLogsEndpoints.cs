using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using System.Security.Claims;
using Microsoft.Extensions.Logging;
using Winche.Console.Identity;
using Winche.Console.Logs;
using Winche.Console.Options;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

/// <summary>
/// <c>api/logs/{scope}</c> — the Logs tab (<c>app</c>: everything) and the Database / Storage tabs' Logs sub-tabs
/// (<c>database</c>, <c>storage</c>: that library's categories). Admins only: logs can hold personal data.
/// </summary>
public static class ConsoleLogsEndpoints
{
    internal const string DatabaseScope = "Winche.Database";
    internal const string StorageScope = "Winche.Storage";

    public sealed record LogEntryDto(
        long Id, DateTimeOffset At, string Level, string Category, int EventId, string Message,
        string? Exception, string? UserId, string Instance, IReadOnlyDictionary<string, string?>? Properties);

    /// <summary>Which log views the caller may open (none unless Admin).</summary>
    internal static object Capabilities(ConsoleOptions options, ConsoleRole? role)
    {
        var admin = role == ConsoleRole.Admin;
        return new
        {
            app = admin && options.AppLogsTab,
            database = admin && options.DatabaseTab is { Logs: true },
            storage = admin && options.StorageTab is { Logs: true },
        };
    }

    private static string? Prefix(string scope, ConsoleOptions options) => scope switch
    {
        "app" when options.AppLogsTab => "",
        "database" when options.DatabaseTab is { Logs: true } => DatabaseScope,
        "storage" when options.StorageTab is { Logs: true } => StorageScope,
        _ => null,
    };

    public sealed record LevelOverrideRequest(string? Category, string? Level, DateTimeOffset? Until);
    public sealed record LevelsRequest(string? DefaultLevel, IReadOnlyList<LevelOverrideRequest>? Overrides);

    private static bool TryLevel(string? text, out LogLevel level)
    {
        level = LogLevel.Warning;
        return text is { Length: > 0 } && !int.TryParse(text, out _) && Enum.TryParse(text, ignoreCase: true, out level) && Enum.IsDefined(level);
    }

    private static string? Actor(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name
        ?? user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");

    public static IEndpointRouteBuilder MapConsoleLogsEndpoints(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        var group = app.MapGroup("/api/logs");

        // The levels kept: from code (LogsOptions.MinimumLevel / SetLevel) until an Admin saves them here; saved levels
        // apply on every instance within LogsOptions.LevelSyncInterval, and Reset goes back to the code's.
        group.MapGet("/levels", async ([FromServices] ConsoleLogStore store, [FromServices] ConsoleLogQueue queue, [FromServices] TimeProvider time, CancellationToken ct) =>
        {
            var saved = await store.GetLevelsAsync(ct);
            var settings = (saved?.Settings ?? store.Options.CodeLevels).WithoutExpired(time.GetUtcNow());
            return Results.Json(new
            {
                defaultLevel = settings.DefaultLevel.ToString(),
                overrides = settings.Overrides.Select(o => new { category = o.Category, level = o.Level.ToString(), until = o.Until }),
                source = saved is null ? "code" : "console",
                updatedAt = saved?.UpdatedAt,
                updatedBy = saved?.UpdatedBy,
                codeDefaultLevel = store.Options.MinimumLevel.ToString(),
            });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPut("/levels", async (LevelsRequest body, HttpContext http, [FromServices] ConsoleLogStore store, [FromServices] ConsoleLogQueue queue,
            [FromServices] TimeProvider time, CancellationToken ct) =>
        {
            var now = time.GetUtcNow();
            if (!TryLevel(body.DefaultLevel, out var defaultLevel))
                return Results.BadRequest(new { errors = new[] { $"Unknown level '{body.DefaultLevel}' (Trace, Debug, Information, Warning, Error, Critical, None)." } });
            var overrides = new List<LogLevelOverride>();
            foreach (var o in body.Overrides ?? [])
            {
                if (!TryLevel(o.Level, out var level))
                    return Results.BadRequest(new { errors = new[] { $"Unknown level '{o.Level}' for {o.Category}." } });
                overrides.Add(new LogLevelOverride((o.Category ?? "").Trim(), level, o.Until));
            }
            var settings = new LogLevelSettings(defaultLevel, overrides);
            if (settings.Problems(now) is { Count: > 0 } problems) return Results.BadRequest(new { errors = problems });

            var saved = await store.SaveLevelsAsync(settings, Actor(http.User), ct);
            queue.Levels = settings;   // this instance now; the others at their next sync
            return Results.Json(new { updatedAt = saved.UpdatedAt, updatedBy = saved.UpdatedBy });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapDelete("/levels", async ([FromServices] ConsoleLogStore store, [FromServices] ConsoleLogQueue queue, CancellationToken ct) =>
        {
            await store.ResetLevelsAsync(ct);
            queue.Levels = store.Options.CodeLevels;
            return Results.NoContent();
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{scope}", async (
            string scope,
            [FromQuery] string? level,
            [FromQuery] string? category,
            [FromQuery] string? q,
            [FromQuery] DateTimeOffset? from,
            [FromQuery] DateTimeOffset? to,
            [FromQuery] long? before,
            [FromQuery] long? after,
            [FromQuery] int? limit,
            [FromServices] ConsoleLogStore store,
            [FromServices] ConsoleLogQueue queue,
            CancellationToken ct) =>
        {
            if (Prefix(scope, options) is not { } prefix) return Results.NotFound();
            var minimum = LogLevel.Trace;
            if (level is { Length: > 0 } && !Enum.TryParse(level, ignoreCase: true, out minimum))
                return Results.BadRequest(new { error = $"Unknown level '{level}' (Trace, Debug, Information, Warning, Error, Critical)." });
            var entries = await store.QueryAsync(new LogQuery
            {
                Scope = prefix.Length == 0 ? null : prefix,
                MinimumLevel = minimum,
                Category = category,
                Search = q,
                From = from,
                To = to,
                Before = before,
                After = after,
                Limit = limit ?? 100,
            }, ct);
            return Results.Json(new
            {
                entries = entries.Select(e => new LogEntryDto(e.Id, e.At, e.Level.ToString(), e.Category, e.EventId, e.Message,
                    e.Exception, e.UserId, e.Instance, e.Properties)),
                minimumLevel = queue.Levels.DefaultLevel.ToString(),
                retentionDays = store.Options.Retention.TotalDays,
            });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{scope}/categories", async (string scope, [FromServices] ConsoleLogStore store, CancellationToken ct) =>
        {
            if (Prefix(scope, options) is not { } prefix) return Results.NotFound();
            return Results.Json(await store.CategoriesAsync(prefix.Length == 0 ? null : prefix, ct));
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        return app;
    }
}
