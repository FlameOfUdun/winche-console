using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Winche.Console.Options;

namespace Winche.Console.Identity;

/// <summary>
/// Registers the console's own, isolated Keycloak authentication: a dedicated JWT-bearer scheme bound to
/// the console's dedicated Keycloak client, plus the three role policies (over that scheme) and an
/// authenticated-user policy. It deliberately does NOT use Winche.KeycloakClient — that package owns the
/// default "Bearer" scheme and a single global options instance, so reusing it would collide with the
/// consumer app's own Keycloak registration. By owning a separate scheme the console stays fully
/// independent of the host's Keycloak DI.
/// </summary>
internal static class ConsoleKeycloak
{
    /// <summary>
    /// Default name for the console's dedicated bearer scheme (distinct from the default "Bearer");
    /// overridable per-app via <see cref="Winche.Console.Options.KeycloakOptions.AuthPolicyScheme"/>.
    /// </summary>
    public const string Scheme = "WincheConsoleKeycloak";

    /// <summary>Authenticated-bearer policy used by /api/auth/state (identity without a console role).</summary>
    public const string AuthenticatedPolicy = "ConsoleKeycloakUser";

    public static IServiceCollection AddConsoleKeycloak(this IServiceCollection services, ConsoleOptions options)
    {
        var k = options.Keycloak;
        Require(k.Server, nameof(k.Server));
        Require(k.Realm, nameof(k.Realm));
        Require(k.ClientId, nameof(k.ClientId));

        var server = k.Server!.TrimEnd('/');
        var realm = k.Realm!;
        var clientId = k.ClientId!;   // the console's dedicated client
        var authority = $"{server}/realms/{realm}";
        var scheme = string.IsNullOrWhiteSpace(k.AuthPolicyScheme) ? Scheme : k.AuthPolicyScheme;

        services.AddSingleton(new KeycloakRuntime { Authority = authority, ClientId = clientId, Scopes = k.Scopes });

        // The console's OWN scheme + options instance. AddAuthentication() with no default scheme leaves the
        // host's default (and its "Bearer" scheme, if any) untouched.
        services.AddAuthentication().AddJwtBearer(scheme, o =>
        {
            o.Authority = authority;
            o.Audience = clientId;
            o.RequireHttpsMetadata = k.RequireHttpsMetadata;
            o.MapInboundClaims = false;   // keep sub/email/given_name/family_name as-is on the principal
            o.TokenValidationParameters.RoleClaimType = ClaimTypes.Role;

            // When the public Server isn't reachable server-to-server (behind a CDN/WAF that blocks the app's
            // egress), fetch OIDC metadata + JWKS from the internal BackchannelServer instead. The SPA still
            // uses the public authority; tokens carry — and are validated against — the public issuer.
            if (!string.IsNullOrWhiteSpace(k.BackchannelServer))
            {
                var backchannel = k.BackchannelServer!.TrimEnd('/');
                var backchannelMetadata = $"{backchannel}/realms/{realm}/.well-known/openid-configuration";
                o.MetadataAddress = backchannelMetadata;
                o.RequireHttpsMetadata = backchannel.StartsWith("https", StringComparison.OrdinalIgnoreCase);
                o.TokenValidationParameters.ValidIssuer = authority;
                o.ConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
                    backchannelMetadata,
                    new OpenIdConnectConfigurationRetriever(),
                    new BackchannelRewriteDocumentRetriever(server, backchannel));
            }

            o.Events = new JwtBearerEvents
            {
                // Flatten Keycloak realm + resource roles into ClaimTypes.Role so RequireRole(...) works.
                OnTokenValidated = ctx =>
                {
                    if (ctx.Principal is not null) KeycloakClaims.AddRoleClaims(ctx.Principal, clientId);
                    return Task.CompletedTask;
                },
            };
        });

        // The SAME three policy names as Identity mode, now bound to the console scheme and the host-mapped
        // Keycloak role names. Endpoints that reference ConsoleRoles.*Policy are untouched.
        services.AddAuthorizationBuilder()
            .AddPolicy(ConsoleRoles.ViewerPolicy, p => p.AddAuthenticationSchemes(scheme)
                .RequireRole(k.ViewerRole, k.MemberRole, k.AdminRole))
            .AddPolicy(ConsoleRoles.MemberPolicy, p => p.AddAuthenticationSchemes(scheme)
                .RequireRole(k.MemberRole, k.AdminRole))
            .AddPolicy(ConsoleRoles.AdminPolicy, p => p.AddAuthenticationSchemes(scheme)
                .RequireRole(k.AdminRole))
            .AddPolicy(AuthenticatedPolicy, p => p.AddAuthenticationSchemes(scheme)
                .RequireAuthenticatedUser());

        return services;
    }

    private static void Require(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException(
                $"Keycloak mode requires KeycloakOptions.{name}. Set it via AddWincheConsole(o => o.UseKeycloak(k => k.{name} = ...)).");
    }
}
