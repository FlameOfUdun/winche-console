using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Winche.Console.Api;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Core;

namespace Winche.Console.Project;

/// <summary>The products a project can start: each is off until someone starts it (with <c>UseProjectSetup()</c>).</summary>
public static class WincheProducts
{
    public const string Database = "database", Storage = "storage", Authentication = "authentication", Functions = "functions", Hooks = "hooks";
    public static readonly string[] All = [Database, Storage, Authentication, Functions, Hooks];

    /// <summary>The public API each product answers on (refused while the product isn't started). Hooks have none.</summary>
    internal static readonly (string Prefix, string Product)[] Paths =
    [
        ("/documents/v1", Database), ("/files/v1", Storage), ("/auth/v1", Authentication), ("/functions/v1", Functions),
    ];
}

/// <summary>
/// The project, as the console's setup made it (settings area <c>project</c>): whether it exists yet, its name and id,
/// and which products have been started.
/// </summary>
public sealed record ProjectSettings
{
    public const string Area = "project";
    public bool Created { get; init; }
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public IReadOnlyList<string> Products { get; init; } = [];
    public DateTimeOffset? CreatedAt { get; init; }

    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (Created && string.IsNullOrWhiteSpace(Name)) problems.Add("Name the project.");
        if (Created && !ProjectSetup.IsValidId(Id)) problems.Add("The project id is 3 to 40 lower-case letters, digits and dashes, starting with a letter.");
        if (Products.FirstOrDefault(p => !WincheProducts.All.Contains(p)) is { } unknown) problems.Add($"'{unknown}' isn't a product.");
        return problems;
    }
}

/// <summary>The project as it stands, for the console, the gate and <c>/.well-known/winche</c>.</summary>
public sealed record ProjectInfo(bool SetupEnabled, bool Created, string Id, string Name, IReadOnlyList<string> Products)
{
    public bool IsStarted(string product) => Products.Contains(product);
}

/// <summary>
/// Reads and changes the project. Without <c>UseProjectSetup()</c> (or without <c>AddWincheConfig</c>, where settings
/// live) there's no setup: the project is the one in the console's options, with every product on, as before.
/// </summary>
public sealed class ProjectSetup(ConsoleOptions options, IServiceProvider services)
{
    private SettingsArea<ProjectSettings>? Area => options.ProjectSetup ? services.GetService<SettingsArea<ProjectSettings>>() : null;

    /// <summary>Whether this console runs the setup (projects are created, products started one by one).</summary>
    public bool Enabled => Area is not null && services.GetService<SettingsStore>() is not null;

    public ProjectInfo Current
    {
        get
        {
            if (!Enabled) return new(false, true, options.ProjectId, options.ProjectName ?? options.ProjectId, WincheProducts.All);
            var s = Area!.Current;
            return s.Created
                ? new(true, true, s.Id, s.Name, s.Products)
                : new(true, false, options.ProjectId, options.ProjectName ?? options.ProjectId, []);
        }
    }

    public static bool IsValidId(string? id) =>
        id is { Length: >= 3 and <= 40 } && char.IsAsciiLetterLower(id[0]) && id.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-')
        && !id.EndsWith('-');

    private async Task SaveAsync(ProjectSettings next, string? by, string reason, CancellationToken ct)
    {
        var store = services.GetRequiredService<SettingsStore>();
        await store.SaveAsync(ProjectSettings.Area, JsonSerializer.SerializeToNode(next, SettingsArea.Json)!, by, reason, ct);
    }

    /// <summary>Creates the project with <paramref name="products"/> started.</summary>
    public async Task CreateAsync(string name, string id, IReadOnlyList<string> products, string? by, CancellationToken ct)
    {
        if (Current.Created) throw new InvalidOperationException("The project already exists.");
        await SaveAsync(new ProjectSettings
        {
            Created = true, Name = name.Trim(), Id = id.Trim(), Products = [.. products.Distinct()], CreatedAt = DateTimeOffset.UtcNow,
        }, by, $"Created the project {name.Trim()}", ct);
    }

    /// <summary>Starts <paramref name="product"/> (nothing happens if it already runs).</summary>
    public async Task StartAsync(string product, string? by, CancellationToken ct)
    {
        var s = Area!.Current;
        if (!s.Created) throw new InvalidOperationException("Create the project first.");
        if (s.Products.Contains(product)) return;
        await SaveAsync(s with { Products = [.. s.Products, product] }, by, $"Started {product}", ct);
    }

    /// <summary>Renames the project (its id too).</summary>
    public async Task RenameAsync(string name, string id, string? by, CancellationToken ct)
    {
        var s = Area!.Current;
        if (!s.Created) throw new InvalidOperationException("Create the project first.");
        await SaveAsync(s with { Name = name.Trim(), Id = id.Trim() }, by, "Renamed the project", ct);
    }

    /// <summary>
    /// A console that was already in use before setup existed keeps working: if the project was never saved but the
    /// console has members or published rules, it becomes a project (from the options) with every product on.
    /// </summary>
    internal async Task CarryOverAsync(CancellationToken ct)
    {
        if (!Enabled || !options.ProjectCarryOver || Area!.Version is not null) return;
        var store = services.GetRequiredService<SettingsStore>();
        if ((await store.HistoryAsync(ProjectSettings.Area, 1, ct)).Count > 0) return;
        var inUse = false;
        await using (var scope = services.CreateAsyncScope())
        {
            if (scope.ServiceProvider.GetService<ConsoleIdentityDbContext>() is { } identity)
                inUse = identity.Users.Any();
            if (!inUse && scope.ServiceProvider.GetService<Rules.RuleStoreFactory>() is { } rules)
            {
                await using var ctx = rules.CreateContext();
                inUse = ctx.RuleVersions.Any();
            }
        }
        if (!inUse) return;
        await SaveAsync(new ProjectSettings
        {
            Created = true, Id = options.ProjectId, Name = options.ProjectName ?? options.ProjectId, Products = WincheProducts.All,
            CreatedAt = DateTimeOffset.UtcNow,
        }, "winche", "Carried over: this console was in use before project setup", ct);
    }
}

