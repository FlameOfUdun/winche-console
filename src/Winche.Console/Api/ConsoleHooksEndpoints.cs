using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Core;
using Winche.Console.Identity;
using Winche.Console.Tabs;
using Winche.Webhooks;

namespace Winche.Console.Api;

/// <summary>
/// The Hooks page: when documents, files or users change, call a webhook or run a ready-made action. Hooks are a
/// settings area (saved with a reason, with history); deliveries are listed and can be retried.
/// </summary>
public static class ConsoleHooksEndpoints
{
    public sealed record SaveRequest(JsonElement? Settings, string? Reason);
    public sealed record TestRequest(JsonElement? Hook);

    internal static bool Capability(IServiceProvider sp, ConsoleRole? role) => role == ConsoleRole.Admin && sp.GetService<HookCatalog>() is not null;

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;

    private static IResult Problem(string message, IReadOnlyList<string>? errors = null) =>
        Results.Json(new { error = new { code = "INVALID_HOOKS", message, errors = errors ?? [] } }, statusCode: 400);

    private static object Delivery(HookDelivery d) => new
    {
        id = d.Id, hookId = d.HookId, hookName = d.HookName, source = d.Source, type = d.Type, path = d.Path, status = d.Status, attempts = d.Attempts,
        createdAt = d.CreatedAt, nextAttemptAt = d.Status == HookOutbox.Pending ? d.NextAttemptAt : null, finishedAt = d.FinishedAt,
        lastStatus = d.LastStatus, lastResult = d.LastResult, durationMs = d.DurationMs, @event = d.Event,
    };

