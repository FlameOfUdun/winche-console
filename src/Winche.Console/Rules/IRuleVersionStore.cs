namespace Winche.Console.Rules;

/// <summary>Durable, versioned storage for one subsystem's rulesets. See <see cref="RuleVersion"/>.</summary>
public interface IRuleVersionStore
{
    /// <summary>The current active ("head") version for <paramref name="subsystem"/>, if any.</summary>
    Task<RuleVersion?> GetActiveAsync(string subsystem, CancellationToken ct = default);

    /// <summary>All versions for <paramref name="subsystem"/>, newest first.</summary>
    Task<IReadOnlyList<RuleVersion>> ListAsync(string subsystem, CancellationToken ct = default);

    /// <summary>A specific version of <paramref name="subsystem"/>'s ruleset, if it exists.</summary>
    Task<RuleVersion?> GetAsync(string subsystem, int version, CancellationToken ct = default);

    /// <summary>
    /// Appends a new head version for <paramref name="subsystem"/>. If <paramref name="expectedActiveVersion"/>
    /// is supplied, it must match the subsystem's current active version number (optimistic concurrency);
    /// otherwise a <see cref="RuleVersionConflictException"/> is thrown and nothing is written.
    /// </summary>
    Task<RuleVersion> AppendAsync(
        string subsystem,
        string rulesJson,
        string? note,
        string? actor,
        int? revertedFromVersion,
        int? expectedActiveVersion,
        CancellationToken ct = default);
}
