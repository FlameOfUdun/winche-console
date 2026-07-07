using System.Security.Claims;
using Winche.Console.Identity;
using Winche.Console.Options;

namespace Winche.Console.Tabs;

/// <summary>Minimum role required to see/use a custom tab. Ranked: Admin > Member > Viewer.</summary>
public enum ConsoleRole
{
    Viewer = 0,
    Member = 1,
    Admin = 2,
}

/// <summary>Maps <see cref="ConsoleRole"/> to the console's existing authorization policies and role claims.</summary>
internal static class ConsoleRolePolicy
{
    public static string For(ConsoleRole role) => role switch
    {
        ConsoleRole.Admin => ConsoleRoles.AdminPolicy,
        ConsoleRole.Member => ConsoleRoles.MemberPolicy,
        _ => ConsoleRoles.ViewerPolicy,
    };

    /// <summary>Highest console role the principal holds; defaults to Viewer. Provider-aware: in Keycloak
    /// mode the principal carries raw Keycloak role names, so we map them through
    /// <see cref="KeycloakRoleMap.HighestRole"/> (mirroring the /api/auth/state endpoint). In Identity mode
    /// the principal already carries canonical role claims.</summary>
    public static ConsoleRole Highest(ClaimsPrincipal user, ConsoleOptions options)
    {
        if (options.Provider == ConsoleAuthProvider.Keycloak)
        {
            var roleClaims = user.FindAll(ClaimTypes.Role).Select(c => c.Value);
            return KeycloakRoleMap.HighestRole(roleClaims, options.Keycloak) switch
            {
                ConsoleRoles.Admin => ConsoleRole.Admin,
                ConsoleRoles.Member => ConsoleRole.Member,
                _ => ConsoleRole.Viewer,
            };
        }

        return user.IsInRole(ConsoleRoles.Admin) ? ConsoleRole.Admin
            : user.IsInRole(ConsoleRoles.Member) ? ConsoleRole.Member
            : ConsoleRole.Viewer;
    }
}
