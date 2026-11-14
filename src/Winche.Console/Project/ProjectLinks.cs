using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Api;
using Winche.Console.Identity;
using Winche.Core;

namespace Winche.Console.Project;

/// <summary>Another project's console, listed in the project switcher.</summary>
public sealed record ProjectLink(string Name, string ConsoleUrl);

/// <summary>
/// The projects the switcher offers (settings area <c>projects</c>). Each Winche server is one project, so the others
/// are other servers' consoles: the switcher opens them.
/// </summary>
public sealed record ProjectLinksSettings
{
    public const string Area = "projects";
    public const int Max = 50;
    public IReadOnlyList<ProjectLink> Links { get; init; } = [];

    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (Links.Count > Max) problems.Add($"At most {Max} projects.");
        foreach (var l in Links)
        {
            if (string.IsNullOrWhiteSpace(l.Name)) problems.Add("Name every project.");
            if (!IsConsoleUrl(l.ConsoleUrl)) problems.Add($"'{l.ConsoleUrl}' isn't an http(s) address.");
        }
        if (Links.GroupBy(l => Normalize(l.ConsoleUrl)).Any(g => g.Count() > 1)) problems.Add("A project is listed twice.");
        return problems;
    }

    public static bool IsConsoleUrl(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp) && string.IsNullOrEmpty(u.UserInfo);

    public static string Normalize(string url) => url.Trim().TrimEnd('/');
}

public static class ProjectLinkEndpoints
{
    public sealed record AddRequest(string? Name, string? ConsoleUrl);

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;
    private static IResult Problem(string message) => ConsoleErrors.Problem("projects", message, null);

    private static object Body(ProjectLinksSettings s, bool editable) => new
    {
        editable,
        links = s.Links.Select(l => new { name = l.Name, consoleUrl = l.ConsoleUrl }),
    };

    internal static IEndpointRouteBuilder MapConsoleProjectLinkEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/project/links", (HttpContext http, IServiceProvider sp, Options.ConsoleOptions options) =>
        {
            var area = sp.GetService<SettingsArea<ProjectLinksSettings>>();
            var admin = Tabs.ConsoleRolePolicy.Highest(http.User, options) >= Tabs.ConsoleRole.Admin;
            return Results.Json(Body(area?.Current ?? new(), area is not null && admin));
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        var admin = app.MapGroup("/api/project/links").RequireAuthorization(ConsoleRoles.AdminPolicy);

        admin.MapPost("", async (AddRequest body, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (sp.GetService<SettingsArea<ProjectLinksSettings>>() is not { } area || sp.GetService<SettingsStore>() is not { } store)
                return Problem("This console can't keep a list of projects (UseProjectSetup).");
            if (string.IsNullOrWhiteSpace(body.Name)) return Problem("Name the project.");
            if (!ProjectLinksSettings.IsConsoleUrl(body.ConsoleUrl)) return Problem("Give its console's address, starting with https://.");
            var url = ProjectLinksSettings.Normalize(body.ConsoleUrl!);
            var current = area.Current;
            if (current.Links.Any(l => ProjectLinksSettings.Normalize(l.ConsoleUrl) == url)) return Problem("That project is already listed.");
            if (current.Links.Count >= ProjectLinksSettings.Max) return Problem($"At most {ProjectLinksSettings.Max} projects.");
            var next = current with { Links = [.. current.Links, new ProjectLink(body.Name.Trim(), url)] };
            await store.SaveAsync(ProjectLinksSettings.Area, JsonSerializer.SerializeToNode(next, SettingsArea.Json)!, Who(http.User), $"Listed the project {body.Name.Trim()}", ct);
            return Results.Json(Body(next, true));
        });

        admin.MapDelete("", async (string url, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (sp.GetService<SettingsArea<ProjectLinksSettings>>() is not { } area || sp.GetService<SettingsStore>() is not { } store)
                return Problem("This console can't keep a list of projects (UseProjectSetup).");
            var current = area.Current;
            var gone = current.Links.FirstOrDefault(l => ProjectLinksSettings.Normalize(l.ConsoleUrl) == ProjectLinksSettings.Normalize(url));
            if (gone is null) return Results.Json(Body(current, true));
            var next = current with { Links = [.. current.Links.Where(l => l != gone)] };
            await store.SaveAsync(ProjectLinksSettings.Area, JsonSerializer.SerializeToNode(next, SettingsArea.Json)!, Who(http.User), $"Removed the project {gone.Name} from the list", ct);
            return Results.Json(Body(next, true));
        });
        return app;
    }
}
