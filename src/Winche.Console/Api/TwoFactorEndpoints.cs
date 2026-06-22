using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Winche.Console.Identity;

namespace Winche.Console.Api;

/// <summary>Self-service TOTP two-factor enrollment under <c>/api/auth/2fa</c>.</summary>
public static class TwoFactorEndpoints
{
    public sealed record CodeRequest(string Code);

    private const string Issuer = "Winche Console";

    public static IEndpointRouteBuilder MapTwoFactorEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth/2fa").RequireAuthorization(ConsoleRoles.ViewerPolicy);

        // Begin enrollment: (re)generate the authenticator key and return it + the otpauth URI for a QR.
        group.MapPost("/setup", async (UserManager<ConsoleUser> users, HttpContext http) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Unauthorized();
            await users.ResetAuthenticatorKeyAsync(user);
            var key = await users.GetAuthenticatorKeyAsync(user) ?? "";
            var email = user.Email ?? user.UserName ?? "user";
            var uri = $"otpauth://totp/{Uri.EscapeDataString($"{Issuer}:{email}")}" +
                      $"?secret={key}&issuer={Uri.EscapeDataString(Issuer)}&digits=6";
            return Results.Json(new { sharedKey = FormatKey(key), authenticatorUri = uri });
        });

        // Confirm enrollment: verify a code, enable 2FA, return one-time recovery codes.
        group.MapPost("/enable", async (CodeRequest body, UserManager<ConsoleUser> users, HttpContext http) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Unauthorized();
            var code = Normalize(body.Code);
            var ok = await users.VerifyTwoFactorTokenAsync(user, users.Options.Tokens.AuthenticatorTokenProvider, code);
            if (!ok) return Results.BadRequest(new { error = "Invalid code." });
            await users.SetTwoFactorEnabledAsync(user, true);
            var codes = (await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10))?.ToArray() ?? [];
            return Results.Json(new { recoveryCodes = codes });
        });

        group.MapPost("/disable", async (UserManager<ConsoleUser> users, HttpContext http) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Unauthorized();
            if (user.TwoFactorRequired)
                return Results.Json(new { error = "Two-factor is required by an administrator." }, statusCode: StatusCodes.Status403Forbidden);
            await users.SetTwoFactorEnabledAsync(user, false);
            await users.ResetAuthenticatorKeyAsync(user);
            return Results.Ok();
        });

        group.MapPost("/recovery-codes", async (UserManager<ConsoleUser> users, HttpContext http) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Unauthorized();
            var codes = (await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10))?.ToArray() ?? [];
            return Results.Json(new { recoveryCodes = codes });
        });

        return app;
    }

    private static string Normalize(string? code) => (code ?? "").Replace(" ", "").Replace("-", "");

    private static string FormatKey(string key)
    {
        var chunks = new List<string>();
        for (var i = 0; i < key.Length; i += 4) chunks.Add(key.Substring(i, Math.Min(4, key.Length - i)));
        return string.Join(" ", chunks).ToLowerInvariant();
    }
}
