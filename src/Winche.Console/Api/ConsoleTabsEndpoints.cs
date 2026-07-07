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

    public sealed record CommandRequest(string? RowKey, JsonElement? Input, IReadOnlyDictionary<string, string?>? Inputs);

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
                var inputs = body.Filters ?? new Dictionary<string, string?>();
                var ctx = new WidgetContext(user, inputs, http.RequestServices);

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

            foreach (var command in captured.Commands)
            {
                var cmd = command;
                group.MapPost($"/{captured.Id}/commands/{cmd.Id}",
                    async (HttpContext http, CommandRequest body, CancellationToken ct) =>
                {
                    // CSRF: cookie mode must present the non-simple custom header; bearer mode carries no ambient cookie.
                    var isBearer = http.Request.Headers.Authorization.Count > 0;
                    if (!isBearer && http.Request.Headers["X-Winche-Console"].ToString() != "1")
                        return Results.BadRequest(new { status = "error", message = "Missing X-Winche-Console header." });

                    var user = ConsoleTabUser.From(http.User, options);
                    var inputs = body.Inputs ?? new Dictionary<string, string?>();
                    var ctx = new CommandContext(user, inputs, body.RowKey, http.RequestServices);
                    var json = body.Input?.GetRawText();
                    try
                    {
                        var result = await cmd.Invoke(http.RequestServices, ctx, json, ct);
                        return Results.Json(new
                        {
                            status = result.Status.ToString().ToLowerInvariant(),
                            message = result.Message,
                            fieldErrors = result.FieldErrors,
                            refetch = result.Refetch.ToString().ToLowerInvariant(),
                        }, TabManifest.JsonOptions);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        http.RequestServices.GetRequiredService<ILoggerFactory>()
                            .CreateLogger("Winche.Console.Api.ConsoleTabsEndpoints")
                            .LogError(ex, "Tab '{Tab}' command '{Command}' failed (correlation {Correlation}).",
                                captured.Id, cmd.Id, http.TraceIdentifier);
                        return Results.Json(new { status = "error", message = $"The command failed (ref {http.TraceIdentifier})." },
                            TabManifest.JsonOptions);
                    }
                }).RequireAuthorization(ConsoleRolePolicy.For(cmd.MinRole));
            }
        }

        return app;
    }
}
