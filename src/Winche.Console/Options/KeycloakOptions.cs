namespace Winche.Console.Options;

/// <summary>
/// Keycloak settings for the console's dedicated Keycloak client. Any value left null/empty is taken
/// from the host's <c>Keycloak</c> IConfiguration section instead; values set here override that section.
/// </summary>
public sealed class KeycloakOptions
{
    /// <summary>Keycloak base URL, no trailing slash, e.g. "https://id.example.com". Maps to Keycloak:Server.</summary>
    public string? Server { get; set; }

    /// <summary>Target realm. Maps to Keycloak:Realm.</summary>
    public string? Realm { get; set; }

    /// <summary>The dedicated console client id — used as the SPA's OIDC client and the API audience. Maps to Keycloak:Resource.</summary>
    public string? ClientId { get; set; }

    /// <summary>Optional secret, only if the console client is confidential. Maps to Keycloak:Credentials:Secret.</summary>
    public string? ClientSecret { get; set; }

    /// <summary>Keycloak role name that maps to the console Admin role.</summary>
    public string AdminRole { get; set; } = "Admin";

    /// <summary>Keycloak role name that maps to the console Member role.</summary>
    public string MemberRole { get; set; } = "Member";

    /// <summary>Keycloak role name that maps to the console Viewer role.</summary>
    public string ViewerRole { get; set; } = "Viewer";

    /// <summary>OAuth scopes the SPA requests. Default "openid profile email".</summary>
    public string Scopes { get; set; } = "openid profile email";

    /// <summary>
    /// Require HTTPS for OIDC metadata/JWKS retrieval. Default true. Set false only for a local/dev
    /// Keycloak served over plain HTTP.
    /// </summary>
    public bool RequireHttpsMetadata { get; set; } = true;
}
