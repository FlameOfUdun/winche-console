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
        string? Exception, string? UserId, string Instance, IReadOnlyDictionary<string, string?>? Properties,
        string Resource, string? Operation, string? Principal, string? Path, string? Outcome, long? LatencyMs);

    public sealed record SaveQuerySpec(string? Resource, string? MinimumLevel, List<LogFieldFilter>? Filters, string? Search);
    public sealed record SaveQueryRequest(string? Name, SaveQuerySpec? Query);

    /// <summary>Built in, read-only: shown above the saved ones.</summary>
    internal static readonly SavedLogQuery[] BuiltInQueries =
    [
        new("builtin:denied", "Denied requests", new(null, LogLevel.Trace, [new("outcome", "denied")], null), null, null),
        new("builtin:errors", "Errors", new(null, LogLevel.Error, [], null), null, null),
        new("builtin:database", "Database requests", new("database", LogLevel.Trace, [new("category", "Winche.Database.Requests")], null), null, null),
        new("builtin:storage", "Storage requests", new("storage", LogLevel.Trace, [new("category", "Winche.Storage.Requests")], null), null, null),
    ];

    /// <summary>Field filters from the query string: <c>f=principal:u2</c> (equals) or <c>f=outcome!:ok</c> (not equal), repeated.</summary>
    private static bool TryFilters(string[]? raw, out List<LogFieldFilter> filters, out string? error)
    {
        filters = [];
        error = null;
        foreach (var f in raw ?? [])
        {
            var colon = f.IndexOf(':');
            if (colon <= 0) { error = $"Bad filter '{f}' (field:value or field!:value)."; return false; }
            var field = f[..colon];
            var not = field.EndsWith('!');
            if (not) field = field[..^1];
            if (!ConsoleLogStore.FilterFields.ContainsKey(field))
            {
                error = $"Unknown field '{field}' ({string.Join(", ", ConsoleLogStore.FilterFields.Keys)}).";
                return false;
            }
            filters.Add(new LogFieldFilter(field, f[(colon + 1)..], not));
        }
        return true;
    }

    /// <summary>The query from the shared parameters, or the problem with them.</summary>
    private static IResult? TryQuery(string scope, ConsoleOptions options, string? level, string? category, string? q, string? resource,
        string[]? f, DateTimeOffset? from, DateTimeOffset? to, out LogQuery query)
    {
        query = new LogQuery();
        if (Prefix(scope, options) is not { } prefix) return Results.NotFound();
        var minimum = LogLevel.Trace;
        if (level is { Length: > 0 } && !Enum.TryParse(level, ignoreCase: true, out minimum))
            return Results.BadRequest(new { error = $"Unknown level '{level}' (Trace, Debug, Information, Warning, Error, Critical)." });
        if (!TryFilters(f, out var filters, out var error)) return Results.BadRequest(new { error });
        query = new LogQuery
        {
            Scope = prefix.Length == 0 ? null : prefix,
            MinimumLevel = minimum,
            Category = category,
            Search = q,
            Resource = resource,
            Filters = filters,
            From = from,
            To = to,
        };
        return null;
    }

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

        // Saved queries (shared by the console's admins), after the built-in ones.
        group.MapGet("/queries", async ([FromServices] ConsoleLogStore store, CancellationToken ct) =>
            Results.Json(new { queries = BuiltInQueries.Concat(await store.SavedQueriesAsync(ct)) }, ConsoleLogStore.LevelJson))
            .RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/queries", async (SaveQueryRequest body, HttpContext http, [FromServices] ConsoleLogStore store, CancellationToken ct) =>
        {
            var name = body.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 100) return Results.BadRequest(new { error = "A name (up to 100 characters) is required." });
            if (body.Query is not { } spec) return Results.BadRequest(new { error = "A query is required." });
            var level = LogLevel.Trace;
            if (spec.MinimumLevel is { Length: > 0 } && !TryLevel(spec.MinimumLevel, out level))
                return Results.BadRequest(new { error = $"Unknown level '{spec.MinimumLevel}'." });
            var filters = spec.Filters ?? [];
            if (filters.FirstOrDefault(x => x.Field is null || !ConsoleLogStore.FilterFields.ContainsKey(x.Field) || x.Value is null) is { } bad)
                return Results.BadRequest(new { error = $"Bad filter on '{bad.Field}'." });
            var resource = spec.Resource is { Length: > 0 } r ? r : null;
            var search = spec.Search is { Length: > 0 } q ? q : null;
            return Results.Json(await store.SaveQueryAsync(name, new SavedQuerySpec(resource, level, filters, search), Actor(http.User), ct),
                ConsoleLogStore.LevelJson);
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapDelete("/queries/{id}", async (string id, [FromServices] ConsoleLogStore store, CancellationToken ct) =>
            Guid.TryParse(id, out var guid) && await store.DeleteQueryAsync(guid, ct) ? Results.NoContent() : Results.NotFound())
            .RequireAuthorization(ConsoleRoles.AdminPolicy);

        // Entries per time bucket (info / warning / error) and the total, for the Explorer's histogram.
        group.MapGet("/{scope}/histogram", async (
            string scope, [FromQuery] string? level, [FromQuery] string? category, [FromQuery] string? q, [FromQuery] string? resource,
            [FromQuery] string[]? f, [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to, [FromQuery] int? buckets,
            [FromServices] ConsoleLogStore store, [FromServices] TimeProvider time, CancellationToken ct) =>
        {
            if (TryQuery(scope, options, level, category, q, resource, f, from, to, out var query) is { } problem) return problem;
            var now = time.GetUtcNow();
            query = query with { From = query.From ?? now.AddHours(-1), To = query.To ?? now };
            if (query.From >= query.To) return Results.BadRequest(new { error = "from must be before to." });
            var counts = await store.HistogramAsync(query, Math.Clamp(buckets ?? 60, 1, 500), ct);
            return Results.Json(new
            {
                from = query.From,
                to = query.To,
                total = counts.Sum(c => c.Info + c.Warning + c.Error),
                buckets = counts.Select(c => new { start = c.Start, info = c.Info, warning = c.Warning, error = c.Error }),
            });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{scope}", async (
            string scope,
            [FromQuery] string? level,
            [FromQuery] string? category,
            [FromQuery] string? q,
            [FromQuery] string? resource,
            [FromQuery] string[]? f,
            [FromQuery] DateTimeOffset? from,
            [FromQuery] DateTimeOffset? to,
            [FromQuery] long? before,
            [FromQuery] long? after,
            [FromQuery] int? limit,
            [FromServices] ConsoleLogStore store,
            [FromServices] ConsoleLogQueue queue,
            CancellationToken ct) =>
        {
            if (TryQuery(scope, options, level, category, q, resource, f, from, to, out var query) is { } problem) return problem;
            var entries = await store.QueryAsync(query with { Before = before, After = after, Limit = limit ?? 100 }, ct);
            return Results.Json(new
            {
                entries = entries.Select(e => new LogEntryDto(e.Id, e.At, e.Level.ToString(), e.Category, e.EventId, e.Message,
                    e.Exception, e.UserId, e.Instance, e.Properties, e.Resource, e.Operation, e.Principal, e.Path, e.Outcome, e.LatencyMs)),
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
