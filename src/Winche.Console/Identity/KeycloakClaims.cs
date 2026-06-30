using System.Security.Claims;
using System.Text.Json;

namespace Winche.Console.Identity;

/// <summary>
/// Flattens Keycloak realm + resource roles from a validated access token into <see cref="ClaimTypes.Role"/>
/// claims, so the console's <c>RequireRole(...)</c> policies work. Replaces the role transformation that
/// <c>Winche.KeycloakClient</c> performs for its own (default) scheme — the console owns an isolated scheme,
/// so it does this itself.
/// </summary>
internal static class KeycloakClaims
{
    /// <summary>Adds a role claim for each Keycloak realm role and resource role of <paramref name="clientId"/>.</summary>
    public static void AddRoleClaims(ClaimsPrincipal principal, string clientId)
    {
        if (principal.Identity is not ClaimsIdentity identity) return;
        foreach (var role in ExtractRoles(principal, clientId))
            if (!identity.HasClaim(ClaimTypes.Role, role))
                identity.AddClaim(new Claim(ClaimTypes.Role, role));
    }

    private static IEnumerable<string> ExtractRoles(ClaimsPrincipal principal, string clientId)
    {
        var roles = new List<string>();
        // realm_access: { "roles": [...] }
        ReadRolesArray(principal.FindFirst("realm_access")?.Value, roles);
        // resource_access: { "<clientId>": { "roles": [...] }, ... }
        var resourceAccess = principal.FindFirst("resource_access")?.Value;
        if (!string.IsNullOrEmpty(resourceAccess))
        {
            try
            {
                using var doc = JsonDocument.Parse(resourceAccess);
                if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                    doc.RootElement.TryGetProperty(clientId, out var client))
                    ReadRolesArray(client, roles);
            }
            catch (JsonException) { /* malformed claim: contribute no resource roles */ }
        }
        return roles;
    }

    private static void ReadRolesArray(string? json, List<string> into)
    {
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            ReadRolesArray(doc.RootElement, into);
        }
        catch (JsonException) { /* malformed claim: contribute no roles */ }
    }

    private static void ReadRolesArray(JsonElement container, List<string> into)
    {
        if (container.ValueKind == JsonValueKind.Object &&
            container.TryGetProperty("roles", out var roles) && roles.ValueKind == JsonValueKind.Array)
            foreach (var role in roles.EnumerateArray())
                if (role.ValueKind == JsonValueKind.String && role.GetString() is { Length: > 0 } s)
                    into.Add(s);
    }
}
