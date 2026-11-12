using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Auth;
using Winche.Auth.AspNetCore;
using Winche.Auth.Tokens;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

/// <summary>
/// <c>api/app-auth</c> — the Authentication tab: the app's users (Winche Auth), how they sign in, and token settings.
/// Admins only: it's personal data and account control. (The console's own admins are managed in Access.)
/// </summary>
public static class ConsoleAppAuthEndpoints
{
    public sealed record CreateUserRequest(string? Email, string? Password, string? DisplayName);
    public sealed record DisabledRequest(bool Disabled);
    public sealed record ClaimsRequest(JsonElement? Claims);
    public sealed record VerifiedRequest(bool Verified);
    public sealed record TemplateRequest(string? Subject, string? Body);

    private static string? AdminEmail(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? (user.Identity?.Name is { } n && n.Contains('@') ? n : null);

    internal static bool Capability(ConsoleOptions options, ConsoleRole? role) => options.AuthenticationTab && role == ConsoleRole.Admin;

    private static object User(WincheUserInfo u) => new
    {
        uid = u.Uid, email = u.Email, emailVerified = u.EmailVerified, displayName = u.DisplayName, photoUrl = u.PhotoUrl,
        isAnonymous = u.IsAnonymous, disabled = u.Disabled, providers = u.Providers, customClaims = u.CustomClaims,
        createdAt = u.CreatedAt, lastSignInAt = u.LastSignInAt, lockedOutUntil = u.LockedOutUntil,
    };

    private static IResult Error(AuthException ex) => Results.Json(new { error = new { code = ex.Code, message = ex.Message } },
        statusCode: ex.Code switch { AuthErrorCodes.UserNotFound => 404, AuthErrorCodes.EmailExists => 409, _ => 400 });

    private static object? Plain(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Array => e.EnumerateArray().Select(Plain).ToList(),
        JsonValueKind.Object => e.EnumerateObject().ToDictionary(p => p.Name, p => Plain(p.Value)),
        _ => null,
    };

    public static IEndpointRouteBuilder MapConsoleAppAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/app-auth").RequireAuthorization(ConsoleRoles.AdminPolicy).AddEndpointFilter(async (ctx, next) =>
        {
            try { return await next(ctx); }
            catch (AuthException ex) { return Error(ex); }
        });

        group.MapGet("/users", async ([FromQuery] string? search, [FromQuery] int? offset, [FromQuery] int? limit, IWincheAuth auth, CancellationToken ct) =>
        {
            var page = await auth.ListUsersAsync(search, offset ?? 0, Math.Clamp(limit ?? 50, 1, 200), ct);
            return Results.Json(new { users = page.Users.Select(User), total = page.Total });
        });

        group.MapPost("/users", async (CreateUserRequest body, IWincheAuth auth, CancellationToken ct) =>
        {
            var email = string.IsNullOrWhiteSpace(body.Email) ? null : body.Email;
            var password = string.IsNullOrEmpty(body.Password) ? null : body.Password;
            return Results.Json(User(await auth.CreateUserAsync(email, password, body.DisplayName, ct)));
        });

        group.MapGet("/users/{uid}", async (string uid, IWincheAuth auth, CancellationToken ct) =>
            await auth.GetUserAsync(uid, ct) is { } u
                ? Results.Json(new { user = User(u), sessions = await auth.ListSessionsAsync(uid, ct) })
                : Results.NotFound());

        group.MapPost("/users/{uid}/disabled", async (string uid, DisabledRequest body, IWincheAuth auth, CancellationToken ct) =>
            Results.Json(User(await auth.SetDisabledAsync(uid, body.Disabled, ct))));

