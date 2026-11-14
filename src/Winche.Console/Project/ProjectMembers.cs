using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Winche.Console.Api;
using Winche.Console.Email;
using Winche.Console.Identity;

namespace Winche.Console.Project;

/// <summary>
/// Who may use this project's console, and as what, when accounts are the server's and projects are many
/// (<c>UseProjectMembers()</c>; Winche Server's projects other than the first). Kept in the project's config database
/// (<c>winche_console_members</c>). Server admins (accounts with the Admin role) are admins of every project.
/// </summary>
public sealed class ProjectMembers
{
    internal const string Table = "winche_console_members";
    private static readonly string[] Schema =
    [
        $"""
        CREATE TABLE IF NOT EXISTS {Table} (
            user_id  uuid        PRIMARY KEY,
            role     text        NOT NULL,
            added_at timestamptz NOT NULL,
            added_by text        NULL
        );
        """,
    ];

    private readonly NpgsqlDataSource _db;
    private readonly ConcurrentDictionary<Guid, (string? Role, DateTimeOffset At)> _cache = new();
    private bool _ready;

    public ProjectMembers(IServiceProvider services) =>
        _db = services.GetKeyedService<NpgsqlDataSource>("WincheConfigOptions")
            ?? throw new InvalidOperationException("Project members need AddWincheConfig(…).");

    private async Task EnsureAsync(CancellationToken ct)
    {
        if (_ready) return;
        await Winche.Core.WincheSchema.EnsureAsync(_db, "console-members", Schema, ct);
        _ready = true;
    }

    /// <summary>The member's role here, or null (not a member). Cached for 30 seconds.</summary>
    public async Task<string?> RoleOfAsync(Guid userId, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(userId, out var hit) && DateTimeOffset.UtcNow - hit.At < TimeSpan.FromSeconds(30)) return hit.Role;
        await EnsureAsync(ct);
        await using var cmd = _db.CreateCommand($"SELECT role FROM {Table} WHERE user_id = $1");
        cmd.Parameters.AddWithValue(userId);
        var role = await cmd.ExecuteScalarAsync(ct) as string;
        _cache[userId] = (role, DateTimeOffset.UtcNow);
        return role;
    }

    public async Task<IReadOnlyList<(Guid UserId, string Role, DateTimeOffset AddedAt)>> ListAsync(CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        await using var cmd = _db.CreateCommand($"SELECT user_id, role, added_at FROM {Table} ORDER BY added_at");
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<(Guid, string, DateTimeOffset)>();
        while (await r.ReadAsync(ct)) list.Add((r.GetGuid(0), r.GetString(1), r.GetFieldValue<DateTimeOffset>(2)));
        return list;
    }

    public async Task SetAsync(Guid userId, string role, string? by, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        await using var cmd = _db.CreateCommand($"""
            INSERT INTO {Table} (user_id, role, added_at, added_by) VALUES ($1, $2, now(), $3)
            ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
            """);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(role);
        cmd.Parameters.AddWithValue((object?)by ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
        _cache.TryRemove(userId, out _);
    }

    public async Task RemoveAsync(Guid userId, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        await using var cmd = _db.CreateCommand($"DELETE FROM {Table} WHERE user_id = $1");
        cmd.Parameters.AddWithValue(userId);
        await cmd.ExecuteNonQueryAsync(ct);
        _cache.TryRemove(userId, out _);
    }
}

/// <summary>
/// Turns an account's server-wide roles into its role in this project: server admins stay Admin (and carry
/// <see cref="ServerAdminClaim"/>), everyone else gets their membership's role, or none.
/// </summary>
internal sealed class ProjectRoleClaims(ProjectMembers members) : IClaimsTransformation
{
    public const string ServerAdminClaim = "winche:server-admin";
    internal const string DoneClaim = "winche:project-role";

    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true || principal.HasClaim(c => c.Type == DoneClaim)) return principal;
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return principal;
        var serverAdmin = principal.IsInRole(ConsoleRoles.Admin);
        var role = serverAdmin ? ConsoleRoles.Admin : await members.RoleOfAsync(userId);

        var identity = new ClaimsIdentity(principal.Identity!.AuthenticationType, ClaimTypes.Name, ClaimTypes.Role);
        identity.AddClaims(principal.Claims.Where(c => c.Type != ClaimTypes.Role));
        // The account's own role stays readable (the first project, which goes by it, is listed from here too).
        foreach (var r in principal.FindAll(ClaimTypes.Role)) identity.AddClaim(new Claim(WincheProjectsCaller.AccountRoleClaim, r.Value));
        if (role is not null) identity.AddClaim(new Claim(ClaimTypes.Role, role));
        if (serverAdmin) identity.AddClaim(new Claim(ServerAdminClaim, "true"));
        identity.AddClaim(new Claim(DoneClaim, role ?? ""));
        return new ClaimsPrincipal(identity);
    }
}

