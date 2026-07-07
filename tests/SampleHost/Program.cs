using SampleHost;
using Winche.Console;
using Winche.Console.Tabs;
using Winche.Database.DependencyInjection;
using Winche.Storage.DependencyInjection;
using Winche.Storage.Interfaces;

var builder = WebApplication.CreateBuilder(args);
var wincheConn = builder.Configuration["Winche:ConnectionString"]
    ?? throw new InvalidOperationException("Winche:ConnectionString is required.");

builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = wincheConn);
builder.Services.AddWincheStorage(opts => opts.ConnectionString = wincheConn);
builder.Services.AddSingleton<IArchive, NoOpArchive>();

if (string.Equals(builder.Configuration["Console:Provider"], "Keycloak", StringComparison.OrdinalIgnoreCase))
{
    // The console takes explicit values; the host reads its own config and passes them in.
    builder.Services.AddWincheConsole(o =>
    {
        o.UseKeycloak(k =>
        {
            k.Server = builder.Configuration["Keycloak:Server"];
            k.Realm = builder.Configuration["Keycloak:Realm"];
            k.ClientId = builder.Configuration["Keycloak:Resource"];
        });

        // Enable the browser tabs so their data/storage endpoints are mapped (no rules editor here —
        // Keycloak mode leaves ConsoleOptions.ConnectionString unset, which the rules store requires).
        o.AddDatabaseTab();
        o.AddStorageTab();
    });
}
else
{
    var authConn = builder.Configuration["Console:ConnectionString"]
        ?? throw new InvalidOperationException("Console:ConnectionString is required.");
    builder.Services.AddWincheConsole(o =>
    {
        o.ConnectionString = authConn;   // no seed: tests use /setup

        o.AddDatabaseTab(b => b.UseRulesEditor());   // Database tab + its Rules sub-tab
        o.AddStorageTab(b => b.UseRulesEditor());     // Storage tab + its Rules sub-tab

        o.AddTab("analytics", "Analytics", tab =>
        {
            tab.Icon = "chart-bar";
            tab.MinRole = ConsoleRole.Member;
            tab.Layout(new Filter(new Select("range", ["7 days", "30 days"]),
            [
                new StatRow<AnalyticsData>(d => d.Kpis),
                new StatRow<AnalyticsData>(d => d.Boom),
                new Row([
                    new Chart<AnalyticsData>(d => d.Signups, ChartKind.Line) { Flex = 2 },
                    new Table<AnalyticsData>(d => d.Recent) { Flex = 1 },
                ]),
                new Section("Breakdown", null, [
                    new Filter(new Select("view", ["Users", "Revenue"]), v => v switch
                    {
                        "Users"   => new Node[] { new Chart<AnalyticsData>(d => d.SignupsBar, ChartKind.Bar) },
                        _         => new Node[] { new StatRow<AnalyticsData>(d => d.KpisAlt) },
                    }),
                ]),
            ]));
        });
    });
}

var app = builder.Build();

await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();

app.MapWincheConsole("/_console");

app.Run();

public partial class Program { }
