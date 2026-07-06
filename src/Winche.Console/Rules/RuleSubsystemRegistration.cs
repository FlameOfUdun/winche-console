namespace Winche.Console.Rules;

/// <summary>
/// Describes one enabled subsystem's rules editor wiring: which subsystem it is (see
/// <see cref="RuleSubsystems"/>), the DI service key of its keyed
/// <c>Winche.Rules.IMutableRuleSetRepository</c>, and whether the persisted "head" version should be
/// re-applied to the live repository on startup. All subsystems share the console's connection string
/// (held by <see cref="RuleStoreFactory"/>), so no connection is carried here.
/// </summary>
/// <remarks>
/// <paramref name="RepositoryKey"/> is the DI service key used to resolve that subsystem's keyed
/// <c>IMutableRuleSetRepository</c> — e.g. Winche.Database's <c>WincheDatabaseKeys.RuleEngine</c> or
/// Winche.Storage's key. This record stays agnostic of the concrete key types (typed as
/// <see cref="object"/>).
/// </remarks>
/// <param name="Subsystem">One of <see cref="RuleSubsystems"/>'s constants.</param>
/// <param name="RepositoryKey">The DI service key for this subsystem's keyed <c>IMutableRuleSetRepository</c>.</param>
/// <param name="ApplyOnStartup">Whether the persisted active version should be re-applied to the live
/// repository on host startup. When <see langword="false"/>, the host's code-seeded rules are left untouched.</param>
internal sealed record RuleSubsystemRegistration(
    string Subsystem,
    object RepositoryKey,
    bool ApplyOnStartup);
