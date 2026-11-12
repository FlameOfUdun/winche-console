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
using Winche.Rules.Expressions;
using Winche.Rules.Json;
using Winche.Rules.Text;

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

    /// <summary>A rules file in the text syntax (<see cref="RuleText.ParseRuleSet"/>) to turn into rulesJson.</summary>
    public sealed record ParseRulesTextRequest(string Text);

    /// <summary>A ruleset's rulesJson to write as a rules file.</summary>
    public sealed record FormatRulesTextRequest(string RulesJson);

    /// <summary>Where a rules file is wrong; <see cref="Line"/>/<see cref="Column"/> are 1-based.</summary>
    public sealed record RulesSyntaxError(string Message, int Line, int Column, int Offset);

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

        // The rules file: the whole ruleset as text (same syntax for database and storage rules), which the
        // console edits; storage stays rulesJson. Parse always answers 200: { ok, rulesJson, error, warnings };
        // warnings name calls to functions the engine doesn't know (most likely a typo — they always deny).
        group.MapPost("/text/parse", (ParseRulesTextRequest body) =>
        {
            try
            {
                var ruleSet = RuleText.ParseRuleSet(body.Text ?? "");
                return Results.Json(new
                {
                    ok = true,
                    rulesJson = (string?)RuleJson.Serialize(ruleSet),
                    error = (RulesSyntaxError?)null,
                    warnings = UnknownFunctions(ruleSet).Select(n => $"Unknown function '{n}' — it will always deny.")
                        .Concat(DataInListRules(ruleSet)).ToList(),
                });
            }
            catch (RuleSyntaxException ex)
            {
                return Results.Json(new
                {
                    ok = false,
                    rulesJson = (string?)null,
                    error = (RulesSyntaxError?)new RulesSyntaxError(ex.Reason, ex.Line, ex.Column, ex.Offset),
                    warnings = new List<string>(),
                });
            }
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapPost("/text/format", (FormatRulesTextRequest body) =>
        {
            try
            {
                return Results.Json(new { text = RuleText.FormatRuleSet(RuleJson.DeserializeRuleSet(body.RulesJson)) });
            }
            catch (Exception ex) when (ex is JsonException or ArgumentException or NotSupportedException)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        }).RequireAuthorization(ConsoleRoles.AdminPolicy);

        // Field names for the editor's suggestions: the fields of documents a match pattern covers (database:
        // sampled, see RuleFieldSampler) or a file's fields (storage: fixed, plus sampled metadata keys are not
        // known here).
        group.MapGet("/{sys}/fields", async (
            string sys,
            string? pattern,
            [FromServices] IEnumerable<RuleSubsystemRegistration> registrations,
            [FromServices] IServiceProvider sp,
            CancellationToken ct) =>
        {
            var reg = FindRegistration(registrations, sys);
            if (reg is null) return Results.NotFound();
            if (sys == "storage") return Results.Json(new { fields = StorageFields });
            if (string.IsNullOrWhiteSpace(pattern)) return Results.Json(new { fields = Array.Empty<SampledField>() });
            var db = sp.GetService<Winche.Database.Runtime.DocumentDatabase>();
            if (db is null) return Results.Json(new { fields = Array.Empty<SampledField>() });
            return Results.Json(new { fields = await new RuleFieldSampler(db).SampleAsync(pattern, ct) });
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

    // A list (query) rule is proven from the query's filters, which constrain fields — resource.x. They can't
    // prove resource.data.x (a document may have its own `data` field), so such a list rule always denies.
    private static IEnumerable<string> DataInListRules(RuleSet ruleSet)
    {
        var paths = new List<string>();
        void Block(MatchBlock b, string parent)
        {
            var path = parent.Length == 0 ? b.Path : $"{parent}/{b.Path}";
            if (b.Allow.Any(a => a.Operations.Contains(RuleOperation.List) && ReadsResourceData(a.Condition)))
                paths.Add(path);
            foreach (var m in b.Matches) Block(m, path);
        }
        foreach (var m in ruleSet.Matches) Block(m, "");
        return paths.Select(p =>
            $"match {p}: in a rule that allows list (or read), write resource.x, not resource.data.x — a query can't prove resource.data, so it would deny.");
    }

    private static bool ReadsResourceData(RuleExpression e) => e switch
    {
        MemberExpression { Target: VarExpression { Name: "resource" }, Name: "data" } => true,
        MemberExpression m => ReadsResourceData(m.Target),
        IndexExpression ix => ReadsResourceData(ix.Target) || ReadsResourceData(ix.Index),
        CompareExpression c => ReadsResourceData(c.Left) || ReadsResourceData(c.Right),
        AndExpression a => a.Operands.Any(ReadsResourceData),
        OrExpression o => o.Operands.Any(ReadsResourceData),
        NotExpression n => ReadsResourceData(n.Operand),
        InExpression i => ReadsResourceData(i.Item) || ReadsResourceData(i.Collection),
        ConditionalExpression c => ReadsResourceData(c.Condition) || ReadsResourceData(c.Then) || ReadsResourceData(c.Else),
        CallExpression call => call.Args.Any(ReadsResourceData),
        _ => false,
    };

    private static IEnumerable<string> UnknownFunctions(RuleSet ruleSet)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        void Block(MatchBlock b)
        {
            foreach (var a in b.Allow) names.UnionWith(UnknownFunctions(a.Condition));
            foreach (var m in b.Matches) Block(m);
        }
        foreach (var m in ruleSet.Matches) Block(m);
        return names;
    }

    private static IEnumerable<string> UnknownFunctions(RuleExpression e)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        void Walk(RuleExpression x)
        {
            switch (x)
            {
                case CallExpression c:
                    if (!RuleFunctions.Names.Contains(c.Name)) names.Add(c.Name);
                    foreach (var a in c.Args) Walk(a);
                    break;
                case MemberExpression m: Walk(m.Target); break;
                case IndexExpression ix: Walk(ix.Target); Walk(ix.Index); break;
                case CompareExpression cmp: Walk(cmp.Left); Walk(cmp.Right); break;
                case AndExpression a: foreach (var o in a.Operands) Walk(o); break;
                case OrExpression o: foreach (var p in o.Operands) Walk(p); break;
                case NotExpression n: Walk(n.Operand); break;
                case InExpression i: Walk(i.Item); Walk(i.Collection); break;
                case ConditionalExpression cond: Walk(cond.Condition); Walk(cond.Then); Walk(cond.Else); break;
            }
        }
        Walk(e);
        return names;
    }

    // A file as storage rules see it (Winche.Storage FileToResource).
    private static readonly SampledField[] StorageFields =
    [
        new("createdAt", ["timestamp"]), new("directory", ["string"]), new("id", ["string"]),
        new("metadata", ["map"]), new("mimeType", ["string"]), new("path", ["string"]),
        new("sizeBytes", ["int"]), new("updatedAt", ["timestamp"]), new("uploadStatus", ["string"]),
        new("version", ["int"]),
    ];

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
    /// Parses <paramref name="rulesJson"/> and structurally validates it with Winche.Rules'
    /// <see cref="RuleSetValidation"/> (path patterns, nested matches under a recursive wildcard, two
    /// recursive wildcards in one path), reporting every problem rather than the first.
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

        // System.Text.Json leaves the positional `Matches` parameter null when the JSON carries no
        // correctly-cased "Matches" property (e.g. "{}" or a mis-cased "matches" key from hand-edited or
        // imported JSON). An absent match list is a valid, empty (deny-all) ruleset — normalize it so
        // validation is total and neither the loop below nor a later repo.Update(parsed) dereferences null.
        if (parsed.Matches is null)
            parsed = parsed with { Matches = [] };

        var errors = RuleSetValidation.Validate(parsed)
            .Select(issue => new RuleValidationError(issue.Path, issue.Message))
            .ToList();
        return errors.Count == 0 ? (parsed, errors) : (null, errors);
    }
}
