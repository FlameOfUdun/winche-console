using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Winche.Console.Tests;

/// <summary>Boots the sample host (which calls AddWincheConsole) against the test container DB.</summary>
public sealed class ConsoleAppFactory(PostgresFixture fx) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // UseSetting writes straight into host configuration, so it is visible when the sample host's
        // top-level Program reads these during host build.
        builder.UseSetting("Winche:ConnectionString", fx.ConnectionString);
        builder.UseSetting("Console:ConnectionString", fx.ConsoleAuthConnectionString);
    }
}
