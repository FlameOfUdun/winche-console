using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;
using Winche.Console.Identity;

namespace Winche.Console.Api;

/// <summary>Admin-only account management under <c>/api/users</c>.</summary>
public static class UserEndpoints
{
    public sealed record CreateUserRequest(string Email, string? FirstName, string? LastName, string Role, string? Password);
    public sealed record UpdateUserRequest(string? FirstName, string? LastName, string? Email, string? Role, bool? Active, bool? TwoFactorRequired);
    public sealed record ResetPasswordRequest(string? NewPassword);

    public static IEndpointRouteBuilder MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/users").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/", async (UserManager<ConsoleUser> users) =>
        {
            var list = new List<object>();
            foreach (var u in users.Users.ToList())
            {
                var role = (await users.GetRolesAsync(u)).FirstOrDefault();
                list.Add(new
                {
                    id = u.Id, email = u.Email, firstName = u.FirstName, lastName = u.LastName,
                    role, active = u.Active, twoFactorEnabled = u.TwoFactorEnabled,
                    twoFactorRequired = u.TwoFactorRequired, lockedOut = await users.IsLockedOutAsync(u),
                });
            }
            return Results.Json(list);
        });

        group.MapPost("/", async (CreateUserRequest body, UserManager<ConsoleUser> users,
            IServiceProvider sp, ConsolePrefix prefix, HttpContext http) =>
        {
            if (string.IsNullOrWhiteSpace(body.Email)) return Results.BadRequest(new { error = "Email is required." });
            if (!ConsoleRoles.All.Contains(body.Role)) return Results.BadRequest(new { error = "Invalid role." });

            var sender = sp.GetService<IConsoleEmailSender>();
            var hasPassword = !string.IsNullOrWhiteSpace(body.Password);
            if (!hasPassword && sender is null)
                return Results.BadRequest(new { error = "A password is required (email invites are not configured)." });

            var user = new ConsoleUser
            {
                UserName = body.Email, Email = body.Email, EmailConfirmed = true, Active = true,
                FirstName = body.FirstName, LastName = body.LastName,
            };
            var created = hasPassword ? await users.CreateAsync(user, body.Password!) : await users.CreateAsync(user);
            if (!created.Succeeded) return Errors(created);
            await users.AddToRoleAsync(user, body.Role);

            if (!hasPassword)   // invite: email a set-password link
            {
                var token = await users.GeneratePasswordResetTokenAsync(user);
                var link = ConsoleLinks.ResetPasswordLink(http, prefix.Value, user.Email!, token);
                await sender!.SendInviteAsync(new ConsoleEmailRecipient(user.Email!, user.FirstName, user.LastName), link, http.RequestAborted);
            }
            return Results.Json(new { id = user.Id, email = user.Email, invited = !hasPassword });
        });

        group.MapPut("/{id}", async (string id, UpdateUserRequest body, UserManager<ConsoleUser> users) =>
        {
            var user = await users.FindByIdAsync(id);
            if (user is null) return Results.NotFound();
            var currentRole = (await users.GetRolesAsync(user)).FirstOrDefault();

            // Last-admin guards: demotion or deactivation of the only admin is rejected.
            var demoting = body.Role is not null && body.Role != ConsoleRoles.Admin && currentRole == ConsoleRoles.Admin;
            var deactivating = body.Active == false && user.Active;
            if ((demoting || deactivating) && currentRole == ConsoleRoles.Admin && await IsLastAdmin(users, user))
                return Results.BadRequest(new { error = "Cannot demote or deactivate the last admin." });

            if (body.FirstName is not null) user.FirstName = body.FirstName;
            if (body.LastName is not null) user.LastName = body.LastName;
            if (body.Active is { } active) user.Active = active;
            if (body.TwoFactorRequired is { } tfr) user.TwoFactorRequired = tfr;

            if (!string.IsNullOrWhiteSpace(body.Email) && !string.Equals(body.Email, user.Email, StringComparison.OrdinalIgnoreCase))
            {
                var setEmail = await users.SetEmailAsync(user, body.Email);
                if (!setEmail.Succeeded) return Errors(setEmail);
                var setName = await users.SetUserNameAsync(user, body.Email);
                if (!setName.Succeeded) return Errors(setName);
            }

            var update = await users.UpdateAsync(user);
            if (!update.Succeeded) return Errors(update);

            if (body.Role is not null && ConsoleRoles.All.Contains(body.Role) && body.Role != currentRole)
                await SetSingleRole(users, user, body.Role);

            return Results.Ok();
        });

        group.MapPost("/{id}/reset-password", async (string id, ResetPasswordRequest body, UserManager<ConsoleUser> users,
            IServiceProvider sp, ConsolePrefix prefix, HttpContext http) =>
        {
            var user = await users.FindByIdAsync(id);
            if (user is null) return Results.NotFound();

            if (string.IsNullOrWhiteSpace(body.NewPassword))
            {
                // Email mode: send the user a reset link (requires the email adapter).
                var sender = sp.GetService<IConsoleEmailSender>();
                if (sender is null) return Results.BadRequest(new { error = "Provide a new password (email is not configured)." });
                var resetToken = await users.GeneratePasswordResetTokenAsync(user);
                var link = ConsoleLinks.ResetPasswordLink(http, prefix.Value, user.Email!, resetToken);
                await sender.SendPasswordResetAsync(new ConsoleEmailRecipient(user.Email!, user.FirstName, user.LastName), link, http.RequestAborted);
                return Results.Ok();
            }

            var token = await users.GeneratePasswordResetTokenAsync(user);
            var reset = await users.ResetPasswordAsync(user, token, body.NewPassword);
            return reset.Succeeded ? Results.Ok() : Errors(reset);
        });

        group.MapPost("/{id}/unlock", async (string id, UserManager<ConsoleUser> users) =>
        {
            var user = await users.FindByIdAsync(id);
            if (user is null) return Results.NotFound();
            await users.SetLockoutEndDateAsync(user, null);
            await users.ResetAccessFailedCountAsync(user);
            return Results.Ok();
        });

        group.MapDelete("/{id}", async (string id, UserManager<ConsoleUser> users) =>
        {
            var user = await users.FindByIdAsync(id);
            if (user is null) return Results.NotFound();
            var role = (await users.GetRolesAsync(user)).FirstOrDefault();
            if (role == ConsoleRoles.Admin && await IsLastAdmin(users, user))
                return Results.BadRequest(new { error = "Cannot delete the last admin." });
            var deleted = await users.DeleteAsync(user);
            return deleted.Succeeded ? Results.NoContent() : Errors(deleted);
        });

        return app;
    }

    private static async Task<bool> IsLastAdmin(UserManager<ConsoleUser> users, ConsoleUser user)
    {
        var admins = await users.GetUsersInRoleAsync(ConsoleRoles.Admin);
        return admins.Count <= 1 && admins.Any(a => a.Id == user.Id);
    }

    private static async Task SetSingleRole(UserManager<ConsoleUser> users, ConsoleUser user, string role)
    {
        var current = await users.GetRolesAsync(user);
        if (current.Count > 0) await users.RemoveFromRolesAsync(user, current);
        await users.AddToRoleAsync(user, role);
    }

    private static IResult Errors(IdentityResult result) =>
        Results.BadRequest(new { error = string.Join("; ", result.Errors.Select(e => e.Description)) });
}
