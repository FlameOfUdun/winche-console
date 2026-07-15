using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Winche.Console;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Docker-free DI wiring tests for KeycloakOptions.BackchannelServer.</summary>
public class KeycloakBackchannelTests
{
    private static JwtBearerOptions Configure(string? backchannelServer)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddWincheConsole(o => o.UseKeycloak(k =>
        {
            k.Server = "https://auth.example.com";
            k.Realm = "app";
            k.ClientId = "console";
            k.BackchannelServer = backchannelServer;
        }));
        using var sp = services.BuildServiceProvider();
        return sp.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>().Get(ConsoleKeycloak.Scheme);
    }

    [Fact]
    public void BackchannelServer_redirects_metadata_to_internal_and_pins_public_issuer()
    {
        var opts = Configure("http://keycloak.internal:8080");

        Assert.Equal("http://keycloak.internal:8080/realms/app/.well-known/openid-configuration", opts.MetadataAddress);
        Assert.False(opts.RequireHttpsMetadata);                 // internal endpoint is plain http
        Assert.Equal("https://auth.example.com/realms/app", opts.TokenValidationParameters.ValidIssuer);
        Assert.NotNull(opts.ConfigurationManager);
    }

    [Fact]
    public void Without_backchannel_server_uses_public_authority()
    {
        var opts = Configure(backchannelServer: null);

        // Left to the default authority-based discovery under the public Server.
        Assert.Equal("https://auth.example.com/realms/app", opts.Authority);
        Assert.Null(opts.TokenValidationParameters.ValidIssuer);  // no explicit override; issuer from metadata
    }
}
