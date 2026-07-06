using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Identity;
using Winche.Console.Rules;
using Winche.Rules;
using Winche.Rules.Evaluation;
using Winche.Rules.Json;

namespace Winche.Console.Api;

public static class ConsoleRulesEndpoints
{
    /// <summary>Subsystem status row for the SPA's per-subsystem gating (see <c>api/rules/subsystems</c>).</summary>
    public sealed record RuleSubsystemStatus(string Id, bool Available, bool ApplyOnStartup, bool LiveMatchesHead);

    /// <summary>Version metadata without the (potentially large) rules JSON payload.</summary>
    public sealed record RuleVersionSummary(
        int Version,
        bool IsActive,
        string? Note,
        DateTimeOffset CreatedAtUtc,
        string? CreatedBy,
        int? RevertedFromVersion);

    /// <summary>A single version including its full rules JSON.</summary>
    public sealed record RuleVersionDetail(
        int Version,
        bool IsActive,
        string? Note,
        DateTimeOffset CreatedAtUtc,
        string? CreatedBy,
        int? RevertedFromVersion,
        string RulesJson);

    public sealed record SaveRulesRequest(string RulesJson, string? Note, int? ExpectedHeadVersion);

    public sealed record ValidateRulesRequest(string RulesJson);

    /// <summary>
    /// Dry-run a draft ruleset against a single simulated request. <see cref="ResourceJson"/>/<see cref="RequestJson"/>
    /// are each a JSON-encoded <c>Winche.Rules.RuleValue</c> map (or <see langword="null"/>/empty for
    /// <c>RuleValue.Null</c>); <see cref="Params"/> maps path-capture names to their own <c>RuleValue</c> JSON.
    /// </summary>
    public sealed record SimulateRequest(
        string RulesJson,
        string Operation,
        string DocumentPath,
        string? ResourceJson,
        string? RequestJson,
        Dictionary<string, string>? Params);

    /// <summary>One structural validation problem; <see cref="Path"/> is the offending match block's
    /// (breadcrumb-joined) path when known, or <see langword="null"/> for whole-document errors.</summary>
    public sealed record RuleValidationError(string? Path, string Message);

    /// <summary>
    /// Maps the <c>api/rules</c> endpoint group: per-subsystem live rules, version history, save
    /// (with optimistic concurrency + hot-swap), revert, drift reconciliation, validate-only, and
    /// simulate (dry-run a draft ruleset against one request, without touching the live repository).
    /// Every route requires <see cref="ConsoleRoles.AdminPolicy"/>. A subsystem whose
    /// <c>UseDatabaseRulesEditor</c>/<c>UseStorageRulesEditor</c> was never called has no matching
    /// <see cref="RuleSubsystemRegistration"/>, so its routes report 404 rather than throwing.
    /// </summary>
    public static IEndpointRouteBuilder MapConsoleRulesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/rules");

