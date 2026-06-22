using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Winche.Console.Identity;

/// <summary>Used only by `dotnet ef` to build the context at design time (no live DB needed).</summary>
public sealed class DesignTimeConsoleDbContextFactory : IDesignTimeDbContextFactory<ConsoleIdentityDbContext>
{
    public ConsoleIdentityDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<ConsoleIdentityDbContext>()
            .UseNpgsql("Host=localhost;Database=winche_console_auth;Username=postgres;Password=postgres")
            .Options;
        return new ConsoleIdentityDbContext(options);
    }
}
