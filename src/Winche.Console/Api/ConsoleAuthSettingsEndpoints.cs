using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Auth.AspNetCore;
using Winche.Config;
using Winche.Console.Identity;

namespace Winche.Console.Api;

/// <summary>
/// <c>api/app-auth/settings</c> — the Authentication tab's Settings: trusted identity providers and their token mapping
/// (Winche.Auth's settings area <c>auth.identityProviders</c>), a token test, and the change history. Admins only.
/// Changing them needs <c>AddWincheTokens(t =&gt; t.UseSettings())</c> and <c>AddWincheConfig</c>; otherwise read-only.
/// </summary>
public static class ConsoleAuthSettingsEndpoints
{
    public sealed record SaveProvidersRequest(JsonElement? Settings, string? Reason);
    public sealed record CheckProviderRequest(string? Issuer, string? Authority, bool? RequireHttps);
    public sealed record TestTokenRequest(string? Token, JsonElement? Settings);
    public sealed record ReasonRequest(string? Reason);

    private static string? Who(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;

    private static object Version(SettingsVersion v, SettingsStore? store) => new
    {
        id = v.Id, area = v.Area, areaTitle = store?.Area(v.Area)?.Title ?? v.Area, number = v.Number, at = v.At, by = v.By, reason = v.Reason,
        restoredFrom = v.RestoredFrom, reset = v.Document is null,
    };

    private static IResult Problem(string message, IReadOnlyList<string>? errors = null) =>
        Results.Json(new { error = new { code = "INVALID_SETTINGS", message, errors = errors ?? [] } }, statusCode: 400);

    public static IEndpointRouteBuilder MapConsoleAuthSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/app-auth/settings").RequireAuthorization(ConsoleRoles.AdminPolicy);

        // The providers in force, where they come from, and whether the console may change them.
        group.MapGet("/providers", (WincheTokenProviders providers, IServiceProvider sp) =>
        {
            var store = sp.GetService<SettingsStore>();
            var area = providers.Area;
            return Results.Json(new
            {
                settings = providers.Current,
                codeDefault = area?.CodeDefault ?? providers.Current,
                source = area?.Source == SettingsSource.Saved ? "console" : "code",
                version = area?.Version is { } v ? Version(v, store) : null,
                editable = area is not null && store is not null,
                whyReadOnly = area is null ? "The app's code sets these. To change them here, the app adds AddWincheTokens(t => t.UseSettings())."
                    : store is null ? "The app needs AddWincheConfig(…) to save settings." : null,
            }, SettingsArea.Json);
        });

        group.MapPut("/providers", async (SaveProvidersRequest body, HttpContext http, WincheTokenProviders providers, IServiceProvider sp, CancellationToken ct) =>
        {
            var store = sp.GetService<SettingsStore>();
            if (providers.Area is null || store is null) return Problem("These settings are set in the app's code and can't be changed here.");
            if (body.Settings is not { ValueKind: JsonValueKind.Object } doc) return Problem("Send the settings to save.");
            if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why you're making this change: it goes in the history.");
            try
            {
                var saved = await store.SaveAsync(WincheAuthDefaults.SettingsArea, JsonNode.Parse(doc.GetRawText())!, Who(http.User), body.Reason, ct);
                return Results.Json(Version(saved, store));
            }
            catch (SettingsValidationException ex) { return Problem("These settings can't be saved.", ex.Errors); }
            catch (InvalidOperationException ex) { return Problem(ex.Message); }
        });

        // Does this address belong to an OpenID Connect provider, and what does it say about itself?
        group.MapPost("/providers/check", async (CheckProviderRequest body, WincheTokenInspector inspector, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Issuer)) return Problem("Give the provider's address.");
            var r = await inspector.CheckProviderAsync(body.Issuer.Trim(), body.Authority, body.RequireHttps ?? true, ct);
            return Results.Json(new { found = r.Found, issuer = r.Issuer, keys = r.Keys, algorithms = r.Algorithms, error = r.Error });
        });

        // What a pasted token would become, under the saved settings or a draft.
        group.MapPost("/providers/test", async (TestTokenRequest body, WincheTokenInspector inspector, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Token)) return Problem("Paste a token.");
            IdentityProvidersSettings? draft = null;
            if (body.Settings is { ValueKind: JsonValueKind.Object } s)
            {
                try { draft = s.Deserialize<IdentityProvidersSettings>(SettingsArea.Json); }
                catch (JsonException ex) { return Problem($"The draft settings don't have the expected shape: {ex.Message}"); }
            }
            var r = await inspector.InspectAsync(body.Token, draft, ct);
            return Results.Json(new
            {
                wouldSignIn = r.WouldSignIn, provider = r.Provider,
                checks = r.Checks.Select(c => new { outcome = c.Outcome, text = c.Text }),
                auth = r.Auth, notPassed = r.NotPassed,
            });
        });

        // Every saved change to the settings the console manages.
        group.MapGet("/history", async ([FromQuery] string? area, IServiceProvider sp, CancellationToken ct) =>
        {
            if (sp.GetService<SettingsStore>() is not { } store) return Results.Json(new { versions = Array.Empty<object>() });
            var versions = await store.HistoryAsync(area, 200, ct);
            var current = store.Areas.Where(a => a.Version is not null).Select(a => a.Version!.Id).ToHashSet();
            return Results.Json(new
            {
                versions = versions.Select(v => new
                {
                    id = v.Id, area = v.Area, areaTitle = store.Area(v.Area)?.Title ?? v.Area, number = v.Number, at = v.At, by = v.By,
                    reason = v.Reason, restoredFrom = v.RestoredFrom, reset = v.Document is null, current = current.Contains(v.Id),
                }),
            });
        });

        group.MapPost("/history/{id:long}/restore", async (long id, ReasonRequest body, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (sp.GetService<SettingsStore>() is not { } store) return Problem("Settings aren't saved in this app.");
            if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why you're restoring it: it goes in the history.");
            try { return Results.Json(Version(await store.RestoreAsync(id, Who(http.User), body.Reason, ct), store)); }
            catch (KeyNotFoundException) { return Results.NotFound(); }
            catch (SettingsValidationException ex) { return Problem("That version no longer fits this app's settings.", ex.Errors); }
        });

        group.MapPost("/{area}/reset", async (string area, ReasonRequest body, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (sp.GetService<SettingsStore>() is not { } store) return Problem("Settings aren't saved in this app.");
            if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why you're resetting: it goes in the history.");
            try { return Results.Json(Version(await store.ResetAsync(area, Who(http.User), body.Reason, ct), store)); }
            catch (KeyNotFoundException) { return Results.NotFound(); }
        });

        return app;
    }
}
