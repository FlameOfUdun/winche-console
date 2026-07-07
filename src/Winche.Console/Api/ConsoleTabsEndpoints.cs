using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Console.Tabs;

namespace Winche.Console.Api;

public static class ConsoleTabsEndpoints
{
    public sealed record TabDataRequest(IReadOnlyList<string> WidgetIds, IReadOnlyDictionary<string, string?>? Filters);

    public static IEndpointRouteBuilder MapConsoleTabsEndpoints(
        this IEndpointRouteBuilder app, TabRegistry registry, ConsoleOptions options)
    {
        // Nav list, role-filtered.
        app.MapGet("/api/tabs", (HttpContext http) =>
        {
            var role = ConsoleRolePolicy.Highest(http.User, options);
            var tabs = registry.Visible(role).Select(TabManifest.Nav).ToArray();
            return Results.Json(new { tabs }, TabManifest.JsonOptions);
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);

        var group = app.MapGroup("/api/tabs");

        foreach (var tab in registry.Tabs)
        {
            var captured = tab;
            var policy = ConsoleRolePolicy.For(captured.MinRole);

            // Static layout tree for one tab.
            group.MapGet($"/{captured.Id}", () => Results.Json(TabManifest.Layout(captured), TabManifest.JsonOptions))
                 .RequireAuthorization(policy);

            // Data for a set of widget ids at given filter values.
            group.MapPost($"/{captured.Id}/data", async (HttpContext http, TabDataRequest body, CancellationToken ct) =>
            {
                var user = ConsoleTabUser.From(http.User, options);
                var filters = body.Filters ?? new Dictionary<string, string?>();
                var ctx = new WidgetContext(user, filters, http.RequestServices);

                var widgets = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var id in body.WidgetIds.Distinct(StringComparer.Ordinal))
                {
                    var node = LayoutWalk.FindWidget(captured.Root, id);
                    if (node is null) continue;
                    try
                    {
                        widgets[id] = await node.Invoke(http.RequestServices, ctx, ct);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        http.RequestServices.GetRequiredService<ILoggerFactory>()
                            .CreateLogger("Winche.Console.Api.ConsoleTabsEndpoints")
                            .LogError(ex, "Tab '{Tab}' widget '{Widget}' handler failed (correlation {Correlation}).",
                                captured.Id, id, http.TraceIdentifier);
                        widgets[id] = null;   // per-widget error entry; siblings still return
                    }
                }
                return Results.Json(new { widgets }, TabManifest.JsonOptions);
            }).RequireAuthorization(policy);
        }

        return app;
    }
}
