using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;
using Winche.Console.Identity;
using Winche.Console.Options;

namespace Winche.Console.Api;

public static class AuthEndpoints
{
    public sealed record SetupRequest(string Email, string? FirstName, string? LastName, string Password);
    public sealed record LoginRequest(string Email, string Password);
    public sealed record TwoFactorLoginRequest(string Code, bool? RememberMachine);
    public sealed record RecoveryLoginRequest(string RecoveryCode);
    public sealed record ProfileRequest(string? FirstName, string? LastName);
    public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public sealed record ForgotPasswordRequest(string Email);
    public sealed record ResetPasswordBody(string Email, string Token, string NewPassword);

    // In Identity mode the console owns the full lifecycle; manageUsers is role-gated client-side (Admin only).
    private static readonly object IdentityCapabilities = new
    {
        manageUsers = true, invites = true, twoFactor = true, changePassword = true, editProfile = true,
    };

    private static bool ResetEnabled(IServiceProvider sp, ConsoleOptions options) =>
        sp.GetService<IConsoleEmailSender>() is not null && options.AllowSelfServicePasswordReset;

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        // Anonymous: current session + whether the console has been initialized.
        auth.MapGet("/state", async (HttpContext http, UserManager<ConsoleUser> users, IServiceProvider sp, ConsoleOptions options) =>
        {
            var initialized = users.Users.Any();
            var selfServiceResetEnabled = ResetEnabled(sp, options);
            // /state is anonymous, so http.User is not populated by the (no-default-scheme) auth middleware.
            // Read the console cookie explicitly to reflect the current session.
            var authResult = await http.AuthenticateAsync(IdentityConstants.ApplicationScheme);
            var principal = authResult.Succeeded ? authResult.Principal : null;
            if (principal is null)
                return Results.Json(new { provider = "identity", capabilities = IdentityCapabilities, initialized, selfServiceResetEnabled, user = (object?)null });

            var user = await users.GetUserAsync(principal);
            if (user is null)
                return Results.Json(new { provider = "identity", capabilities = IdentityCapabilities, initialized, selfServiceResetEnabled, user = (object?)null });
            var role = (await users.GetRolesAsync(user)).FirstOrDefault();
            return Results.Json(new
            {
                provider = "identity",
                capabilities = IdentityCapabilities,
                initialized,
                selfServiceResetEnabled,
                user = new
                {
                    id = user.Id,
                    email = user.Email,
                    firstName = user.FirstName,
                    lastName = user.LastName,
                    role,
                    twoFactorEnabled = user.TwoFactorEnabled,
                    twoFactorRequired = user.TwoFactorRequired,
                    mustSetupTwoFactor = user.TwoFactorRequired && !user.TwoFactorEnabled,
                },
            });
        });

        // First-run only: create the first account as Admin.
        auth.MapPost("/setup", async (SetupRequest body, UserManager<ConsoleUser> users) =>
        {
            if (users.Users.Any()) return Results.Conflict(new { error = "Already initialized." });
            if (string.IsNullOrWhiteSpace(body.Email) || string.IsNullOrWhiteSpace(body.Password))
                return Results.BadRequest(new { error = "Email and password are required." });

            var user = new ConsoleUser
            {
                UserName = body.Email,
                Email = body.Email,
                EmailConfirmed = true,
                Active = true,
                FirstName = body.FirstName,
                LastName = body.LastName,
            };
            var created = await users.CreateAsync(user, body.Password);
            if (!created.Succeeded)
                return Results.BadRequest(new { error = string.Join("; ", created.Errors.Select(e => e.Description)) });
            await users.AddToRoleAsync(user, ConsoleRoles.Admin);
            return Results.Ok(new { email = user.Email });
        });

        // Self-service password reset (anonymous). Available only when an email sender is registered
        // and self-service reset is allowed. Always returns 200 (never reveals whether the email exists).
        auth.MapPost("/forgot-password", async (ForgotPasswordRequest body, UserManager<ConsoleUser> users,
            IServiceProvider sp, ConsoleOptions options, ConsolePrefix prefix, HttpContext http) =>
        {
            var sender = sp.GetService<IConsoleEmailSender>();
            if (sender is null || !options.AllowSelfServicePasswordReset) return Results.NotFound();

            var user = string.IsNullOrWhiteSpace(body.Email) ? null : await users.FindByEmailAsync(body.Email);
            if (user is { Active: true })
            {
                var token = await users.GeneratePasswordResetTokenAsync(user);
                var link = ConsoleLinks.ResetPasswordLink(http, prefix.Value, user.Email!, token);
                await sender.SendPasswordResetAsync(new ConsoleEmailRecipient(user.Email!, user.FirstName, user.LastName), link, http.RequestAborted);
            }
            return Results.Ok();
        });

