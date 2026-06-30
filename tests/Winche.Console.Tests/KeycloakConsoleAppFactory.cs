using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Winche.Console.Identity;

namespace Winche.Console.Tests;

/// <summary>Boots the sample host in Keycloak mode and validates bearer tokens against the in-test key.</summary>
public sealed class KeycloakConsoleAppFactory(PostgresFixture fx) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Winche:ConnectionString", fx.ConnectionString);
        builder.UseSetting("Console:Provider", "Keycloak");
        builder.UseSetting("Keycloak:Server", "https://kc.test");
        builder.UseSetting("Keycloak:Realm", "test");
        builder.UseSetting("Keycloak:Resource", KeycloakTokens.Audience);

        builder.ConfigureTestServices(services =>
        {
            services.PostConfigure<JwtBearerOptions>(ConsoleKeycloak.Scheme, o =>
            {
                o.Authority = null;
                o.MetadataAddress = null!;
                o.RequireHttpsMetadata = false;
                o.Configuration = new OpenIdConnectConfiguration();
                o.TokenValidationParameters.ValidateIssuerSigningKey = true;
                o.TokenValidationParameters.IssuerSigningKey = KeycloakTokens.SigningKey;
                o.TokenValidationParameters.ValidIssuer = KeycloakTokens.Issuer;
                o.TokenValidationParameters.ValidAudience = KeycloakTokens.Audience;
                o.TokenValidationParameters.ValidateIssuer = true;
                o.TokenValidationParameters.ValidateAudience = true;
                o.TokenValidationParameters.ValidateLifetime = true;
            });
        });
    }
}
