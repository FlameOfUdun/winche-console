namespace Winche.Console.Identity;

/// <summary>Resolved Keycloak values the discovery endpoint advertises to the SPA. Registered as a singleton.</summary>
internal sealed class KeycloakRuntime
{
    public required string Authority { get; init; }
    public required string ClientId { get; init; }
    public required string Scopes { get; init; }
}
