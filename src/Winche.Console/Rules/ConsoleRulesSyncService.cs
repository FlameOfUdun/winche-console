using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Winche.Rules;
using Winche.Rules.Json;

namespace Winche.Console.Rules;

/// <summary>
/// Keeps every node's live rules in step with the persisted "active" version. A save, revert or apply in
/// the console updates the live rules only on the node that served the request; with several nodes
/// behind a load balancer the others kept enforcing the old rules until they restarted. Each node polls
/// the active version per subsystem and applies it when it changes.
///
/// The version active when the node starts is the baseline and is not applied here (that is
/// <see cref="RuleSubsystemRegistration.ApplyOnStartup"/>'s decision); only later activations are.
/// </summary>
internal sealed class ConsoleRulesSyncService(
    IEnumerable<RuleSubsystemRegistration> registrations,
    RuleStoreFactory storeFactory,
    IServiceProvider services,
    TimeProvider timeProvider,
    ILogger<ConsoleRulesSyncService>? logger = null) : BackgroundService
{
    private readonly Dictionary<string, Guid?> _seen = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var syncing = registrations.Where(r => r.SyncInterval > TimeSpan.Zero).ToList();
        if (syncing.Count == 0) return;

        var interval = syncing.Min(r => r.SyncInterval);
        var baseline = true;
        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var registration in syncing)
            {
                try
                {
                    await SyncAsync(registration, baseline, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception ex)
                {
                    logger?.LogWarning(ex, "Rules sync failed for subsystem '{Subsystem}'; retrying.", registration.Subsystem);
                }
            }
            baseline = false;

            try { await Task.Delay(interval, timeProvider, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>One poll: applies the active version if it changed since the last poll.</summary>
    internal async Task SyncAsync(RuleSubsystemRegistration reg, bool baseline, CancellationToken ct)
    {
        await using var ctx = storeFactory.CreateContext();
        var active = await new RuleVersionStore(ctx, timeProvider).GetActiveAsync(reg.Subsystem, ct);
        var id = active?.Id;

        if (baseline || !_seen.TryGetValue(reg.Subsystem, out var previous))
        {
            _seen[reg.Subsystem] = id;
            return;
        }
        if (previous == id || active is null) return;

        var repo = services.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
        if (repo is null) return;

        repo.Update(RuleJson.DeserializeRuleSet(active.RulesJson));
        _seen[reg.Subsystem] = id;
        logger?.LogInformation("Applied rules version {Version} for subsystem '{Subsystem}' (activated on another node).",
            active.Version, reg.Subsystem);
    }
}
