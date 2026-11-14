using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using Winche.Console.Api;
using Winche.Console.Identity;
using Winche.Core;

namespace Winche.Console.Apps;

/// <summary>
/// An app registered in the project: its name, the SDK it's built with, and what identifies it on each platform
/// (Android package, Apple bundle id, web origins). Its <see cref="Id"/> goes in its <c>winche_options.dart</c> and is
/// sent with every request (header <c>X-Winche-App</c>), which is how the console counts each app's requests. It isn't
/// a secret, so it doesn't prove which app is calling: attestation does that, later.
/// </summary>
public sealed record RegisteredApp
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Sdk { get; init; } = "flutter";
    public string? AndroidPackage { get; init; }
    public string? AppleBundleId { get; init; }
    public IReadOnlyList<string> WebOrigins { get; init; } = [];
    public DateTimeOffset CreatedAt { get; init; }
}

/// <summary>The project's apps (settings area <c>apps</c>), and whether only they may call the public APIs.</summary>
public sealed partial record AppsSettings
{
    public const string Area = "apps";
    public const int Max = 100;
    public static readonly string[] Sdks = ["flutter"];

    public IReadOnlyList<RegisteredApp> Apps { get; init; } = [];

    /// <summary>Refuse public API requests that don't name a registered app (<c>failed-precondition</c>, <c>app-not-registered</c>).</summary>
    public bool RegisteredOnly { get; init; }

    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (Apps.Count > Max) problems.Add($"At most {Max} apps.");
        if (Apps.GroupBy(a => a.Id).Any(g => g.Count() > 1)) problems.Add("Two apps have the same id.");
        foreach (var a in Apps) problems.AddRange(ProblemsOf(a));
        if (RegisteredOnly && Apps.Count == 0) problems.Add("Register an app before refusing the others.");
        return problems;
    }

    public static IEnumerable<string> ProblemsOf(RegisteredApp a)
    {
        if (string.IsNullOrWhiteSpace(a.Name)) yield return "Name every app.";
        else if (a.Name.Length > 80) yield return $"'{a.Name[..20]}…' is too long a name (80 at most).";
        if (!Sdks.Contains(a.Sdk)) yield return $"'{a.Sdk}' isn't an SDK Winche has yet.";
        if (a.AndroidPackage is { } pkg && !AndroidPackageRx().IsMatch(pkg)) yield return $"'{pkg}' isn't an Android package name (like com.example.app).";
        if (a.AppleBundleId is { } bundle && !BundleRx().IsMatch(bundle)) yield return $"'{bundle}' isn't a bundle id (like com.example.app).";
        foreach (var o in a.WebOrigins)
            if (NormalizeOrigin(o) is null) yield return $"'{o}' isn't a web origin (like https://app.example.com).";
    }

    /// <summary><c>https://host[:port]</c> from <paramref name="origin"/>, or null when it isn't one.</summary>
    public static string? NormalizeOrigin(string origin) =>
        Uri.TryCreate(origin.Trim(), UriKind.Absolute, out var u) && u.Scheme is "https" or "http" && u.AbsolutePath == "/" && string.IsNullOrEmpty(u.Query)
            && string.IsNullOrEmpty(u.UserInfo)
            ? u.GetLeftPart(UriPartial.Authority).ToLowerInvariant()
            : null;

    [GeneratedRegex(@"^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$")]
    private static partial Regex AndroidPackageRx();

    [GeneratedRegex(@"^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$")]
    private static partial Regex BundleRx();
}

/// <summary>The registered apps, for the gate, CORS and the console.</summary>
public sealed class RegisteredApps(IServiceProvider services)
{
    /// <summary>The header apps name themselves with (WebSockets: the query parameter <see cref="QueryParameter"/>).</summary>
    public const string Header = "X-Winche-App", QueryParameter = "winche_app";

    private SettingsArea<AppsSettings>? Area => services.GetService<SettingsArea<AppsSettings>>();

