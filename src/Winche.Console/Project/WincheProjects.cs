using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Api;
using Winche.Console.Identity;

namespace Winche.Console.Project;

/// <summary>A project on the server, for the console's project switcher.</summary>
/// <param name="ConsolePath">Its console under the server's root, e.g. <c>/p/wards/_console</c>.</param>
public sealed record WincheProjectInfo(string Id, string Name, string ConsolePath, DateTimeOffset? ImageVersion);

/// <summary>
/// The projects on the server this console runs in, and creating one. A host that runs several projects (Winche
/// Server) registers it; without it the console knows only its own project.
/// </summary>
public interface IWincheProjects
{
    /// <summary>This console's project's path under the server's root (empty for the default project at the root).</summary>
    string CurrentPrefix { get; }

    Task<IReadOnlyList<WincheProjectInfo>> ListAsync(CancellationToken ct);

    /// <summary>Creates a project (named, every product off) and starts it.</summary>
    Task<WincheProjectInfo> CreateAsync(string name, string id, string? by, CancellationToken ct);
}

public static class WincheProjectEndpoints
{
    public sealed record CreateRequest(string? Name, string? Id);

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;

    /// <summary>The server's root as seen from this request: the path base without this project's own part.</summary>
    private static string Root(HttpRequest request, IWincheProjects projects)
    {
        var pathBase = request.PathBase.Value ?? "";
        foreach (var prefix in new[] { projects.CurrentPrefix }.Where(p => p.Length > 0))
            if (pathBase.EndsWith(prefix, StringComparison.Ordinal)) return pathBase[..^prefix.Length];
        // The default project, reached at its own /p/<id> too: strip that.
        var marker = pathBase.LastIndexOf("/p/", StringComparison.Ordinal);
        return marker >= 0 && pathBase.IndexOf('/', marker + 3) < 0 ? pathBase[..marker] : pathBase;
    }

    internal static IEndpointRouteBuilder MapConsoleWincheProjectEndpoints(this IEndpointRouteBuilder app, Options.ConsoleOptions options)
    {
        app.MapGet("/api/projects", async (HttpContext http, ProjectSetup setup, CancellationToken ct) =>
        {
            var projects = http.RequestServices.GetService<IWincheProjects>();
            var admin = Tabs.ConsoleRolePolicy.Highest(http.User, options) >= Tabs.ConsoleRole.Admin;
            if (projects is null) return Results.Json(new { available = false, canCreate = false, current = setup.Current.Id, projects = Array.Empty<object>() });
            var root = Root(http.Request, projects);
            var list = await projects.ListAsync(ct);
            return Results.Json(new
            {
                available = true,
                canCreate = admin,
                current = setup.Current.Id,
                projects = list.Select(p => new
                {
                    id = p.Id, name = p.Name, consoleUrl = root + p.ConsolePath,
                    imageVersion = p.ImageVersion?.ToUnixTimeMilliseconds().ToString(),
                }),
            });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        app.MapPost("/api/projects", async (CreateRequest body, HttpContext http, CancellationToken ct) =>
        {
            if (http.RequestServices.GetService<IWincheProjects>() is not { } projects)
                return ConsoleErrors.Problem("projects", "This console runs one project only.", null);
            if (string.IsNullOrWhiteSpace(body.Name)) return ConsoleErrors.Problem("projects", "Name the project.", null);
            if (!ProjectSetup.IsValidId(body.Id))
                return ConsoleErrors.Problem("projects", "The project id is 3 to 40 lower-case letters, digits and dashes, starting with a letter.", null);
            try
            {
                var created = await projects.CreateAsync(body.Name.Trim(), body.Id!, Who(http.User), ct);
                return Results.Json(new { id = created.Id, name = created.Name, consoleUrl = Root(http.Request, projects) + created.ConsolePath });
            }
            catch (ArgumentException ex)
            {
                return ConsoleErrors.Problem("projects", ex.Message, null);
            }
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);
        return app;
    }
}
