namespace Winche.Console.Rules;

/// <summary>
/// Thrown by <see cref="IRuleVersionStore.AppendAsync"/> when the caller's
/// <c>expectedActiveVersion</c> no longer matches the subsystem's current active version — i.e. someone
/// else saved a newer head in the meantime. Callers (the REST layer) should map this to an HTTP 409.
/// </summary>
public sealed class RuleVersionConflictException : Exception
{
    public string Subsystem { get; }

    /// <summary>The version number the caller expected to be active (or <c>null</c> if it expected none).</summary>
    public int? ExpectedActiveVersion { get; }

    /// <summary>The version number that was actually active (or <c>null</c> if none exists).</summary>
    public int? ActualActiveVersion { get; }

    public RuleVersionConflictException(string subsystem, int? expectedActiveVersion, int? actualActiveVersion)
        : base(
            $"Rule version conflict for subsystem '{subsystem}': expected active version " +
            $"{(expectedActiveVersion is null ? "none" : expectedActiveVersion.ToString())}, " +
            $"but the current active version is {(actualActiveVersion is null ? "none" : actualActiveVersion.ToString())}.")
    {
        Subsystem = subsystem;
        ExpectedActiveVersion = expectedActiveVersion;
        ActualActiveVersion = actualActiveVersion;
    }
}
