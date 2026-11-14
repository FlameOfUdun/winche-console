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
/// The Functions page and <c>winche functions deploy</c>: what's deployed, versions and rollback, running a callable.
/// The code lives in the app's repository; the CLI deploys it here (as the signed-in admin, or a CI token with the
/// <c>functions</c> scope), with a note. Deploying needs two-step sign-in where settings do, since it runs with the
/// server's rights.
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
        var ci = new ConsoleCiScope(ConsoleCiScope.Functions);   // what a CI token may call

        group.MapGet("", async (WincheFunctions functions, FunctionsOptions options, IServiceProvider sp, CancellationToken ct) =>
        {
            await functions.RefreshAsync(ct);
            string? runtimeProblem = null;
            try { DenoRuntime.Locate(options); }
            catch (FunctionsUnavailableException ex) { runtimeProblem = ex.Message; }
            var current = functions.Current;
            return Results.Json(new
            {
                current = current is null ? null : Version(current),
                files = current?.Files.Keys.Order(StringComparer.Ordinal) ?? Enumerable.Empty<string>(),   // names only: the code is in the repository
                runtimeProblem,
            });
        }).WithMetadata(ci);

        group.MapGet("/versions", async (FunctionStore store, CancellationToken ct) =>
            Results.Json(new { versions = (await store.ListAsync(50, ct)).Select(Version) })).WithMetadata(ci);

        group.MapPost("/deploy", async (DeployRequest body, HttpContext http, WincheFunctions functions, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (string.IsNullOrWhiteSpace(body.Note)) return Problem("Say what changed: it goes in the version list.");
            try { return Results.Json(Version(await functions.DeployAsync(body.Files ?? [], body.Note.Trim(), Who(http.User), ct))); }
            catch (FunctionDeployException ex) { return Problem(ex.Message, ex.Problems); }
            catch (FunctionsUnavailableException ex) { return Problem(ex.Message); }
        }).WithMetadata(ci);

        group.MapPost("/versions/{version:int}/rollback", async (int version, NoteRequest body, HttpContext http, WincheFunctions functions, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            try { return Results.Json(Version(await functions.RollBackAsync(version, string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim(), Who(http.User), ct))); }
            catch (FunctionDeployException ex) { return Problem(ex.Message, ex.Problems); }
            catch (FunctionsUnavailableException ex) { return Problem(ex.Message); }
        }).WithMetadata(ci);

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

        return app;
    }
}
