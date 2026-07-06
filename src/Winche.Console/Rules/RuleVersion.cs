namespace Winche.Console.Rules;

/// <summary>
/// One persisted, immutable version of a subsystem's ruleset. Rows are append-only: saving a new
/// ruleset inserts a new row and flips <see cref="IsActive"/> rather than mutating an existing row.
/// </summary>
public sealed class RuleVersion
{
    public Guid Id { get; set; }

    /// <summary>Which subsystem this version belongs to, e.g. "database" or "storage".</summary>
    public string Subsystem { get; set; } = "";

    /// <summary>Monotonic per <see cref="Subsystem"/>, starting at 1.</summary>
    public int Version { get; set; }

    /// <summary>Canonical <c>RuleJson.Serialize(RuleSet)</c> output.</summary>
    public string RulesJson { get; set; } = "";

    /// <summary>Whether this is the current "head" row for the subsystem. Exactly one per subsystem.</summary>
    public bool IsActive { get; set; }

    /// <summary>Optional human description of the change.</summary>
    public string? Note { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>Actor: email (Identity) or subject/preferred_username (Keycloak).</summary>
    public string? CreatedBy { get; set; }

    /// <summary>Provenance: set when this version was produced by reverting to an older version.</summary>
    public int? RevertedFromVersion { get; set; }
}