/// <summary>Runs <see cref="ProjectSetup.CarryOverAsync"/> once at startup.</summary>
internal sealed class ProjectStartupService(ProjectSetup setup, ILogger<ProjectStartupService> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        try { await setup.CarryOverAsync(ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { logger.LogWarning(ex, "Couldn't check whether to carry the project over."); }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}

public static class ProjectEndpoints
{
    public sealed record CreateRequest(string? Name, string? Id, string[]? Products);
    public sealed record RenameRequest(string? Name, string? Id);

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;
    private static IResult Problem(string message) => ConsoleErrors.Problem("project", message, null);

    private static object Body(ProjectInfo p, DateTimeOffset? image) => new
    {
        setup = p.SetupEnabled, created = p.Created, id = p.Id, name = p.Name,
        // When the thumbnail last changed (null: none): GET api/project/image?v=<it>.
        imageVersion = image?.ToUnixTimeMilliseconds().ToString(),
        products = WincheProducts.All.Select(id => new { id, started = p.IsStarted(id) }),
    };

    internal static IEndpointRouteBuilder MapConsoleProjectEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/project", async (ProjectSetup setup, ProjectImageStore images, CancellationToken ct) =>
                Results.Json(Body(setup.Current, await images.VersionAsync(ct))))
            .RequireAuthorization(ConsoleRoles.ViewerPolicy);

        var admin = app.MapGroup("/api/project").RequireAuthorization(ConsoleRoles.AdminPolicy);

        admin.MapPost("", async (CreateRequest body, HttpContext http, ProjectSetup setup, ProjectImageStore images, CancellationToken ct) =>
        {
            if (!setup.Enabled) return Problem("This console has no project setup (UseProjectSetup).");
            if (setup.Current.Created) return Problem("The project already exists.");
            if (string.IsNullOrWhiteSpace(body.Name)) return Problem("Name the project.");
            if (!ProjectSetup.IsValidId(body.Id)) return Problem("The project id is 3 to 40 lower-case letters, digits and dashes, starting with a letter.");
            var products = body.Products ?? [];
            if (products.FirstOrDefault(p => !WincheProducts.All.Contains(p)) is { } unknown) return Problem($"'{unknown}' isn't a product.");
            await setup.CreateAsync(body.Name, body.Id!, products, Who(http.User), ct);
            return Results.Json(Body(setup.Current, await images.VersionAsync(ct)));
        });

        admin.MapPut("", async (RenameRequest body, HttpContext http, ProjectSetup setup, ProjectImageStore images, CancellationToken ct) =>
        {
            if (!setup.Enabled || !setup.Current.Created) return Problem("Create the project first.");
            if (string.IsNullOrWhiteSpace(body.Name)) return Problem("Name the project.");
            if (!ProjectSetup.IsValidId(body.Id)) return Problem("The project id is 3 to 40 lower-case letters, digits and dashes, starting with a letter.");
            await setup.RenameAsync(body.Name, body.Id!, Who(http.User), ct);
            return Results.Json(Body(setup.Current, await images.VersionAsync(ct)));
        });

        admin.MapPost("/products/{product}/start", async (string product, HttpContext http, ProjectSetup setup, ProjectImageStore images, CancellationToken ct) =>
        {
            if (!setup.Enabled || !setup.Current.Created) return Problem("Create the project first.");
            if (!WincheProducts.All.Contains(product)) return Problem($"'{product}' isn't a product.");
            await setup.StartAsync(product, Who(http.User), ct);
            return Results.Json(Body(setup.Current, await images.VersionAsync(ct)));
        });
        return app;
    }

    /// <summary>
    /// Refuses a product's public API while the product isn't started (<c>failed-precondition</c>, reason
    /// <c>service-disabled</c>). Only with <c>UseProjectSetup()</c>; put it before the products' endpoints.
    /// </summary>
    public static IApplicationBuilder UseWincheProjectGate(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        var setup = http.RequestServices.GetService<ProjectSetup>();
        if (setup is { Enabled: true })
        {
            var path = http.Request.Path.Value ?? "";
            foreach (var (prefix, product) in WincheProducts.Paths)
            {
                if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || (path.Length > prefix.Length && path[prefix.Length] != '/')) continue;
                if (!setup.Current.IsStarted(product))
                {
                    await new WincheError(WincheErrorCode.FailedPrecondition,
                        $"{char.ToUpperInvariant(product[0])}{product[1..]} isn't started on this server: start it in the console.", "service-disabled")
                        .ToResult().ExecuteAsync(http);
                    return;
                }
                // Which app is calling: counted, and refused when only registered apps may call. CORS preflights pass.
                if (HttpMethods.IsOptions(http.Request.Method)) break;
                var apps = http.RequestServices.GetService<Apps.RegisteredApps>();
                if (apps is not { Available: true }) break;
                var app = apps.Find(Apps.RegisteredApps.AppIdOf(http.Request));
                http.RequestServices.GetService<Apps.AppUsage>()?.Count(app?.Id ?? Apps.AppUsage.Unregistered);
                if (app is null && apps.Current.RegisteredOnly)
                {
                    await new WincheError(WincheErrorCode.FailedPrecondition,
                        "This app isn't registered in the project: register it in the console and use its winche_options.dart.", "app-not-registered")
                        .ToResult().ExecuteAsync(http);
                    return;
                }
                break;
            }
        }
        await next(http);
    });
}