    /// <summary>Whether apps can be registered here (needs <c>UseProjectSetup()</c>).</summary>
    public bool Available => Area is not null && services.GetService<SettingsStore>() is not null;

    public AppsSettings Current => Area?.Current ?? new();

    public RegisteredApp? Find(string? id) => id is null ? null : Current.Apps.FirstOrDefault(a => a.Id == id);

    /// <summary>Whether a registered web app lives at <paramref name="origin"/> (for CORS).</summary>
    public bool IsWebOrigin(string origin) =>
        AppsSettings.NormalizeOrigin(origin) is { } o && Current.Apps.Any(a => a.WebOrigins.Contains(o));

    /// <summary>The app a request names, if any.</summary>
    public static string? AppIdOf(HttpRequest request) =>
        request.Headers[Header].FirstOrDefault() is { Length: > 0 } h ? h.Trim()
        : request.Query[QueryParameter].FirstOrDefault() is { Length: > 0 } q ? q.Trim() : null;

    /// <summary>A chosen app id: like a project id, 3 to 40 lower-case letters, digits and dashes, starting with a letter.</summary>
    public static bool IsValidId(string? id) => Project.ProjectSetup.IsValidId(id);

    /// <summary>A new app id: <c>app-</c> and 12 lower-case letters and digits.</summary>
    public static string NewId()
    {
        const string alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
        return "app-" + string.Concat(RandomNumberGenerator.GetItems<char>(alphabet, 12));
    }

    internal async Task SaveAsync(AppsSettings next, string? by, string reason, CancellationToken ct)
    {
        var store = services.GetRequiredService<SettingsStore>();
        await store.SaveAsync(AppsSettings.Area, JsonSerializer.SerializeToNode(next, SettingsArea.Json)!, by, reason, ct);
    }
}

/// <summary>
/// Requests per app per day (and when each was last seen), counted in memory and written every 30 seconds to
/// <c>winche_console_app_usage</c> in the config database. Requests that name no registered app count under
/// <see cref="Unregistered"/>.
/// </summary>
public sealed class AppUsage
{
    public const string Unregistered = "";
    internal const string Table = "winche_console_app_usage";
    private static readonly string[] Schema =
    [
        $"""
        CREATE TABLE IF NOT EXISTS {Table} (
            app_id    text        NOT NULL,
            day       date        NOT NULL,
            requests  bigint      NOT NULL,
            last_seen timestamptz NOT NULL,
            PRIMARY KEY (app_id, day)
        );
        """,
    ];

    private readonly NpgsqlDataSource? _db;
    private readonly TimeProvider _time;
    private ConcurrentDictionary<(string App, DateOnly Day), (long Count, DateTimeOffset Last)> _pending = new();
    private bool _ready;

    public AppUsage(IServiceProvider services, TimeProvider? time = null)
    {
        _db = services.GetKeyedService<NpgsqlDataSource>("WincheConfigOptions");
        _time = time ?? TimeProvider.System;
    }

    public void Count(string appId)
    {
        var now = _time.GetUtcNow();
        _pending.AddOrUpdate((appId, DateOnly.FromDateTime(now.UtcDateTime)), (1, now), (_, v) => (v.Count + 1, now));
    }

    private async Task EnsureAsync(CancellationToken ct)
    {
        if (_ready || _db is null) return;
        await WincheSchema.EnsureAsync(_db, "console-app-usage", Schema, ct);
        _ready = true;
    }

