using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;
using Winche.Console.Identity;

namespace Winche.Console.Api;

/// <summary>Invite management (Admin) under <c>/api/invites</c> + anonymous acceptance under
/// <c>/api/invites/accept</c>. The user account is created only on accept.</summary>
public static class InviteEndpoints
{
    public sealed record CreateInviteRequest(string Email, string Role, string? FirstName, string? LastName,
        bool RequireName, bool RequireTwoFactor, int ExpiresInHours);
    public sealed record AcceptInviteRequest(string Token, string Password, string? FirstName, string? LastName);

    public static IEndpointRouteBuilder MapInviteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/invites").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/", async (ConsoleIdentityDbContext db) =>
        {
            var now = DateTimeOffset.UtcNow;
            var list = await db.Invites.Where(i => i.AcceptedAt == null)
                .OrderByDescending(i => i.CreatedAt).ToListAsync();
            return Results.Json(list.Select(i => Dto(i, now)));
        });

        group.MapPost("/", async (CreateInviteRequest body, ConsoleIdentityDbContext db,
            UserManager<ConsoleUser> users, IServiceProvider sp, ConsoleInviteTokens tokens,
            ConsolePrefix prefix, HttpContext http) =>
        {
            if (string.IsNullOrWhiteSpace(body.Email)) return Results.BadRequest(new { error = "Email is required." });
            if (!ConsoleRoles.All.Contains(body.Role)) return Results.BadRequest(new { error = "Invalid role." });
            if (body.ExpiresInHours is < 1 or > 720) return Results.BadRequest(new { error = "Expiry must be 1–720 hours." });

            var sender = sp.GetService<IConsoleEmailSender>();
            if (sender is null) return Results.BadRequest(new { error = "Invites require an email sender." });

            var email = body.Email.Trim().ToLowerInvariant();
            if (await users.FindByEmailAsync(email) is not null)
                return Results.Conflict(new { error = "A user with that email already exists." });

            var now = DateTimeOffset.UtcNow;
            if (await db.Invites.AnyAsync(i => i.Email == email && i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now))
                return Results.Conflict(new { error = "A pending invite already exists for that email." });

            var invite = new ConsoleInvite
            {
                Id = Guid.NewGuid(), Email = email, Role = body.Role,
                FirstName = body.FirstName, LastName = body.LastName,
                RequireName = body.RequireName, RequireTwoFactor = body.RequireTwoFactor,
                CreatedAt = now, ExpiresAt = now.AddHours(body.ExpiresInHours),
                CreatedByUserId = Guid.TryParse(users.GetUserId(http.User), out var adminId) ? adminId : null,
            };
            db.Invites.Add(invite);
            await db.SaveChangesAsync();

            var link = MintLink(tokens, invite, TimeSpan.FromHours(body.ExpiresInHours), http, prefix.Value);
            await sender.SendInviteAsync(new ConsoleEmailRecipient(invite.Email, invite.FirstName, invite.LastName), link, http.RequestAborted);
            return Results.Json(Dto(invite, now, link));
        });

        group.MapGet("/{id:guid}/link", async (Guid id, ConsoleIdentityDbContext db, ConsoleInviteTokens tokens,
            ConsolePrefix prefix, HttpContext http) =>
        {
            var invite = await db.Invites.FindAsync(id);
            var now = DateTimeOffset.UtcNow;
            if (invite is null || invite.Status(now) != "pending") return Results.StatusCode(StatusCodes.Status410Gone);
            var link = MintLink(tokens, invite, invite.ExpiresAt - now, http, prefix.Value);
            return Results.Json(new { link });
        });

        group.MapPost("/{id:guid}/resend", async (Guid id, ConsoleIdentityDbContext db, IServiceProvider sp,
            ConsoleInviteTokens tokens, ConsolePrefix prefix, HttpContext http) =>
        {
            var invite = await db.Invites.FindAsync(id);
            if (invite is null) return Results.NotFound();
            if (invite.AcceptedAt is not null) return Results.Conflict(new { error = "Invite already accepted." });
            var sender = sp.GetService<IConsoleEmailSender>();
            if (sender is null) return Results.BadRequest(new { error = "Invites require an email sender." });

            var now = DateTimeOffset.UtcNow;
            var lifetime = invite.ExpiresAt - invite.CreatedAt;
            if (lifetime <= TimeSpan.Zero) lifetime = TimeSpan.FromHours(72);
            invite.CreatedAt = now;
            invite.ExpiresAt = now.Add(lifetime);
            invite.RevokedAt = null;
            await db.SaveChangesAsync();

            var link = MintLink(tokens, invite, lifetime, http, prefix.Value);
            await sender.SendInviteAsync(new ConsoleEmailRecipient(invite.Email, invite.FirstName, invite.LastName), link, http.RequestAborted);
            return Results.Json(new { link });
        });

        group.MapDelete("/{id:guid}", async (Guid id, ConsoleIdentityDbContext db) =>
        {
            var invite = await db.Invites.FindAsync(id);
            if (invite is null) return Results.NotFound();
            if (invite.AcceptedAt is not null) return Results.Conflict(new { error = "Invite already accepted." });
            if (invite.RevokedAt is null) { invite.RevokedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(); }
            return Results.NoContent();
        });

        var accept = app.MapGroup("/api/invites/accept");

        accept.MapGet("/", async (string? token, ConsoleIdentityDbContext db, ConsoleInviteTokens tokens) =>
        {
            if (!tokens.TryUnprotect(token, out var id)) return Results.StatusCode(StatusCodes.Status410Gone);
            var invite = await db.Invites.FindAsync(id);
            var now = DateTimeOffset.UtcNow;
            if (invite is null || invite.Status(now) != "pending") return Results.StatusCode(StatusCodes.Status410Gone);
            return Results.Json(new
            {
                email = invite.Email, firstName = invite.FirstName, lastName = invite.LastName,
                requireName = invite.RequireName, requireTwoFactor = invite.RequireTwoFactor,
            });
        });

        accept.MapPost("/", async (AcceptInviteRequest body, ConsoleIdentityDbContext db, UserManager<ConsoleUser> users,
            ConsoleInviteTokens tokens) =>
        {
            if (!tokens.TryUnprotect(body.Token, out var id)) return Results.StatusCode(StatusCodes.Status410Gone);
            var invite = await db.Invites.FindAsync(id);
            var now = DateTimeOffset.UtcNow;
            if (invite is null || invite.Status(now) != "pending") return Results.StatusCode(StatusCodes.Status410Gone);

            var firstName = string.IsNullOrWhiteSpace(body.FirstName) ? invite.FirstName : body.FirstName.Trim();
            var lastName = string.IsNullOrWhiteSpace(body.LastName) ? invite.LastName : body.LastName.Trim();
            if (invite.RequireName && (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName)))
                return Results.BadRequest(new { error = "First and last name are required." });

            if (await users.FindByEmailAsync(invite.Email) is not null)
                return Results.Conflict(new { error = "A user with that email already exists." });

            var user = new ConsoleUser
            {
                UserName = invite.Email, Email = invite.Email, EmailConfirmed = true, Active = true,
                FirstName = firstName, LastName = lastName, TwoFactorRequired = invite.RequireTwoFactor,
            };
            var created = await users.CreateAsync(user, body.Password ?? "");
            if (!created.Succeeded)
                return Results.BadRequest(new { error = string.Join("; ", created.Errors.Select(e => e.Description)) });
            await users.AddToRoleAsync(user, invite.Role);

            invite.AcceptedAt = now;
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        return app;
    }

    private static string MintLink(ConsoleInviteTokens tokens, ConsoleInvite invite, TimeSpan lifetime,
        HttpContext http, string prefix) =>
        ConsoleLinks.InviteLink(http, prefix, tokens.Protect(invite.Id, lifetime));

    private static object Dto(ConsoleInvite i, DateTimeOffset now, string? link = null) => new
    {
        id = i.Id, email = i.Email, role = i.Role, firstName = i.FirstName, lastName = i.LastName,
        requireName = i.RequireName, requireTwoFactor = i.RequireTwoFactor,
        createdAt = i.CreatedAt, expiresAt = i.ExpiresAt, status = i.Status(now), link,
    };
}
