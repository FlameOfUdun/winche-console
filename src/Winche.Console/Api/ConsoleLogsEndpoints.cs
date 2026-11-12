using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
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

    public static IEndpointRouteBuilder MapConsoleLogsEndpoints(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        var group = app.MapGroup("/api/logs");

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
                minimumLevel = store.Options.MinimumLevel.ToString(),
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