    /// <summary>Writes what's been counted since the last flush.</summary>
    public async Task FlushAsync(CancellationToken ct = default)
    {
        if (_db is null || _pending.IsEmpty) return;
        var batch = Interlocked.Exchange(ref _pending, new());
        await EnsureAsync(ct);
        foreach (var ((app, day), (count, last)) in batch)
        {
            await using var cmd = _db.CreateCommand($"""
                INSERT INTO {Table} (app_id, day, requests, last_seen) VALUES ($1, $2, $3, $4)
                ON CONFLICT (app_id, day) DO UPDATE SET requests = {Table}.requests + EXCLUDED.requests,
                    last_seen = GREATEST({Table}.last_seen, EXCLUDED.last_seen)
                """);
            cmd.Parameters.AddWithValue(app);
            cmd.Parameters.AddWithValue(day);
            cmd.Parameters.AddWithValue(count);
            cmd.Parameters.AddWithValue(last);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    public sealed record Usage(string AppId, long Today, long Last7Days, DateTimeOffset? LastSeen);

    /// <summary>Each app's requests today and over the last 7 days (written ones; flushes first).</summary>
    public async Task<IReadOnlyDictionary<string, Usage>> ReadAsync(CancellationToken ct = default)
    {
        if (_db is null) return new Dictionary<string, Usage>();
        await FlushAsync(ct);
        await EnsureAsync(ct);
        var today = DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime);
        await using var cmd = _db.CreateCommand($"""
            SELECT app_id, COALESCE(SUM(requests) FILTER (WHERE day = $1), 0), SUM(requests), MAX(last_seen)
            FROM {Table} WHERE day > $1 - 7 GROUP BY app_id
            """);
        cmd.Parameters.AddWithValue(today);
        var result = new Dictionary<string, Usage>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            result[r.GetString(0)] = new(r.GetString(0), r.GetInt64(1), r.GetInt64(2), r.GetFieldValue<DateTimeOffset>(3));
        return result;
    }
}

/// <summary>Writes <see cref="AppUsage"/> every 30 seconds, and once more on the way down.</summary>
internal sealed class AppUsageFlusher(AppUsage usage, ILogger<AppUsageFlusher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try
        {
            while (await timer.WaitForNextTickAsync(ct)) await Flush(ct);
        }
        catch (OperationCanceledException) { }
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        await base.StopAsync(ct);
        await Flush(ct);
    }

