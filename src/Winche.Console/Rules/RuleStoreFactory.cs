using Microsoft.EntityFrameworkCore;

namespace Winche.Console.Rules;

/// <summary>
/// Builds <see cref="ConsoleRulesDbContext"/> instances bound to the console's connection string
/// (shared by both subsystems' rules stores). This short-lived, per-operation construction does not map
/// cleanly onto a single DI-registered <see cref="DbContext"/>, so callers own the returned context and
/// must dispose it (typically via <c>await using</c>). Used by the startup service and the rules API endpoints.
/// </summary>
internal sealed class RuleStoreFactory(string connectionString)
{
    public ConsoleRulesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ConsoleRulesDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new ConsoleRulesDbContext(options);
    }
}