        group.MapGet("/subsystems", async (
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] RuleStoreFactory storeFactory,
            [FromServices] TimeProvider timeProvider,
            [FromServices] IServiceProvider sp,
            CancellationToken ct) =>
        {
            var results = new List<RuleSubsystemStatus>();
            foreach (var reg in registrations)
            {
                var repo = sp.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
                var liveMatchesHead = true;
                if (repo is not null)
                {
                    try
                    {
                        await using var ctx = storeFactory.CreateContext();
                        var store = new RuleVersionStore(ctx, timeProvider);
                        var active = await store.GetActiveAsync(reg.Subsystem, ct);
                        liveMatchesHead = active is null || repo.Current.Equals(RuleJson.DeserializeRuleSet(active.RulesJson));
                    }
                    catch
                    {
                        // Can't determine drift (e.g. the version store is unreachable); don't false-alarm.
                        liveMatchesHead = true;
                    }
                }

                results.Add(new RuleSubsystemStatus(reg.Subsystem, repo is not null, reg.ApplyOnStartup, liveMatchesHead));
            }

            return Results.Json(results);
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{sys}/live", (
            string sys,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] IServiceProvider sp) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            var repo = sp.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
            if (repo is null) return Results.Conflict(new { error = "subsystem_unavailable" });

            return Results.Json(new { rulesJson = RuleJson.Serialize(repo.Current) });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{sys}/versions", async (
            string sys,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] RuleStoreFactory storeFactory,
            [FromServices] TimeProvider timeProvider,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            await using var ctx = storeFactory.CreateContext();
            var store = new RuleVersionStore(ctx, timeProvider);
            var list = await store.ListAsync(sys, ct);
            return Results.Json(list.Select(ToSummary));
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("/{sys}/versions/{version:int}", async (
            string sys,
            int version,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] RuleStoreFactory storeFactory,
            [FromServices] TimeProvider timeProvider,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            await using var ctx = storeFactory.CreateContext();
            var store = new RuleVersionStore(ctx, timeProvider);
            var v = await store.GetAsync(sys, version, ct);
            return v is null ? Results.NotFound() : Results.Json(ToDetail(v));
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/{sys}", async (
            string sys,
            SaveRulesRequest body,
            HttpContext http,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] RuleStoreFactory storeFactory,
            [FromServices] TimeProvider timeProvider,
            [FromServices] IServiceProvider sp,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            var (parsed, errors) = ValidateRulesJson(body.RulesJson);
            if (parsed is null) return Results.BadRequest(new { errors });

            await using var ctx = storeFactory.CreateContext();
            var store = new RuleVersionStore(ctx, timeProvider);
            var actor = GetActor(http.User);

            RuleVersion saved;
            try
            {
                saved = await store.AppendAsync(
                    sys, body.RulesJson, body.Note, actor,
                    revertedFromVersion: null, expectedActiveVersion: body.ExpectedHeadVersion, ct);
            }
            catch (RuleVersionConflictException ex)
            {
                return Results.Conflict(new { error = "version_conflict", currentHeadVersion = ex.ActualActiveVersion });
            }

            var repo = sp.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
            repo?.Update(parsed);

            return Results.Json(ToDetail(saved));
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/{sys}/revert/{version:int}", async (
            string sys,
            int version,
            HttpContext http,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] RuleStoreFactory storeFactory,
            [FromServices] TimeProvider timeProvider,
            [FromServices] IServiceProvider sp,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            await using var ctx = storeFactory.CreateContext();
            var store = new RuleVersionStore(ctx, timeProvider);

            var target = await store.GetAsync(sys, version, ct);
            if (target is null) return Results.NotFound();

            var actor = GetActor(http.User);
            var reverted = await store.AppendAsync(
                sys, target.RulesJson, $"Reverted to v{target.Version}", actor,
                revertedFromVersion: target.Version, expectedActiveVersion: null, ct);

            var repo = sp.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
            repo?.Update(RuleJson.DeserializeRuleSet(reverted.RulesJson));

            return Results.Json(ToDetail(reverted));
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/{sys}/apply-head", async (
            string sys,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] RuleStoreFactory storeFactory,
            [FromServices] TimeProvider timeProvider,
            [FromServices] IServiceProvider sp,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            var repo = sp.GetKeyedService<IMutableRuleSetRepository>(reg.RepositoryKey);
            if (repo is null) return Results.Conflict(new { error = "subsystem_unavailable" });

            await using var ctx = storeFactory.CreateContext();
            var store = new RuleVersionStore(ctx, timeProvider);
            var head = await store.GetActiveAsync(sys, ct);
            if (head is null) return Results.Json(new { appliedVersion = (int?)null });

            repo.Update(RuleJson.DeserializeRuleSet(head.RulesJson));
            return Results.Json(new { appliedVersion = (int?)head.Version });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/{sys}/validate", (
            string sys,
            ValidateRulesRequest body,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            var (parsed, errors) = ValidateRulesJson(body.RulesJson);
            return Results.Json(new { ok = parsed is not null, errors });
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/{sys}/simulate", async (
            string sys,
            SimulateRequest body,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] IServiceProvider sp,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();

            var (parsed, errors) = ValidateRulesJson(body.RulesJson);
            if (parsed is null) return Results.BadRequest(new { errors });

            if (!Enum.TryParse<RuleOperation>(body.Operation, ignoreCase: true, out var op))
                return Results.BadRequest(new { error = "invalid_operation" });

            RuleValue resource;
            RuleValue request;
            var paramsMap = new Dictionary<string, RuleValue>();
            try
            {
                resource = ParseRuleValue(body.ResourceJson);
                request = ParseRuleValue(body.RequestJson);
                if (body.Params is not null)
                {
                    foreach (var (k, v) in body.Params)
                        paramsMap[k] = ParseRuleValue(v);
                }
            }
            catch (JsonException ex)
            {
                return Results.BadRequest(new { error = $"Invalid RuleValue JSON: {ex.Message}" });
            }

            var comparer = sp.GetKeyedService<IRuleValueComparer>(reg.RepositoryKey) ?? new DefaultRuleValueComparer();
            var engine = new RuleEngine(new StaticRuleSetRepository(parsed), comparer);
            var ruleRequest = new RuleRequest
            {
                Resource = resource,
                Request = request,
                Params = paramsMap,
                Provider = null,
            };

            try
            {
                var allowed = await engine.AllowsAsync(op, body.DocumentPath, ruleRequest, ct);
                return Results.Json(new { allowed, error = (string?)null });
            }
            catch (RuleEvaluationException ex)
            {
                return Results.Json(new { allowed = false, error = ex.Message });
            }
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        return app;
    }

    private static RuleSubsystemRegistration? FindRegistration(IEnumerable<RuleSubsystemRegistration> registrations, string sys) =>
        registrations.FirstOrDefault(r => string.Equals(r.Subsystem, sys, StringComparison.Ordinal));

    private static RuleVersionSummary ToSummary(RuleVersion v) =>
        new(v.Version, v.IsActive, v.Note, v.CreatedAtUtc, v.CreatedBy, v.RevertedFromVersion);

    private static RuleVersionDetail ToDetail(RuleVersion v) =>
        new(v.Version, v.IsActive, v.Note, v.CreatedAtUtc, v.CreatedBy, v.RevertedFromVersion, v.RulesJson);

    /// <summary>
    /// Deserializes a JSON-encoded <see cref="RuleValue"/> (typically a map); <see langword="null"/> or
    /// whitespace-only input yields <see cref="RuleValue.Null"/>. Throws <see cref="JsonException"/> on
    /// malformed input, which callers turn into a 400.
    /// </summary>
    private static RuleValue ParseRuleValue(string? json) =>
        string.IsNullOrWhiteSpace(json) ? RuleValue.Null : JsonSerializer.Deserialize<RuleValue>(json, RuleJson.Options);

    /// <summary>Prefers the email claim, then the principal's name, then the subject claim; may be null.</summary>
    private static string? GetActor(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Email)
            ?? user.FindFirstValue("email")
            ?? user.Identity?.Name
            ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? user.FindFirstValue("sub");

    /// <summary>
    /// Parses <paramref name="rulesJson"/> and structurally validates every match block's path pattern.
    /// Path-pattern parsing and the "no nested matches under a recursive wildcard" rule live on
    /// <c>Winche.Rules</c>'s internal <c>PathPattern</c> type (only visible to <c>RuleSetBuilder</c>/
    /// <c>MatchBuilder</c> within that package), so rather than duplicate that logic here, this rebuilds
    /// each match block through the public <see cref="RuleSetBuilder"/> fluent API — which performs the
    /// exact same checks — and turns any resulting <see cref="ArgumentException"/> into a structured error.
    /// </summary>
    private static (RuleSet? RuleSet, IReadOnlyList<RuleValidationError> Errors) ValidateRulesJson(string rulesJson)
    {
        RuleSet parsed;
        try
        {
            parsed = RuleJson.DeserializeRuleSet(rulesJson);
        }
        catch (JsonException ex)
        {
            return (null, [new RuleValidationError(null, $"Invalid rules JSON: {ex.Message}")]);
        }

        var errors = new List<RuleValidationError>();
        foreach (var block in parsed.Matches)
            ValidateMatchBlock(block, errors, breadcrumb: "");

        return errors.Count == 0 ? (parsed, errors) : (null, errors);
    }

    private static void ValidateMatchBlock(MatchBlock block, List<RuleValidationError> errors, string breadcrumb)
    {
        var label = breadcrumb.Length == 0 ? block.Path : $"{breadcrumb}/{block.Path}";

        try
        {
            // A one-off probe tree: builds just this block (plus a trivial nested probe match when it
            // has children, to trigger the recursive-wildcard-with-nested-matches check) without needing
            // to also validate the real children here — they're validated independently below, so one
            // invalid block never masks errors in its siblings.
            RuleSetBuilder.Build(root => root.Match(block.Path, match =>
            {
                if (block.Matches.Count > 0)
                    match.Match("__validation_probe__", _ => { });
            }));
        }
        catch (ArgumentException ex)
        {
            errors.Add(new RuleValidationError(label, ex.Message));
        }

        foreach (var child in block.Matches)
            ValidateMatchBlock(child, errors, label);
    }
}
