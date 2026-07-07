using Winche.Console.Tabs;

namespace Winche.Console.Sample;

/// <summary>
/// Demo data for the custom "Analytics" tab. Returns canned numbers so the sample shows off the
/// widget catalog (stat tiles + line chart + table) and the filter bar without needing a real
/// analytics backend. The <c>range</c> filter scales the headline numbers.
/// </summary>
public sealed class AnalyticsTabProvider : ITabData
{
    public Task<StatRowData> Kpis(WidgetContext ctx, CancellationToken ct)
    {
        var range = ctx.Filters.TryGetValue("range", out var r) ? r : "7 days";
        var mult = range switch { "30 days" => 4, "90 days" => 12, _ => 1 };
        return Task.FromResult(new StatRowData(
            new Stat("Total users", $"{1284 * mult:N0}", "+12%", Trend.Up),
            new Stat("Documents", $"{342 * mult:N0}"),
            new Stat("Storage used", $"{1.2 * mult:0.0} GB"),
            new Stat("Active today", 87, "-3%", Trend.Down)));
    }

    public Task<ChartData> Signups(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult(new ChartData(new Series("Signups",
            new Point("Mon", 12), new Point("Tue", 19), new Point("Wed", 9),
            new Point("Thu", 27), new Point("Fri", 22), new Point("Sat", 14),
            new Point("Sun", 8))));

    public Task<TableData> Recent(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult((TableData)TableData
            .From(new[]
            {
                new { User = "alice@winche.local", Action = "Created document", When = "2 min ago" },
                new { User = "bob@winche.local", Action = "Uploaded file", When = "18 min ago" },
                new { User = ctx.User.Email ?? "you", Action = "Signed in", When = "1 hour ago" },
            })
            .Column("User", x => x.User)
            .Column("Action", x => x.Action)
            .Column("When", x => x.When));

    // Switch-filter branches: "Signups" shows a bar chart, "Revenue" shows revenue tiles.
    public Task<ChartData> SignupsBar(WidgetContext ctx, CancellationToken ct) => Signups(ctx, ct);

    public Task<StatRowData> Revenue(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult(new StatRowData(
            new Stat("Revenue", "$48.2K", "+8%", Trend.Up),
            new Stat("MRR", "$12.9K"),
            new Stat("Churn", "1.8%", "-0.3%", Trend.Up)));
}

/// <summary>
/// Demo data for the custom "Traffic" tab (stat tiles + bar chart). Visible to Viewers and up, so it
/// also demonstrates a lower <see cref="ConsoleRole"/> floor than the Analytics tab.
/// </summary>
public sealed class TrafficTabProvider : ITabData
{
    public Task<StatRowData> Totals(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult(new StatRowData(
            new Stat("Page views", "48.2K", "+8%", Trend.Up),
            new Stat("Sessions", "12.9K"),
            new Stat("Bounce rate", "42%", "-5%", Trend.Up)));

    public Task<ChartData> Byday(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult(new ChartData(new Series("Views",
            new Point("Mon", 6200), new Point("Tue", 7100), new Point("Wed", 6800),
            new Point("Thu", 8300), new Point("Fri", 7600), new Point("Sat", 4200),
            new Point("Sun", 3900))));
}
