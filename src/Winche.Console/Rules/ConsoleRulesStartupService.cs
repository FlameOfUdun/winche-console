using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Winche.Rules;
using Winche.Rules.Json;

namespace Winche.Console.Rules;

/// <summary>
/// On startup, for each enabled rules-editor subsystem: migrates that subsystem's
/// <see cref="ConsoleRulesDbContext"/> so the <c>console_rule_versions</c> schema exists, then — if
/// <see cref="RuleSubsystemRegistration.ApplyOnStartup"/> is enabled and a persisted "head" version and
/// the subsystem's keyed <see cref="IMutableRuleSetRepository"/> are both present — re-applies the
/// persisted ruleset to the live repository. See design doc §4 (startup apply &amp; live/head
/// reconciliation).
/// </summary>
internal sealed class ConsoleRulesStartupService(
    IEnumerable<RuleSubsystemRegistration> registrations,
    RuleStoreFactory storeFactory,
    IServiceProvider services,
    TimeProvider timeProvider,
    ILogger<ConsoleRulesStartupService>? logger = null) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        foreach (var registration in registrations)
        {
            try
            {
                await ApplyAsync(registration, ct);
            }
            catch (Exception ex)
            {
                // A bad persisted ruleset or an unreachable DB for one subsystem must not stop the
                // others, and must not crash host startup.
                logger?.LogError(ex, "Rules editor startup processing failed for subsystem '{Subsystem}'.", registration.Subsystem);
            }
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;

    private async Task ApplyAsync(RuleSubsystemRegistration reg, CancellationToken ct)
    {
        await using var ctx = storeFactory.CreateContext();
        await ctx.Database.MigrateAsync(ct);

        if (!reg.ApplyOnStartup)
        {
            logger?.LogInformation(
                "Rules editor startup apply is disabled for subsystem '{Subsystem}'; leaving the host's code-seeded rules untouched.",
                reg.Subsystem);
            return;
        }

        var store = new RuleVersionStore(ctx, timeProvider);
        var active = await store.GetActiveAsync(reg.Subsystem, ct);
        if (active is null)
        {
            logger?.LogInformation(
                "No persisted rules version found for subsystem '{Subsystem}'; leaving the host's code-seeded rules untouched.",
                reg.Subsystem);
            return;
        }

        var repo = services.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
        if (repo is null)
        {
            logger?.LogWarning(
                "Persisted rules version {Version} found for subsystem '{Subsystem}' but its rule engine is not registered in this host; skipping startup apply.",
                active.Version,
                reg.Subsystem);
            return;
        }

        repo.Update(RuleJson.DeserializeRuleSet(active.RulesJson));
        logger?.LogInformation(
            "Applied persisted rules version {Version} to subsystem '{Subsystem}' on startup.",
            active.Version,
            reg.Subsystem);
    }
}