    public static IEndpointRouteBuilder MapConsoleHooksEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/hooks").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("", async (IServiceProvider sp, HookCatalog catalog, HookOutbox outbox, CancellationToken ct) =>
        {
            var area = sp.GetRequiredService<SettingsArea<HooksSettings>>();
            var store = sp.GetService<SettingsStore>();
            var secrets = sp.GetService<SecretStore>();
            return Results.Json(new
            {
                settings = area.Current,
                source = area.Source == SettingsSource.Saved ? "console" : "code",
                version = area.Version is { } v ? new { id = v.Id, number = v.Number, at = v.At, by = v.By, reason = v.Reason } : null,
                editable = store is not null && (secrets?.Available ?? false),
                whyReadOnly = store is null ? "The app needs AddWincheConfig(…) to save hooks."
                    : secrets?.Available != true ? "Webhook signing secrets need the project's master key (WincheConfigOptions.MasterKey)." : null,
                sources = catalog.Sources.Where(s => !s.Internal),
                actions = catalog.Actions.Select(a => new { name = a.Name, title = a.Title, description = a.Description, sources = a.Sources, options = a.Options }),
                counts = await outbox.CountsAsync(ct),
            }, SettingsArea.Json);
        });

        group.MapPut("", async (SaveRequest body, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (sp.GetService<SettingsStore>() is not { } store) return Problem("The app needs AddWincheConfig(…) to save hooks.");
            if (body.Settings is not { ValueKind: JsonValueKind.Object } doc) return Problem("Send the hooks to save.");
            if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why you're making this change: it goes in the history.");
            HooksSettings settings;
            try { settings = doc.Deserialize<HooksSettings>(SettingsArea.Json)!; }
            catch (JsonException ex) { return Problem($"The hooks don't have the expected shape: {ex.Message}"); }
            if (settings.Problems(sp.GetRequiredService<HookCatalog>()) is { Count: > 0 } problems) return Problem("These hooks can't be saved.", problems);
            // Every webhook gets a signing secret the first time it's saved.
            if (sp.GetService<SecretStore>() is not { Available: true } secrets) return Problem("Webhook signing secrets need AddWincheConfig(…) with a master key.");
            foreach (var h in settings.Hooks.Where(h => h.Do.Kind == "webhook"))
                if (await secrets.InfoAsync(HookRunner.SecretName(h.Id), ct) is null)
                    await secrets.SetAsync(HookRunner.SecretName(h.Id), WebhookSignature.NewSecret(), Who(http.User), ct);
            try
            {
                var v = await store.SaveAsync(HooksSettings.Area, JsonSerializer.SerializeToNode(settings, SettingsArea.Json)!, Who(http.User), body.Reason, ct);
                return Results.Json(new { id = v.Id, number = v.Number, at = v.At, by = v.By, reason = v.Reason });
            }
            catch (SettingsValidationException ex) { return Problem("These hooks can't be saved.", ex.Errors); }
        });

        // The signing secret receivers check signatures with.
        group.MapGet("/{id}/secret", async (string id, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (sp.GetService<SecretStore>() is not { Available: true } secrets) return Problem("Secrets need AddWincheConfig(…) with a master key.");
            return await secrets.GetAsync(HookRunner.SecretName(id), ct) is { } secret ? Results.Json(new { secret }) : Results.NotFound();
        });

        group.MapPost("/{id}/secret/rotate", async (string id, HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (sp.GetService<SecretStore>() is not { Available: true } secrets) return Problem("Secrets need AddWincheConfig(…) with a master key.");
            var secret = WebhookSignature.NewSecret();
            await secrets.SetAsync(HookRunner.SecretName(id), secret, Who(http.User), ct);
            return Results.Json(new { secret });
        });

        // Sends a sample event to a draft webhook now (actions aren't run: they change data). Shows what came back.
        group.MapPost("/test", async (TestRequest body, HttpContext http, IServiceProvider sp, HookRunner runner, CancellationToken ct) =>
        {
            HookSettings? hook;
            try { hook = body.Hook is { ValueKind: JsonValueKind.Object } h ? h.Deserialize<HookSettings>(SettingsArea.Json) : null; }
            catch (JsonException ex) { return Problem($"The hook doesn't have the expected shape: {ex.Message}"); }
            if (hook is null) return Problem("Send the hook to test.");
            if (string.IsNullOrWhiteSpace(hook.Id)) hook = hook with { Id = "test" };
            var problems = new HooksSettings { Hooks = [hook with { Name = string.IsNullOrWhiteSpace(hook.Name) ? "Test" : hook.Name }] }.Problems(sp.GetRequiredService<HookCatalog>());
            if (problems.Count > 0) return Problem("Fix these first.", problems);
            var sample = Sample(hook, sp.GetRequiredService<HookCatalog>());
            var vars = HookEvents.Match(hook, sample) ?? sample.Variables;
            var envelope = new JsonObject
            {
                ["id"] = sample.Id, ["hook"] = new JsonObject { ["id"] = hook.Id, ["name"] = hook.Name }, ["source"] = sample.Source, ["type"] = sample.Type,
                ["path"] = sample.Path, ["at"] = sample.At.ToString("O"), ["test"] = true,
                ["vars"] = new JsonObject(vars.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))), ["data"] = sample.Data, ["before"] = null,
            };
            if (hook.Do.Kind != "webhook")
            {
                try
                {
                    var filled = hook.Do.Options.ToDictionary(kv => kv.Key, kv => Template.Fill(kv.Value, vars));
                    return Results.Json(new { ok = true, ran = false, options = filled, sample = envelope });
                }
                catch (InvalidOperationException ex) { return Results.Json(new { ok = false, ran = false, result = ex.Message, sample = envelope }); }
            }
            var result = await runner.RunAsync(hook, envelope, ct);
            return Results.Json(new { ok = result.Ok, ran = true, status = result.Status, result = result.Result, durationMs = result.DurationMs, sample = envelope });
        });

        group.MapGet("/deliveries", async ([Microsoft.AspNetCore.Mvc.FromQuery] string? hookId, [Microsoft.AspNetCore.Mvc.FromQuery] string? status, HookOutbox outbox, CancellationToken ct) =>
            Results.Json(new { deliveries = (await outbox.ListAsync(hookId, status, 100, ct)).Select(Delivery) }));

        group.MapPost("/deliveries/{id:guid}/retry", async (Guid id, HookOutbox outbox, CancellationToken ct) =>
            await outbox.RetryAsync(id, ct) ? Results.NoContent() : Results.NotFound());

        return app;
    }

    /// <summary>A made-up event the hook would get: its path pattern filled with example values.</summary>
    private static HookEvent Sample(HookSettings hook, HookCatalog catalog)
    {
        var source = catalog.Sources.First(s => s.Name == hook.When.Source);
        var type = hook.When.Events.FirstOrDefault() ?? source.Events[0];
        string? path = null;
        if (source.HasPaths)
        {
            path = string.Join('/', (string.IsNullOrWhiteSpace(hook.When.Path) ? "examples/{id}" : hook.When.Path).Trim('/').Split('/')
                .Select(seg => seg.StartsWith('{') ? (seg.Contains("=**") ? "folder/example.pdf" : $"example-{seg.Trim('{', '}')}") : seg));
        }
        var vars = new Dictionary<string, string>();
        foreach (var v in source.Variables) vars[v] = v switch
        {
            "path" => path ?? "", "id" => path?.Split('/')[^1] ?? "", "collection" => path is { } p && p.Split('/').Length > 1 ? p.Split('/')[^2] : "",
            "name" => path?.Split('/')[^1] ?? "", "directory" => path is { } q && q.Contains('/') ? q[..q.LastIndexOf('/')] : "",
            "uid" => "example-uid", "email" => "someone@example.com", "provider" => "password", _ => $"example-{v}",
        };
        var data = source.Name switch
        {
            "database" => new JsonObject { ["path"] = path, ["id"] = vars["id"], ["fields"] = new JsonObject { ["example"] = "value" } },
            "storage" => new JsonObject { ["path"] = path, ["mimeType"] = "application/pdf", ["sizeBytes"] = 1024 },
            "auth" => new JsonObject { ["uid"] = "example-uid", ["email"] = "someone@example.com" },
            _ => null,
        };
        return new HookEvent(source.Name, type, path, DateTimeOffset.UtcNow, data, null, vars);
    }
}