    private async Task Flush(CancellationToken ct)
    {
        try { await usage.FlushAsync(ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { logger.LogWarning(ex, "Couldn't write app usage."); }
    }
}

public static class RegisteredAppEndpoints
{
    /// <summary>An app's fields. <see cref="Id"/> is chosen when registering (blank: one is made) and never changes after.</summary>
    public sealed record AppRequest(string? Name, string? Sdk, string? AndroidPackage, string? AppleBundleId, string[]? WebOrigins, string? Id = null);
    public sealed record PolicyRequest(bool RegisteredOnly);

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;
    private static IResult Problem(string message) => ConsoleErrors.Problem("apps", message, null);
    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static object Body(AppsSettings s, IReadOnlyDictionary<string, AppUsage.Usage> usage, bool available, bool editable) => new
    {
        available, editable, registeredOnly = s.RegisteredOnly,
        apps = s.Apps.Select(a => new
        {
            id = a.Id, name = a.Name, sdk = a.Sdk, androidPackage = a.AndroidPackage, appleBundleId = a.AppleBundleId, webOrigins = a.WebOrigins,
            createdAt = a.CreatedAt,
            usage = usage.TryGetValue(a.Id, out var u) ? new { today = u.Today, last7Days = u.Last7Days, lastSeen = u.LastSeen } : null,
        }),
        unregistered = usage.TryGetValue(AppUsage.Unregistered, out var un) ? new { today = un.Today, last7Days = un.Last7Days, lastSeen = un.LastSeen } : null,
    };

    private static RegisteredApp From(AppRequest body, RegisteredApp? old) => (old ?? new RegisteredApp()) with
    {
        Name = body.Name?.Trim() ?? "",
        Sdk = Blank(body.Sdk) ?? old?.Sdk ?? "flutter",
        AndroidPackage = Blank(body.AndroidPackage),
        AppleBundleId = Blank(body.AppleBundleId),
        WebOrigins = [.. (body.WebOrigins ?? []).Where(o => !string.IsNullOrWhiteSpace(o)).Select(o => AppsSettings.NormalizeOrigin(o) ?? o.Trim()).Distinct()],
    };

    internal static IEndpointRouteBuilder MapConsoleRegisteredAppEndpoints(this IEndpointRouteBuilder app, Options.ConsoleOptions options)
    {
        app.MapGet("/api/apps/registered", async (HttpContext http, RegisteredApps apps, AppUsage usage, CancellationToken ct) =>
        {
            var admin = Tabs.ConsoleRolePolicy.Highest(http.User, options) >= Tabs.ConsoleRole.Admin;
            return Results.Json(Body(apps.Current, apps.Available ? await usage.ReadAsync(ct) : new Dictionary<string, AppUsage.Usage>(), apps.Available, apps.Available && admin));
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        var admin = app.MapGroup("/api/apps/registered").RequireAuthorization(ConsoleRoles.AdminPolicy);

        admin.MapPost("", async (AppRequest body, HttpContext http, RegisteredApps apps, CancellationToken ct) =>
        {
            if (!apps.Available) return Problem("Apps can be registered once the console runs project setup (UseProjectSetup).");
            var current = apps.Current;
            if (current.Apps.Count >= AppsSettings.Max) return Problem($"At most {AppsSettings.Max} apps.");
            var id = Blank(body.Id) ?? RegisteredApps.NewId();
            if (!RegisteredApps.IsValidId(id)) return Problem("An app id is 3 to 40 lower-case letters, digits and dashes, starting with a letter.");
            if (apps.Find(id) is not null) return Problem($"There's already an app {id}.");
            var added = From(body, null) with { Id = id, CreatedAt = DateTimeOffset.UtcNow };
            if (AppsSettings.ProblemsOf(added).FirstOrDefault() is { } problem) return Problem(problem);
            await apps.SaveAsync(current with { Apps = [.. current.Apps, added] }, Who(http.User), $"Registered the app {added.Name}", ct);
            return Results.Json(new { id = added.Id });
        });

        admin.MapPut("/{id}", async (string id, AppRequest body, HttpContext http, RegisteredApps apps, CancellationToken ct) =>
        {
            var current = apps.Current;
            if (apps.Find(id) is not { } old) return Results.NotFound();
            var changed = From(body, old);
            if (AppsSettings.ProblemsOf(changed).FirstOrDefault() is { } problem) return Problem(problem);
            await apps.SaveAsync(current with { Apps = [.. current.Apps.Select(a => a.Id == id ? changed : a)] }, Who(http.User), $"Changed the app {changed.Name}", ct);
            return Results.Json(new { id });
        });

        admin.MapDelete("/{id}", async (string id, HttpContext http, RegisteredApps apps, CancellationToken ct) =>
        {
            var current = apps.Current;
            if (apps.Find(id) is not { } gone) return Results.NotFound();
            var rest = current.Apps.Where(a => a.Id != id).ToList();
            // The last app gone: nothing could call any more, so "registered apps only" goes off with it.
            await apps.SaveAsync(current with { Apps = rest, RegisteredOnly = current.RegisteredOnly && rest.Count > 0 }, Who(http.User), $"Removed the app {gone.Name}", ct);
            return Results.NoContent();
        });

        app.MapPut("/api/apps/policy", async (PolicyRequest body, HttpContext http, RegisteredApps apps, CancellationToken ct) =>
        {
            if (!apps.Available) return Problem("Apps can be registered once the console runs project setup (UseProjectSetup).");
            var current = apps.Current;
            if (body.RegisteredOnly && current.Apps.Count == 0) return Problem("Register an app before refusing the others.");
            await apps.SaveAsync(current with { RegisteredOnly = body.RegisteredOnly }, Who(http.User),
                body.RegisteredOnly ? "Only registered apps may call" : "Any app may call", ct);
            return Results.Json(new { registeredOnly = body.RegisteredOnly });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);
        return app;
    }
}