        group.MapPut("/users/{uid}/claims", async (string uid, ClaimsRequest body, IWincheAuth auth, CancellationToken ct) =>
        {
            IReadOnlyDictionary<string, object?>? claims = null;
            if (body.Claims is { ValueKind: JsonValueKind.Object } o) claims = (Dictionary<string, object?>)Plain(o)!;
            else if (body.Claims is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) })
                return Results.BadRequest(new { error = new { code = AuthErrorCodes.InvalidClaims, message = "Custom claims must be a JSON object." } });
            return Results.Json(User(await auth.SetCustomClaimsAsync(uid, claims, ct)));
        });

        group.MapPost("/users/{uid}/signOut", async (string uid, IWincheAuth auth, CancellationToken ct) =>
            Results.Json(new { sessions = await auth.RevokeSessionsAsync(uid, ct) }));

        group.MapDelete("/users/{uid}/sessions/{id:guid}", async (string uid, Guid id, IWincheAuth auth, CancellationToken ct) =>
            await auth.RevokeSessionAsync(uid, id, ct) ? Results.NoContent() : Results.NotFound());

        group.MapPost("/users/{uid}/unlock", async (string uid, IWincheAuth auth, CancellationToken ct) =>
            Results.Json(User(await auth.UnlockAsync(uid, ct))));

        group.MapPost("/users/{uid}/sendPasswordReset", async (string uid, IWincheAuth auth, CancellationToken ct) =>
        {
            var user = await auth.GetUserAsync(uid, ct);
            if (user?.Email is not { } email) return Results.BadRequest(new { error = new { code = AuthErrorCodes.InvalidArgument, message = "This user has no email address." } });
            await auth.SendPasswordResetAsync(email, AuthRequestInfo.Server, ct);
            return Results.NoContent();
        });

        group.MapPost("/users/{uid}/sendVerification", async (string uid, IWincheAuth auth, CancellationToken ct) =>
        {
            await auth.SendEmailVerificationAsync(uid, ct);
            return Results.NoContent();
        });

        group.MapPost("/users/{uid}/verified", async (string uid, VerifiedRequest body, IWincheAuth auth, CancellationToken ct) =>
            Results.Json(User(await auth.SetEmailVerifiedAsync(uid, body.Verified, ct))));

        // The messages Winche Auth sends: built-in defaults, changeable here.
        group.MapGet("/email-templates", async (IWincheAuth auth, CancellationToken ct) =>
            Results.Json(new { templates = await auth.GetEmailTemplatesAsync(ct) }));

        group.MapPut("/email-templates/{kind}", async (string kind, TemplateRequest body, HttpContext http, IWincheAuth auth, CancellationToken ct) =>
        {
            await auth.SaveEmailTemplateAsync(kind, body.Subject ?? "", body.Body ?? "", AdminEmail(http.User), ct);
            return Results.NoContent();
        });

        group.MapDelete("/email-templates/{kind}", async (string kind, IWincheAuth auth, CancellationToken ct) =>
        {
            await auth.ResetEmailTemplateAsync(kind, ct);
            return Results.NoContent();
        });

        group.MapPost("/email-templates/{kind}/test", async (string kind, HttpContext http, IWincheAuth auth, CancellationToken ct) =>
        {
            if (AdminEmail(http.User) is not { } to)
                return Results.BadRequest(new { error = new { code = AuthErrorCodes.InvalidArgument, message = "Your console account has no email to send to." } });
            await auth.SendTestEmailAsync(kind, to, ct);
            return Results.Json(new { sentTo = to });
        });

        group.MapDelete("/users/{uid}", async (string uid, IWincheAuth auth, CancellationToken ct) =>
        {
            await auth.DeleteUserAsync(uid, ct);
            return Results.NoContent();
        });

        // How users sign in and how tokens are made: read-only, set in code.
        group.MapGet("/config", async (WincheAuthOptions o, SigningKeyStore keys, IServiceProvider sp, CancellationToken ct) =>
        {
            var tokens = sp.GetService<WincheTokenOptions>();
            return Results.Json(new
            {
                emailPassword = o.EmailPasswordSignIn is { } ep ? new { minLength = ep.MinLength, requireVerifiedEmail = ep.RequireVerifiedEmail } : null,
                email = o.EmailSending is { } es ? new
                {
                    appName = es.AppName,
                    actionUrl = es.ActionUrl ?? $"{o.Issuer.TrimEnd('/')}/auth/v1/action",
                    sendVerificationOnSignUp = es.SendVerificationOnSignUp,
                    maxPerAddressPerHour = es.MaxPerAddressPerHour,
                    logLinksOnly = es.LogLinksOnly,
                    sender = es.LogLinksOnly ? null : sp.GetService<Winche.Auth.Email.IAuthEmailSender>()?.GetType().Name,
                } : null,
                emailLink = o.EmailLinkSignIn is { } el ? new { linkUrl = el.LinkUrl } : null,
                anonymous = o.AnonymousSignIn,
                trustsWincheTokens = tokens?.TrustsWincheAuth ?? false,
                trustedIssuers = (tokens?.TrustedIssuers ?? []).Select(i => new
                {
                    name = i.Name, issuer = i.Issuer ?? i.Authority, authority = i.Authority, audience = i.ValidateAudience ? i.Audience : null,
                    uidClaim = i.UidClaim, claims = i.Claims,
                }),
                tokens = new
                {
                    issuer = o.Issuer,
                    audience = string.IsNullOrEmpty(o.Audience) ? o.Issuer : o.Audience,
                    accessTokenMinutes = o.AccessTokenLifetime.TotalMinutes,
                    refreshTokenDays = o.RefreshTokenLifetime.TotalDays,
                    keyRotationDays = o.KeyRotationInterval.TotalDays,
                    keysEncrypted = o.KeyEncryptionSecret is not null,
                },
                keys = (await keys.ListAsync(ct)).Select(k => new { kid = k.Kid, createdAt = k.CreatedAt, retiredAt = k.RetiredAt }),
                protection = new { maxFailedSignIns = o.MaxFailedSignIns, lockoutMinutes = o.LockoutDuration.TotalMinutes },
                hooks = new
                {
                    beforeCreate = o.Events.BeforeCreate is not null,
                    afterCreate = o.Events.AfterCreate is not null,
                    beforeSignIn = o.Events.BeforeSignIn is not null,
                },
            });
        });

        group.MapPost("/keys/rotate", async (SigningKeyStore keys, CancellationToken ct) =>
        {
            await keys.RotateAsync(ct);
            return Results.NoContent();
        });

        return app;
    }
}
