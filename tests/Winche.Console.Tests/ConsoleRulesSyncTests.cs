using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Rules;
using Winche.Rules;
using Winche.Rules.Json;
using Xunit;
using Winche.Values;

namespace Winche.Console.Tests;

/// <summary>
/// Two nodes share the rules store. A version activated through one node's console must reach the
/// other node's live rules; the version active at startup is left to ApplyPersistedRulesOnStartup.
/// </summary>
[Collection("postgres")]
public sealed class ConsoleRulesSyncTests(PostgresFixture fx)
{
    private const string Key = "test-rules";

    private sealed record Node(ConsoleRulesSyncService Sync, MutableRuleSetRepository Rules);

    private Node StartNode(RuleStoreFactory factory, RuleSet initial)
    {
        var rules = new MutableRuleSetRepository(initial);
        var services = new ServiceCollection().AddKeyedSingleton<IMutableRuleSetRepository>(Key, rules).BuildServiceProvider();
        var sync = new ConsoleRulesSyncService(
            [new RuleSubsystemRegistration(RuleSubsystems.Database, Key, ApplyOnStartup: false, TimeSpan.FromSeconds(10))],
            factory, services, TimeProvider.System);
        return new Node(sync, rules);
    }

    private static RuleSet Rules(string path) => RuleSetBuilder.Build(r => r.Match(path, b => b.Allow(RuleOperations.Of(RuleOperation.Get), Winche.Rules.Expressions.Expr.Value(RuleValues.True))));

    private static string FirstPath(MutableRuleSetRepository repo) => repo.Current.Matches[0].Path;

    [Fact]
    public async Task A_version_activated_on_one_node_reaches_the_others()
    {
        await fx.ResetAsync();
        var factory = new RuleStoreFactory(fx.ConnectionString);
        await using (var ctx = factory.CreateContext()) await ctx.Database.MigrateAsync();

        var reg = new RuleSubsystemRegistration(RuleSubsystems.Database, Key, false, TimeSpan.FromSeconds(10));
        await using (var ctx = factory.CreateContext())
            await new RuleVersionStore(ctx, TimeProvider.System).AppendAsync(RuleSubsystems.Database, RuleJson.Serialize(Rules("old/{x}")), null, null, null, null);

        var a = StartNode(factory, Rules("code/{x}"));
        var b = StartNode(factory, Rules("code/{x}"));
        await a.Sync.SyncAsync(reg, baseline: true, default);
        await b.Sync.SyncAsync(reg, baseline: true, default);

        // The version active at startup is not forced on (ApplyOnStartup is false): code rules stay.
        await a.Sync.SyncAsync(reg, baseline: false, default);
        Assert.Equal("code/{x}", FirstPath(a.Rules));

        // An admin saves a new version through node A's console.
        await using (var ctx = factory.CreateContext())
            await new RuleVersionStore(ctx, TimeProvider.System).AppendAsync(RuleSubsystems.Database, RuleJson.Serialize(Rules("new/{x}")), "fix", "admin", null, null);

        await a.Sync.SyncAsync(reg, baseline: false, default);
        await b.Sync.SyncAsync(reg, baseline: false, default);

        Assert.Equal("new/{x}", FirstPath(a.Rules));
        Assert.Equal("new/{x}", FirstPath(b.Rules));
    }
}
