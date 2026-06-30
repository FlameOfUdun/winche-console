using Winche.Console.Options;

namespace Winche.Console.Identity;

/// <summary>Maps Keycloak role-claim values to the highest matching canonical console role.</summary>
internal static class KeycloakRoleMap
{
    /// <summary>Returns "Admin", "Member", "Viewer" (canonical <see cref="ConsoleRoles"/> names), or null if none match.</summary>
    public static string? HighestRole(IEnumerable<string> roleClaims, KeycloakOptions options)
    {
        var roles = new HashSet<string>(roleClaims, StringComparer.Ordinal);
        if (roles.Contains(options.AdminRole)) return ConsoleRoles.Admin;
        if (roles.Contains(options.MemberRole)) return ConsoleRoles.Member;
        if (roles.Contains(options.ViewerRole)) return ConsoleRoles.Viewer;
        return null;
    }
}