public static class ProjectMemberEndpoints
{
    public sealed record AddRequest(string? Email, string? Role);
    public sealed record RoleRequest(string? Role);

    private static readonly string[] Roles = [ConsoleRoles.Admin, ConsoleRoles.Member, ConsoleRoles.Viewer];
    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;
    private static IResult Problem(string message) => ConsoleErrors.Problem("members", message, null);

    internal static IEndpointRouteBuilder MapConsoleProjectMemberEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/members").RequireAuthorization(ConsoleRoles.AdminPolicy);

        // The members, and the server admins (who are admins here without being listed).
        group.MapGet("", async (ProjectMembers members, UserManager<ConsoleUser> users, CancellationToken ct) =>
        {
            var list = await members.ListAsync(ct);
            var ids = list.Select(m => m.UserId).ToList();
            var accounts = await users.Users.Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
            var admins = await users.GetUsersInRoleAsync(ConsoleRoles.Admin);
            return Results.Json(new
            {
                members = list.Where(m => accounts.ContainsKey(m.UserId) && admins.All(a => a.Id != m.UserId)).Select(m => new
                {
                    userId = m.UserId, email = accounts[m.UserId].Email, firstName = accounts[m.UserId].FirstName, lastName = accounts[m.UserId].LastName,
                    role = m.Role, addedAt = m.AddedAt, passwordSet = accounts[m.UserId].PasswordHash is not null,
                }),
                serverAdmins = admins.Select(a => new { userId = a.Id, email = a.Email, firstName = a.FirstName, lastName = a.LastName }),
            });
        });

        // Adds someone by email: an existing account gets access at once; a new one is made (with access to nothing
        // else) and gets a link to set its password — emailed when sending is set up, else returned to share.
        group.MapPost("", async (AddRequest body, HttpContext http, ProjectMembers members, UserManager<ConsoleUser> users,
            ConsolePrefix prefix, IServiceProvider sp, CancellationToken ct) =>
        {
            var email = body.Email?.Trim();
            if (string.IsNullOrEmpty(email) || !email.Contains('@')) return Problem("Give their email address.");
            if (!Roles.Contains(body.Role)) return Problem("Pick Admin, Member or Viewer.");
            var user = await users.FindByEmailAsync(email);
            string? link = null;
            var emailed = false;
            if (user is null)
            {
                user = new ConsoleUser { UserName = email, Email = email, EmailConfirmed = true };
                var created = await users.CreateAsync(user);
                if (!created.Succeeded) return Problem(string.Join(" ", created.Errors.Select(e => e.Description)));
                var token = await users.GeneratePasswordResetTokenAsync(user);
                link = ConsoleLinks.ResetPasswordLink(http, prefix.Value, email, token);
                // Sent as a reset: the link sets the new account's password, then they sign in here.
                if (ConsoleEmail.Sender(sp) is { } sender)
                {
                    await sender.SendPasswordResetAsync(new ConsoleEmailRecipient(email, null, null), link, ct);
                    emailed = true;
                }
            }
            else if (await users.IsInRoleAsync(user, ConsoleRoles.Admin))
            {
                return Problem($"{email} is a server admin: an admin of every project already.");
            }
            await members.SetAsync(user.Id, body.Role!, Who(http.User), ct);
            return Results.Json(new { userId = user.Id, newAccount = link is not null, emailed, link = emailed ? null : link });
        });

        group.MapPut("/{userId:guid}", async (Guid userId, RoleRequest body, HttpContext http, ProjectMembers members, CancellationToken ct) =>
        {
            if (!Roles.Contains(body.Role)) return Problem("Pick Admin, Member or Viewer.");
            if (await members.RoleOfAsync(userId, ct) is null) return Results.NotFound();
            await members.SetAsync(userId, body.Role!, Who(http.User), ct);
            return Results.NoContent();
        });

        group.MapDelete("/{userId:guid}", async (Guid userId, ProjectMembers members, CancellationToken ct) =>
        {
            await members.RemoveAsync(userId, ct);
            return Results.NoContent();
        });
        return app;
    }
}
