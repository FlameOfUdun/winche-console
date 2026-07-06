using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Winche.Console.Rules;

/// <summary>Used only by `dotnet ef` to build the context at design time (no live DB needed).</summary>
public sealed class DesignTimeConsoleRulesDbContextFactory : IDesignTimeDbContextFactory<ConsoleRulesDbContext>
{
    public ConsoleRulesDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<ConsoleRulesDbContext>()
            .UseNpgsql("Host=localhost;Database=winche_console_rules;Username=postgres;Password=postgres")
            .Options;
        return new ConsoleRulesDbContext(options);
    }
}
