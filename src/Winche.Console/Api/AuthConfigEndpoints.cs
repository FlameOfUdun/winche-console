using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Console.Tabs;

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

            // The ConsoleKeycloakUser policy guarantees the caller is authenticated, but holding none of the
            // three console roles means no access. Return a null user + accessDenied so the SPA renders its
            // "no access" screen instead of the console shell, and advertise no capabilities. (Every data,
            // tab and rules endpoint already requires a concrete role and 403s such a caller.)
            if (role is null)
            {
                return Results.Json(new
                {
                    provider = "keycloak",
                    initialized = true,
                    accessDenied = true,
                    capabilities = new
                    {
                        manageUsers = false, invites = false, twoFactor = false, changePassword = false, editProfile = false,
                        database = false, storage = false,
                    },
                    user = (object?)null,
                });
            }

            var consoleRole = ConsoleRolePolicy.Highest(user, options);
            return Results.Json(new
            {
                provider = "keycloak",
                initialized = true,
                accessDenied = false,
                capabilities = new
                {
                    manageUsers = false, invites = false, twoFactor = false, changePassword = false, editProfile = false,
                    database = options.DatabaseTab is { } dt && consoleRole >= dt.MinRole,
                    storage = options.StorageTab is { } st && consoleRole >= st.MinRole,
                },
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
