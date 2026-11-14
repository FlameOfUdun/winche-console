using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Core;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

/// <summary>
/// Database and Storage → Settings: the packages' own settings areas (<c>o.UseSettings()</c>), read and saved here with
/// a reason; plus the indexes slow queries asked for.
/// </summary>
public static class ConsoleSettingsEndpoints
{
    /// <summary>The areas these screens may change (auth's have their own endpoints).</summary>
    public static readonly IReadOnlySet<string> Areas = new HashSet<string>
    {
        Winche.Database.Settings.DatabaseSettings.Area,
        "database.live",   // Winche.Database.AspNetCore.WebSockets: live-connection limits
        Winche.Storage.Settings.StorageSettings.Area,
    };

    public sealed record SaveRequest(JsonElement? Settings, string? Reason);

    /// <summary>Which subsystems have settings the console can change, for an admin.</summary>
    internal static object Capabilities(IServiceProvider sp, ConsoleRole? role) => new
    {
        database = role == ConsoleRole.Admin && (Area(sp, Winche.Database.Settings.DatabaseSettings.Area) ?? Area(sp, "database.live")) is not null,
        storage = role == ConsoleRole.Admin && Area(sp, Winche.Storage.Settings.StorageSettings.Area) is not null,
    };

    private static SettingsArea? Area(IServiceProvider sp, string name) =>
        Areas.Contains(name) ? sp.GetServices<SettingsArea>().FirstOrDefault(a => a.Name == name) : null;

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;

    private static IResult Problem(string message, IReadOnlyList<string>? errors = null) =>
        ConsoleErrors.Problem("invalid-settings", message, errors);

    public static IEndpointRouteBuilder MapConsoleSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{area}", (string area, IServiceProvider sp) =>
        {
            if (Area(sp, area) is not { } a) return Results.NotFound();
            var store = sp.GetService<SettingsStore>();
            return Results.Json(new
            {
                settings = a.CurrentJson,
                codeDefault = a.CodeDefaultJson,
                source = a.Source == SettingsSource.Saved ? "console" : "code",
                version = a.Version is { } v ? new { id = v.Id, area = v.Area, areaTitle = a.Title, number = v.Number, at = v.At, by = v.By, reason = v.Reason } : null,
                editable = store is not null,
                whyReadOnly = store is null ? "The app needs AddWincheConfig(…) to save settings." : null,
            }, SettingsArea.Json);
        });

        group.MapPut("/{area}", async (string area, SaveRequest body, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (Area(sp, area) is null) return Results.NotFound();
            if (sp.GetService<SettingsStore>() is not { } store) return Problem("The app needs AddWincheConfig(…) to save settings.");
            if (body.Settings is not { ValueKind: JsonValueKind.Object } doc) return Problem("Send the settings to save.");
            if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why you're making this change: it goes in the history.");
            try
            {
                var settings = JsonNode.Parse(doc.GetRawText())!;
                // The console is the only place indexes are declared: one it no longer lists is always dropped.
                if (area == "database") settings["dropUndeclaredIndexes"] = true;
                var v = await store.SaveAsync(area, settings, Who(http.User), body.Reason, ct);
                return Results.Json(new { id = v.Id, area = v.Area, number = v.Number, at = v.At, by = v.By, reason = v.Reason });
            }
            catch (SettingsValidationException ex) { return Problem("These settings can't be saved.", ex.Errors); }
        });

        // Indexes slow queries would have used, newest first (since the server started).
        group.MapGet("/database/suggestions", (IServiceProvider sp) =>
            Results.Json(new { suggestions = sp.GetService<IndexSuggestions>()?.Recent() ?? [] }, SettingsArea.Json));

        ConsoleAuthSettingsEndpoints.MapHistory(group);
        return app;
    }
}

/// <summary>Collects the database's index suggestions (CollectionIndexResolver.Suggested) for the Settings screen.</summary>
public sealed class IndexSuggestions
{
    private readonly ConcurrentDictionary<string, (Winche.Database.Querying.IndexSuggestion Suggestion, DateTimeOffset At)> _seen = new();

    public IndexSuggestions(Winche.Database.Querying.CollectionIndexResolver resolver) =>
        resolver.Suggested += s =>
        {
            if (_seen.Count < 200) _seen[s.Code] = (s, DateTimeOffset.UtcNow);
        };

    public IReadOnlyList<object> Recent() => [.. _seen.Values.OrderByDescending(v => v.At).Select(v => (object)new
    {
        collection = v.Suggestion.CollectionId,
        collectionGroup = v.Suggestion.CollectionGroup,
        kind = v.Suggestion.Kind == Winche.Database.Documents.IndexKind.ArrayMembership ? "array" : "ordered",
        fields = v.Suggestion.Fields.Select(f => new { path = f.Path, direction = f.Direction == Winche.Database.Querying.Ast.SortDirection.Desc ? "desc" : "asc" }),
        elapsedMs = v.Suggestion.ElapsedMs,
        at = v.At,
        code = v.Suggestion.Code,
    })];
}
