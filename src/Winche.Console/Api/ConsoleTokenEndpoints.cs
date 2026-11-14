using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

/// <summary>
/// <c>winche login</c> for consoles with their own accounts (a browser approval, then a PKCE code exchange), CI tokens
/// for admins, and revoking either.
/// </summary>
public static class ConsoleTokenEndpoints
{
    public sealed record ApproveRequest(string? Challenge, int Port, string? State, string? Name);
    public sealed record ExchangeRequest(string? Code, string? Verifier);
    public sealed record CreateRequest(string? Name, string[]? Scopes, int? Days);

    private static IResult Problem(string message) => ConsoleErrors.Problem("tokens", message, null);

    private static string? Email(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.Email) ?? u.FindFirstValue("email");
    private static string UserId(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier) ?? u.FindFirstValue("sub") ?? "";
    private static bool ByToken(ClaimsPrincipal u) => u.FindFirstValue(ConsoleTokenHandler.TokenIdClaim) is not null;

    private static object Info(ConsoleToken t) => new
    {
        id = t.Id, kind = t.Kind, name = t.Name, user = t.UserEmail ?? t.UserId, role = t.Role, scopes = t.Scopes,
        createdAt = t.CreatedAt, expiresAt = t.ExpiresAt, lastUsedAt = t.LastUsedAt,
    };

    public static IEndpointRouteBuilder MapConsoleTokenEndpoints(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        // ── winche login (Identity mode; with Keycloak the CLI signs in there) ──────────────────────────────────
        if (options.Provider == ConsoleAuthProvider.Identity)
        {
            // The signed-in user allows the CLI waiting on 127.0.0.1:{port}; the browser goes back to it with a code.
            app.MapPost("/api/cli-login/approve", async (ApproveRequest body, HttpContext http, ConsoleTokenStore store, CancellationToken ct) =>
            {
                if (ByToken(http.User)) return Results.Forbid();   // only a person in the browser approves
                if (!store.Available) return Problem("The CLI's sign-in needs AddWincheConfig(…) (where its tokens are kept).");
                if (body.Challenge is not { Length: 43 } challenge || body.State is not { Length: > 0 and <= 200 } state || body.Port is < 1024 or > 65535)
                    return Problem("That sign-in link isn't complete: run winche login again.");
                var role = ConsoleRolePolicy.Highest(http.User, options).ToString();
                var name = string.IsNullOrWhiteSpace(body.Name) ? "winche CLI" : body.Name.Trim()[..Math.Min(body.Name.Trim().Length, 80)];
                var code = await store.CreateCodeAsync(challenge, UserId(http.User), Email(http.User), role, name, ct);
                return Results.Json(new { redirect = $"http://127.0.0.1:{body.Port}/callback?code={code}&state={Uri.EscapeDataString(state)}" });
            }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

            // The CLI trades the code (with its PKCE verifier) for its token.
            app.MapPost("/api/cli-login/token", async (ExchangeRequest body, ConsoleTokenStore store, CancellationToken ct) =>
            {
                if (string.IsNullOrEmpty(body.Code) || string.IsNullOrEmpty(body.Verifier) || !store.Available)
                    return Results.Json(new { error = new { code = "INVALID_CODE", message = "Send the code and verifier." } }, statusCode: 400);
                if (await store.RedeemCodeAsync(body.Code, body.Verifier, ct) is not { } who)
                    return Results.Json(new { error = new { code = "INVALID_CODE", message = "That sign-in has expired or was used: run winche login again." } }, statusCode: 400);
                var (token, secret) = await store.CreateAsync("cli", who.Name, who.UserId, who.Email, who.Role, [], ConsoleTokenStore.CliLifetime, ct);
                return Results.Json(new { token = secret, user = who.Email, role = who.Role, expiresAt = token.ExpiresAt });
            }).AllowAnonymous();
        }

        // ── the caller's own token (winche logout) ──────────────────────────────────────────────────────────────
        app.MapDelete("/api/tokens/current", async (HttpContext http, ConsoleTokenStore store, CancellationToken ct) =>
        {
            if (http.User.FindFirstValue(ConsoleTokenHandler.TokenIdClaim) is not { } id) return Problem("This request wasn't made with a token.");
            await store.RevokeAsync(id, ct);
            return Results.NoContent();
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy).WithMetadata(new ConsoleCiScope(ConsoleCiScope.Functions), new ConsoleCiScope(ConsoleCiScope.Rules));

        // ── admins: CI tokens, and everyone's CLI sign-ins ──────────────────────────────────────────────────────
        var admin = app.MapGroup("/api/tokens").RequireAuthorization(ConsoleRoles.AdminPolicy);

        admin.MapGet("", async (ConsoleTokenStore store, CancellationToken ct) => Results.Json(new
        {
            available = store.Available,
            scopes = ConsoleCiScope.All,
            tokens = (await store.ListAsync(ct)).Select(Info),
        }));

        admin.MapPost("", async (CreateRequest body, HttpContext http, ConsoleTokenStore store, CancellationToken ct) =>
        {
            if (ByToken(http.User)) return Results.Forbid();
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (!store.Available) return Problem("CI tokens need AddWincheConfig(…) (where they're kept).");
            if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Trim().Length > 80) return Problem("Name the token (where it's used, e.g. gitlab-main).");
            var scopes = (body.Scopes ?? []).Distinct().ToArray();
            if (scopes.Length == 0 || scopes.Any(s => !ConsoleCiScope.All.Contains(s))) return Problem($"Choose what it may deploy: {string.Join(", ", ConsoleCiScope.All)}.");
            if (body.Days is not (>= 1 and <= 730)) return Problem("A CI token lasts 1 day to 2 years.");
            var (token, secret) = await store.CreateAsync("ci", body.Name.Trim(), UserId(http.User), Email(http.User) ?? http.User.Identity?.Name,
                ConsoleRoles.Admin, scopes, TimeSpan.FromDays(body.Days.Value), ct);
            return Results.Json(new { token = Info(token), secret });
        });

        admin.MapDelete("/{id}", async (string id, HttpContext http, ConsoleTokenStore store, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            return await store.RevokeAsync(id, ct) ? Results.NoContent() : Results.NotFound();
        });

        return app;
    }
}
