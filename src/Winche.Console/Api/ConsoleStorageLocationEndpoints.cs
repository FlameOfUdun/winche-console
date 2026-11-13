using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Core;
using Winche.Console.Identity;
using Winche.Storage.Locations;

namespace Winche.Console.Api;

/// <summary>
/// Storage → Settings → Where files are kept: test a new location, then move files there as guided steps (copy,
/// switch, finish). Every step is kept in the change history with its reason.
/// </summary>
public static class ConsoleStorageLocationEndpoints
{
    public sealed record TestRequest(ArchiveLocation? Location, string? SecretKey);
    public sealed record MoveRequest(ArchiveLocation? Location, string? SecretKey, string? Reason);
    public sealed record StepRequest(string? Reason);

    private static string? Who(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.Identity?.Name;

    private static IResult Problem(string message) => ConsoleErrors.Problem("move", message, null);

    /// <summary>The app's own location, in words.</summary>
    private static string DescribeCode(ArchiveLocations locations)
    {
        var archive = locations.Code;
        return archive.GetType().Name switch
        {
            "FileSystemArchive" => $"a folder on the server ({archive.GetType().GetProperty("Root")?.GetValue(archive)})",
            "S3Archive" => "the S3 bucket set in the app's code",
            "NullArchive" => "nowhere yet (no archive in the app's code)",
            var name => $"the app's own archive ({name})",
        };
    }

    /// <summary>A new location gets an id (it names the location's secret).</summary>
    private static ArchiveLocation WithId(ArchiveLocation l) => string.IsNullOrWhiteSpace(l.Id) ? l with { Id = Guid.NewGuid().ToString("N")[..12] } : l;

    public static IEndpointRouteBuilder MapConsoleStorageLocationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings/storage/location").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("", async (StorageMoves moves, ArchiveLocations locations, IServiceProvider sp, CancellationToken ct) =>
        {
            var state = moves.State;
            var secrets = sp.GetService<SecretStore>();
            return Results.Json(new
            {
                active = state.Active,
                activeLabel = state.Active is { } a ? a.Describe() : DescribeCode(locations),
                codeLabel = DescribeCode(locations),
                kinds = locations.Kinds,
                move = state.Move is { } m ? new
                {
                    m.Id, m.Phase, m.StartedAt, from = m.From, to = m.To,
                    fromLabel = m.From is { } f ? f.Describe() : DescribeCode(locations),
                    toLabel = m.To is { Kind: not "code" } t ? t.Describe() : DescribeCode(locations),
                } : null,
                progress = await moves.ProgressAsync(ct),
                editable = sp.GetService<SettingsStore>() is not null,
                secretsAvailable = secrets?.Available ?? false,
            }, SettingsArea.Json);
        });

        group.MapPost("/test", async (TestRequest body, StorageMoves moves, CancellationToken ct) =>
            body.Location is null ? Problem("Fill in the location.")
                : Results.Json(await moves.TestAsync(WithId(body.Location), string.IsNullOrEmpty(body.SecretKey) ? null : body.SecretKey, ct), SettingsArea.Json));

        group.MapPost("/move", async (MoveRequest body, HttpContext http, StorageMoves moves, CancellationToken ct) =>
        {
            if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
            if (body.Location is null) return Problem("Fill in the location.");
            if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why you're moving the files: it goes in the history.");
            var location = WithId(body.Location);
            if (location.Kind != "code")
            {
                var test = await moves.TestAsync(location, string.IsNullOrEmpty(body.SecretKey) ? null : body.SecretKey, ct);
                if (!test.Ok) return Problem($"The new location didn't pass its test: {string.Join(" ", test.Steps.Where(s => !s.Ok).Select(s => $"{s.Name}: {s.Error}"))}");
            }
            try { return Results.Json(await moves.StartAsync(location, body.SecretKey, Who(http.User), body.Reason, ct), SettingsArea.Json); }
            catch (StorageMoveException ex) { return Problem(ex.Message); }
        });

        foreach (var (step, run) in new (string, Func<StorageMoves, string?, string, CancellationToken, Task>)[]
        {
            ("switch", (m, by, why, ct) => m.SwitchAsync(by, why, ct)),
            ("finish", (m, by, why, ct) => m.FinishAsync(by, why, ct)),
            ("cancel", (m, by, why, ct) => m.CancelAsync(by, why, ct)),
        })
        {
            group.MapPost($"/move/{step}", async (StepRequest body, HttpContext http, StorageMoves moves, CancellationToken ct) =>
            {
                if (await ConsoleAuthSettingsEndpoints.RequireTwoFactorAsync(http) is { } refused) return refused;
                if (string.IsNullOrWhiteSpace(body.Reason)) return Problem("Say why: it goes in the history.");
                try { await run(moves, Who(http.User), body.Reason, ct); return Results.NoContent(); }
                catch (StorageMoveException ex) { return Problem(ex.Message); }
            });
        }
        return app;
    }
}
