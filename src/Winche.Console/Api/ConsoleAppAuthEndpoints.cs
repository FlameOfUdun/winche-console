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
using Winche.Console.Users;

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

    private static object User(DirectoryUser u) => new
    {
        uid = u.Uid, email = u.Email, emailVerified = u.EmailVerified, displayName = u.DisplayName, photoUrl = u.PhotoUrl,
        isAnonymous = u.IsAnonymous, disabled = u.Disabled, mfaEnabled = u.MfaEnabled, providers = u.Providers, customClaims = u.CustomClaims,
        createdAt = u.CreatedAt, lastSignInAt = u.LastSignInAt, lockedOutUntil = u.LockedOutUntil, groups = u.Groups, username = u.Username,
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

    private static async Task<object?> DirectoryInfoAsync(IServiceProvider sp, CancellationToken ct)
    {
        var directories = sp.GetRequiredService<UserDirectories>();
        if (directories.EffectiveKind == "none") return null;
        await using var scope = sp.CreateAsyncScope();
        var dir = await directories.CurrentAsync(scope.ServiceProvider, ct);
        return dir is null ? null : new { kind = dir.Kind, label = dir.Label, capabilities = dir.Capabilities };
    }

    public static IEndpointRouteBuilder MapConsoleAppAuthEndpoints(this IEndpointRouteBuilder app, bool wincheAuth = true)
    {
        var group = app.MapGroup("/api/app-auth").RequireAuthorization(ConsoleRoles.AdminPolicy).AddEndpointFilter(async (ctx, next) =>
        {
            try { return await next(ctx); }
            catch (AuthException ex) { return Error(ex); }
            catch (DirectoryNotSupportedException ex) { return Results.Json(new { error = new { code = "NOT_SUPPORTED", message = ex.Message } }, statusCode: 400); }
            catch (DirectoryException ex) { return Results.Json(new { error = new { code = "DIRECTORY", message = ex.Message } }, statusCode: ex.Status); }
        });

        // How users sign in and how tokens are made, as set in code (and, for providers, the console).
        group.MapGet("/config", async (IServiceProvider sp, CancellationToken ct) =>
        {
            var o = sp.GetService<WincheAuthOptions>();
            var keys = sp.GetService<SigningKeyStore>();
            var providers = sp.GetService<WincheTokenProviders>()?.Current;
            return Results.Json(new
            {
                wincheAuth = o is not null,
                directory = await DirectoryInfoAsync(sp, ct),
                trustedProviders = sp.GetService<WincheTokenProviders>() is not null,
                signInSettings = sp.GetService<Winche.Core.SettingsArea<Winche.Auth.Settings.WincheAuthSettings>>() is not null,
                emailPassword = o?.EmailPasswordSignIn is { } ep ? new { minLength = ep.MinLength, requireVerifiedEmail = ep.RequireVerifiedEmail } : null,
                email = o?.EmailSending is { } es ? new
                {
                    appName = es.AppName,
                    actionUrl = es.ActionUrl ?? $"{o.Issuer.TrimEnd('/')}/auth/v1/action",
                    sendVerificationOnSignUp = es.SendVerificationOnSignUp,
                    maxPerAddressPerHour = es.MaxPerAddressPerHour,
                    logLinksOnly = es.LogLinksOnly,
                    sender = es.LogLinksOnly ? null : sp.GetService<Winche.Auth.Email.IAuthEmailSender>()?.GetType().Name,
                } : null,
                emailLink = o?.EmailLinkSignIn is { } el ? new { linkUrl = el.LinkUrl } : null,
                mfa = o?.MfaSettings is { } m ? new { issuer = m.Issuer ?? o.EmailSending?.AppName ?? new Uri(o.Issuer).Host, recoveryCodes = m.RecoveryCodes, pendingMinutes = m.PendingLifetime.TotalMinutes } : null,
                identityProviders = (o?.IdentityProviders ?? []).Select(p => new
                {
                    name = p.Name, kind = p.Kind, displayName = p.DisplayName ?? p.Name, authority = p.Authority, audiences = p.Audiences,
                    useSubjectAsUid = p.UseSubjectAsUid, copiedClaims = p.CopiedClaims, testingOnly = p.AllowUnsignedTokensForTesting,
                }),
                anonymous = o?.AnonymousSignIn ?? false,
                trustsWincheTokens = providers?.TrustWincheAuth ?? false,
                trustedIssuers = (providers?.Providers ?? []).Select(i => new
                {
                    name = i.Name, issuer = i.Issuer, authority = i.Authority, audience = i.ValidateAudience ? string.Join(", ", i.Audiences) : null,
                    uidClaim = i.UidClaim, claims = i.Claims?.Select(c => c.From == c.To ? c.To : $"{c.From} → {c.To}"),
                }),
                tokens = o is null ? null : new
                {
                    issuer = o.Issuer,
                    audience = string.IsNullOrEmpty(o.Audience) ? o.Issuer : o.Audience,
                    accessTokenMinutes = o.AccessTokenLifetime.TotalMinutes,
                    refreshTokenDays = o.RefreshTokenLifetime.TotalDays,
                    keyRotationDays = o.KeyRotationInterval.TotalDays,
                    keysEncrypted = o.KeyEncryptionSecret is not null,
                },
                keys = keys is null ? [] : (await keys.ListAsync(ct)).Select(k => (object)new { kid = k.Kid, createdAt = k.CreatedAt, retiredAt = k.RetiredAt }),
                protection = o is null ? null : new { maxFailedSignIns = o.MaxFailedSignIns, lockoutMinutes = o.LockoutDuration.TotalMinutes },
                hooks = o is null ? null : new
                {
                    beforeCreate = o.Events.BeforeCreate is not null,
                    afterCreate = o.Events.AfterCreate is not null,
                    beforeSignIn = o.Events.BeforeSignIn is not null,
                },
            });
        });

        // The app's users, from the directory in force (Winche Auth or Keycloak).
        static async Task<IResult> WithDirectory(HttpContext http, UserDirectories directories, Func<IUserDirectory, Task<IResult>> body)
        {
            var dir = await directories.CurrentAsync(http.RequestServices, http.RequestAborted);
            return dir is null
                ? Results.Json(new { error = new { code = "NO_DIRECTORY", message = "No user directory is set: choose one in Settings → User directory." } }, statusCode: 404)
                : await body(dir);
        }

        group.MapGet("/users", ([FromQuery] string? search, [FromQuery] int? offset, [FromQuery] int? limit, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d =>
            {
                var (users, total) = await d.ListAsync(search, offset ?? 0, Math.Clamp(limit ?? 50, 1, 200), http.RequestAborted);
                return Results.Json(new { users = users.Select(User), total });
            }));

        group.MapPost("/users", (CreateUserRequest body, HttpContext http, UserDirectories dirs) => WithDirectory(http, dirs, async d =>
        {
            var email = string.IsNullOrWhiteSpace(body.Email) ? null : body.Email;
            var password = string.IsNullOrEmpty(body.Password) ? null : body.Password;
            return Results.Json(User(await d.CreateAsync(email, password, body.DisplayName, http.RequestAborted)));
        }));

        group.MapGet("/users/{uid}", (string uid, HttpContext http, UserDirectories dirs) => WithDirectory(http, dirs, async d =>
            await d.GetAsync(uid, http.RequestAborted) is { } detail
                ? Results.Json(new
                {
                    user = User(detail.User),
                    sessions = detail.Sessions,
                    mfa = detail.User.MfaEnabled ? new { recoveryCodesLeft = detail.RecoveryCodesLeft } : null,
                })
                : Results.NotFound()));

        group.MapPost("/users/{uid}/disabled", (string uid, DisabledRequest body, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => Results.Json(User(await d.SetDisabledAsync(uid, body.Disabled, http.RequestAborted)))));

        group.MapPut("/users/{uid}/claims", (string uid, ClaimsRequest body, HttpContext http, UserDirectories dirs) => WithDirectory(http, dirs, async d =>
        {
            IReadOnlyDictionary<string, object?>? claims = null;
            if (body.Claims is { ValueKind: JsonValueKind.Object } o) claims = (Dictionary<string, object?>)Plain(o)!;
            else if (body.Claims is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) })
                return Results.BadRequest(new { error = new { code = AuthErrorCodes.InvalidClaims, message = "Custom claims must be a JSON object." } });
            return Results.Json(User(await d.SetClaimsAsync(uid, claims, http.RequestAborted)));
        }));

        group.MapPost("/users/{uid}/signOut", (string uid, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => Results.Json(new { sessions = await d.SignOutEverywhereAsync(uid, http.RequestAborted) })));

        group.MapDelete("/users/{uid}/sessions/{id}", (string uid, string id, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => await d.RevokeSessionAsync(uid, id, http.RequestAborted) ? Results.NoContent() : Results.NotFound()));

        group.MapDelete("/users/{uid}/providers/{provider}", (string uid, string provider, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => Results.Json(User(await d.UnlinkProviderAsync(uid, provider, http.RequestAborted)))));

        // For someone who lost their authenticator app.
        group.MapDelete("/users/{uid}/mfa", (string uid, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => Results.Json(User(await d.ResetMfaAsync(uid, http.RequestAborted)))));

        group.MapPost("/users/{uid}/unlock", (string uid, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => Results.Json(User(await d.UnlockAsync(uid, http.RequestAborted)))));

        group.MapPost("/users/{uid}/sendPasswordReset", (string uid, HttpContext http, UserDirectories dirs) => WithDirectory(http, dirs, async d =>
        {
            await d.SendPasswordResetAsync(uid, http.RequestAborted);
            return Results.NoContent();
        }));

        group.MapPost("/users/{uid}/sendVerification", (string uid, HttpContext http, UserDirectories dirs) => WithDirectory(http, dirs, async d =>
        {
            await d.SendVerificationAsync(uid, http.RequestAborted);
            return Results.NoContent();
        }));

        group.MapPost("/users/{uid}/verified", (string uid, VerifiedRequest body, HttpContext http, UserDirectories dirs) =>
            WithDirectory(http, dirs, async d => Results.Json(User(await d.SetEmailVerifiedAsync(uid, body.Verified, http.RequestAborted)))));

        group.MapDelete("/users/{uid}", (string uid, HttpContext http, UserDirectories dirs) => WithDirectory(http, dirs, async d =>
        {
            await d.DeleteAsync(uid, http.RequestAborted);
            return Results.NoContent();
        }));

        if (!wincheAuth) return app;

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

        group.MapPost("/keys/rotate", async (SigningKeyStore keys, CancellationToken ct) =>
        {
            await keys.RotateAsync(ct);
            return Results.NoContent();
        });

        return app;
    }
}
