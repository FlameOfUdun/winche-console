using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Winche.Console.Apps;
using Winche.Console.Identity;
using Winche.Console.Options;

namespace Winche.Console.Api;

/// <summary>The Apps page: how an app connects to this server.</summary>
internal static class ConsoleAppsEndpoints
{
    public static void MapConsoleAppsEndpoints(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        // GET api/apps?platforms=android,ios → the setup, lib/winche_options.dart for those platforms, and main().
        app.MapGet("/api/apps", (HttpContext http, string? platforms) =>
        {
            var setup = AppSetup.For(http.RequestServices, AppSetup.BaseUrlOf(http.Request), options.ProjectId, options.ProjectName);
            var chosen = string.IsNullOrWhiteSpace(platforms) ? null : platforms.Split(',', StringSplitOptions.RemoveEmptyEntries);
            return Results.Json(new
            {
                setup,
                platforms = AppSetup.AllPlatforms,
                file = setup.DartOptionsFile(chosen),
                snippet = AppSetup.DartSnippet,
            });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);
    }
}
