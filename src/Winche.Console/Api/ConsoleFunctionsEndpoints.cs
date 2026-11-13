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
using Winche.Functions;

namespace Winche.Console.Api;

/// <summary>
/// The Functions page: edit the code, deploy it with a note (two-step sign-in, since it runs with the server's
/// rights), see versions and roll back, run a callable, and make the deploy key for VS Code.
/// </summary>
public static class ConsoleFunctionsEndpoints
{
    public sealed record DeployRequest(Dictionary<string, string>? Files, string? Note);
    public sealed record NoteRequest(string? Note);
    public sealed record RunRequest(string? Name, JsonElement? Data, string? AsUid);

    internal static bool Capability(IServiceProvider sp, ConsoleRole? role) => role == ConsoleRole.Admin && sp.GetService<WincheFunctions>() is not null;

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;

    private static IResult Problem(string message, IReadOnlyList<string>? problems = null) =>
        ConsoleErrors.Problem("functions", message, problems);

    private static object Info(FunctionInfo f) => new
    {
        name = f.Name, kind = f.Trigger.Kind, events = f.Trigger.Events, path = f.Trigger.Path, cron = f.Trigger.Cron, timeZone = f.Trigger.TimeZone,
        description = f.Trigger.Describe(), timeoutSeconds = f.TimeoutSeconds,
    };

    private static object Version(Deployment d) => new
    {
        version = d.Version, note = d.Note, by = d.By, at = d.At, rolledBackFrom = d.RolledBackFrom, functions = d.Functions.Select(Info),
    };

    public static IEndpointRouteBuilder MapConsoleFunctionsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/functions").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("", async (WincheFunctions functions, FunctionsOptions options, IServiceProvider sp, CancellationToken ct) =>
        {
            await functions.RefreshAsync(ct);
            string? runtimeProblem = null;
            try { DenoRuntime.Locate(options); }
            catch (FunctionsUnavailableException ex) { runtimeProblem = ex.Message; }
            var secrets = sp.GetService<SecretStore>();
            var key = secrets is null ? null : await secrets.InfoAsync(FunctionsEndpoints.DeployKeySecret, ct);
            var current = functions.Current;
            return Results.Json(new
            {
                current = current is null ? null : Version(current),
                files = current?.Files ?? new Dictionary<string, string>(),
                runtimeProblem,
                deployKey = key is null ? null : new { setAt = key.SetAt, setBy = key.SetBy },
                secretsAvailable = secrets?.Available ?? false,
            });
        });

        group.MapGet("/versions", async (FunctionStore store, CancellationToken ct) =>
            Results.Json(new { versions = (await store.ListAsync(50, ct)).Select(Version) }));

        group.MapGet("/versions/{version:int}", async (int version, FunctionStore store, CancellationToken ct) =>
            await store.GetAsync(version, ct) is { } d ? Results.Json(new { version = Version(d), files = d.Files }) : Results.NotFound());

        group.MapPost("/deploy", async (DeployRequest body, HttpContext http, WincheFunctions functions, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (string.IsNullOrWhiteSpace(body.Note)) return Problem("Say what changed: it goes in the version list.");
            try { return Results.Json(Version(await functions.DeployAsync(body.Files ?? [], body.Note.Trim(), Who(http.User), ct))); }
            catch (FunctionDeployException ex) { return Problem(ex.Message, ex.Problems); }
            catch (FunctionsUnavailableException ex) { return Problem(ex.Message); }
        });

        group.MapPost("/versions/{version:int}/rollback", async (int version, NoteRequest body, HttpContext http, WincheFunctions functions, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            try { return Results.Json(Version(await functions.RollBackAsync(version, string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim(), Who(http.User), ct))); }
            catch (FunctionDeployException ex) { return Problem(ex.Message, ex.Problems); }
            catch (FunctionsUnavailableException ex) { return Problem(ex.Message); }
        });

        // Runs a callable now, as a signed-out caller or as a given user id, showing its result and what it logged.
        group.MapPost("/run", async (RunRequest body, WincheFunctions functions, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Name)) return Problem("Choose a function.");
            var data = body.Data is { ValueKind: not (JsonValueKind.Undefined or JsonValueKind.Null) } d ? JsonNode.Parse(d.GetRawText()) : null;
            var caller = string.IsNullOrWhiteSpace(body.AsUid) ? FunctionCaller.Server
                : new FunctionCaller(body.AsUid.Trim(), new Dictionary<string, object?> { ["uid"] = body.AsUid.Trim() });
            var r = await functions.InvokeAsync(body.Name, data, caller, ct, kind: "callable");
            return Results.Json(new
            {
                ok = r.Ok, result = r.Result, error = r.Ok ? null : new { code = r.ErrorCode, message = r.ErrorMessage }, durationMs = r.DurationMs,
                logs = r.Logs.Select(l => new { level = l.Level, message = l.Message, at = l.At }),
            });
        });

        // The key VS Code (winche functions deploy) uses; shown once.
        group.MapPost("/deploy-key", async (HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (sp.GetService<SecretStore>() is not { Available: true } secrets) return Problem("Keys need AddWincheConfig(…) with a master key.");
            var key = FunctionsEndpoints.NewDeployKey();
            await secrets.SetAsync(FunctionsEndpoints.DeployKeySecret, key, Who(http.User), ct);
            return Results.Json(new { key });
        });

        group.MapDelete("/deploy-key", async (HttpContext http, IServiceProvider sp, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (sp.GetService<SecretStore>() is { } secrets) await secrets.DeleteAsync(FunctionsEndpoints.DeployKeySecret, ct);
            return Results.NoContent();
        });

        return app;
    }
}
