using Microsoft.Extensions.DependencyInjection;
using Winche.Console;
using Winche.Console.Options;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>Keycloak mode requires Server/Realm/ClientId to be set explicitly via UseKeycloak.</summary>
public class KeycloakOptionsValidationTests
{
    private static IServiceCollection Configure(Action<KeycloakOptions> k) =>
        new ServiceCollection().AddWincheConsole(o => o.UseKeycloak(k));

    [Fact]
    public void Throws_when_ClientId_missing()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            Configure(k => { k.Server = "https://id.test"; k.Realm = "r1"; }));
        Assert.Contains("ClientId", ex.Message);
    }

    [Fact]
    public void Throws_when_Server_missing()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            Configure(k => { k.Realm = "r1"; k.ClientId = "winche-console"; }));
        Assert.Contains("Server", ex.Message);
    }

    [Fact]
    public void Throws_when_Realm_missing()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            Configure(k => { k.Server = "https://id.test"; k.ClientId = "winche-console"; }));
        Assert.Contains("Realm", ex.Message);
    }

    [Fact]
    public void Succeeds_when_all_required_values_present()
    {
        var ex = Record.Exception(() =>
            Configure(k => { k.Server = "https://id.test"; k.Realm = "r1"; k.ClientId = "winche-console"; }));
        Assert.Null(ex);
    }
}
