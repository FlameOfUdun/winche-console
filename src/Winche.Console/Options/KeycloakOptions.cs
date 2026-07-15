namespace Winche.Console.Options;

/// <summary>
/// Keycloak settings for the console's dedicated Keycloak client. Any value left null/empty is taken
/// from the host's <c>Keycloak</c> IConfiguration section instead; values set here override that section.
/// </summary>
public sealed class KeycloakOptions
{
    /// <summary>Keycloak base URL, no trailing slash, e.g. "https://id.example.com". Maps to Keycloak:Server.</summary>
    public string? Server { get; set; }

    /// <summary>
    /// Optional internal Keycloak base URL the backend uses to fetch OIDC metadata + JWKS (e.g.
    /// "http://keycloak.internal:8080"), for when the public <see cref="Server"/> is not reachable
    /// server-to-server — typically because it sits behind a CDN/WAF (e.g. Cloudflare) that blocks the app's
    /// egress IP. The browser SPA still logs in against the public <see cref="Server"/>; only the backend's
    /// document retrieval is redirected here (including the JWKS, whose URL Keycloak advertises as the public
    /// host), and tokens are still validated against the public issuer. Leave null to use <see cref="Server"/>
    /// for everything.
    /// </summary>
    public string? BackchannelServer { get; set; }

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

    /// <summary>
    /// Name of the dedicated JWT-bearer authentication scheme the console registers for its own endpoints
    /// (distinct from the host's default "Bearer"). Defaults to "WincheConsoleKeycloak". Override it to
    /// avoid a clash with a scheme the host already registers, or to give the host a stable name to target
    /// — e.g. a path-based <c>ForwardDefaultSelector</c> that routes console requests to this scheme.
    /// </summary>
    public string AuthPolicyScheme { get; set; } = "WincheConsoleKeycloak";
}