        // Complete a reset / set an invited user's initial password (anonymous). Gated on email being
        // configured (invites also flow through this endpoint).
        auth.MapPost("/reset-password", async (ResetPasswordBody body, UserManager<ConsoleUser> users, IServiceProvider sp) =>
        {
            if (sp.GetService<IConsoleEmailSender>() is null) return Results.NotFound();
            var user = string.IsNullOrWhiteSpace(body.Email) ? null : await users.FindByEmailAsync(body.Email);
            if (user is null) return Results.BadRequest(new { error = "Invalid or expired token." });
            var result = await users.ResetPasswordAsync(user, body.Token ?? "", body.NewPassword ?? "");
            return result.Succeeded ? Results.Ok() : Results.BadRequest(new { error = "Invalid or expired token." });
        });

        auth.MapPost("/login", async (LoginRequest body, SignInManager<ConsoleUser> signIn, UserManager<ConsoleUser> users) =>
        {
            var user = await users.FindByEmailAsync(body.Email ?? "");
            if (user is null) return Results.Unauthorized();
            if (!user.Active)
                return Results.Json(new { error = "Account is disabled." }, statusCode: StatusCodes.Status403Forbidden);

            var result = await signIn.PasswordSignInAsync(user, body.Password ?? "", isPersistent: true, lockoutOnFailure: true);
            if (result.IsLockedOut)
                return Results.Json(new { error = "Account locked. Try again later." }, statusCode: StatusCodes.Status423Locked);
            if (result.RequiresTwoFactor)
                return Results.Ok(new { requiresTwoFactor = true });
            if (!result.Succeeded) return Results.Unauthorized();

            var role = (await users.GetRolesAsync(user)).FirstOrDefault();
            return Results.Ok(new { user = new { id = user.Id, email = user.Email, role } });
        });

        // Complete a two-factor challenge with an authenticator code.
        auth.MapPost("/login/2fa", async (TwoFactorLoginRequest body, SignInManager<ConsoleUser> signIn, UserManager<ConsoleUser> users) =>
        {
            var pending = await signIn.GetTwoFactorAuthenticationUserAsync();
            if (pending is null) return Results.Unauthorized();
            var code = (body.Code ?? "").Replace(" ", "").Replace("-", "");
            var result = await signIn.TwoFactorAuthenticatorSignInAsync(code, isPersistent: true, rememberClient: body.RememberMachine ?? false);
            if (!result.Succeeded) return Results.Unauthorized();
            var role = (await users.GetRolesAsync(pending)).FirstOrDefault();
            return Results.Ok(new { user = new { id = pending.Id, email = pending.Email, role } });
        });

        // Complete a two-factor challenge with a recovery code.
        auth.MapPost("/login/recovery", async (RecoveryLoginRequest body, SignInManager<ConsoleUser> signIn, UserManager<ConsoleUser> users) =>
        {
            var pending = await signIn.GetTwoFactorAuthenticationUserAsync();
            if (pending is null) return Results.Unauthorized();
            var result = await signIn.TwoFactorRecoveryCodeSignInAsync((body.RecoveryCode ?? "").Replace(" ", ""));
            if (!result.Succeeded) return Results.Unauthorized();
            var role = (await users.GetRolesAsync(pending)).FirstOrDefault();
            return Results.Ok(new { user = new { id = pending.Id, email = pending.Email, role } });
        });

        auth.MapPost("/logout", async (SignInManager<ConsoleUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.Ok();
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        // Self-service: any authenticated user manages their own name + password.
        auth.MapPut("/profile", async (ProfileRequest body, UserManager<ConsoleUser> users, HttpContext http) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Unauthorized();
            if (body.FirstName is not null) user.FirstName = body.FirstName;
            if (body.LastName is not null) user.LastName = body.LastName;
            var result = await users.UpdateAsync(user);
            return result.Succeeded
                ? Results.Ok()
                : Results.BadRequest(new { error = string.Join("; ", result.Errors.Select(e => e.Description)) });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        auth.MapPost("/password", async (ChangePasswordRequest body, UserManager<ConsoleUser> users, HttpContext http) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Unauthorized();
            var result = await users.ChangePasswordAsync(user, body.CurrentPassword ?? "", body.NewPassword ?? "");
            return result.Succeeded
                ? Results.Ok()
                : Results.BadRequest(new { error = string.Join("; ", result.Errors.Select(e => e.Description)) });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        return app;
    }
}
