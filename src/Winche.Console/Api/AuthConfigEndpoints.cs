using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Winche.Console.Options;

namespace Winche.Console.Api;

public static class AuthConfigEndpoints
{
    /// <summary>Anonymous bootstrap: tells the SPA how to authenticate, for both providers.</summary>
    public static IEndpointRouteBuilder MapAuthConfigEndpoint(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        app.MapGet("/api/auth/config", (HttpContext http) =>
        {
            var kc = http.RequestServices.GetService<KeycloakRuntime>();
            if (options.Provider != ConsoleAuthProvider.Keycloak || kc is null)
                return Results.Json(new { provider = "identity" });
            return Results.Json(new { provider = "keycloak", authority = kc.Authority, clientId = kc.ClientId, scopes = kc.Scopes });
        });
        return app;
    }

    /// <summary>Keycloak-mode /api/auth/state: identity + roles projected from the bearer token's claims.</summary>
    public static IEndpointRouteBuilder MapKeycloakStateEndpoint(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        app.MapGet("/api/auth/state", (HttpContext http) =>
        {
            var user = http.User;
            var roles = user.FindAll(ClaimTypes.Role).Select(c => c.Value);
            var role = KeycloakRoleMap.HighestRole(roles, options.Keycloak);
            return Results.Json(new
            {
                provider = "keycloak",
                initialized = true,
                capabilities = new { manageUsers = false, invites = false, twoFactor = false, changePassword = false, editProfile = false },
                user = new
                {
                    id = user.FindFirstValue("sub"),
                    email = user.FindFirstValue("email"),
                    firstName = user.FindFirstValue("given_name"),
                    lastName = user.FindFirstValue("family_name"),
                    role,
                },
            });
        }).RequireAuthorization(ConsoleKeycloak.AuthenticatedPolicy);
        return app;
    }
}
