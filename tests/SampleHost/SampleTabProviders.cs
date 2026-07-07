using Winche.Console.Tabs;

namespace SampleHost;

/// <summary>Canned analytics data so integration tests (and the sample) have a real SDUI tab to exercise.</summary>
public sealed class AnalyticsData : ITabData
{
    public Task<StatRowData> Kpis(WidgetContext ctx, CancellationToken ct)
    {
        var mult = ctx.Inputs.TryGetValue("range", out var r) && r == "30 days" ? 4 : 1;
        return Task.FromResult(new StatRowData(
            new Stat("Total users", 1284 * mult, "+12%", Trend.Up),
            new Stat("Documents", 342 * mult),
            new Stat("Active today", 87, "-3%", Trend.Down)));
    }

    public Task<ChartData> Signups(WidgetContext ctx, CancellationToken ct)
    {
        var bucket = ctx.Inputs.TryGetValue("view", out var v) ? v : "Users";
        return Task.FromResult(new ChartData(
            new Series($"Signups-{bucket}", new Point("Mon", 12), new Point("Tue", 19), new Point("Wed", 9))));
    }

    public Task<TableData> Recent(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult((TableData)TableData
            .From(new[]
            {
                new { User = "alice@winche.local", Action = "Created document" },
                new { User = ctx.User.Email ?? "you", Action = "Signed in" },
            })
            .Column("User", x => x.User)
            .Column("Action", x => x.Action));

    // Distinct handler methods for the switch branch so widget ids don't collide with the
    // top-level Signups/Kpis widgets. They delegate to the same data.
    public Task<ChartData> SignupsBar(WidgetContext ctx, CancellationToken ct) => Signups(ctx, ct);
    public Task<StatRowData> KpisAlt(WidgetContext ctx, CancellationToken ct) => Kpis(ctx, ct);

    public Task<StatRowData> Boom(WidgetContext ctx, CancellationToken ct) =>
        throw new InvalidOperationException("boom");
}

public sealed record EchoInput([property: System.ComponentModel.DataAnnotations.Required] string Name);

public sealed class OpsData
{
    public Task<TableData> Items(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult((TableData)TableData.From(new[] { new { Id = "a", Name = "Alpha" }, new { Id = "b", Name = "Beta" } })
            .Key(x => x.Id).Column("Name", x => x.Name));

    public Task<CommandResult> Echo(CommandContext<EchoInput> ctx, CancellationToken ct) =>
        Task.FromResult(CommandResult.Ok($"echo:{ctx.Input.Name}"));

    public Task<CommandResult> Remove(CommandContext ctx, CancellationToken ct) =>
        Task.FromResult(CommandResult.Ok($"removed:{ctx.RowKey}"));
}
