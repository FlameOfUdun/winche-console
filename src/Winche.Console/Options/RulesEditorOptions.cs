namespace Winche.Console.Options;

/// <summary>Configuration for a subsystem's (database or storage) GUI rules editor.</summary>
public sealed class RulesEditorOptions
{
    /// <summary>
    /// When true (default), the console re-applies the persisted active ruleset to the subsystem's
    /// rule engine on startup. When false, the host's code-seeded rules are left untouched at boot;
    /// edits made through the editor still persist and hot-swap at runtime.
    /// </summary>
    public bool ApplyPersistedRulesOnStartup { get; set; } = true;

    /// <summary>
    /// How often each node checks for a rules version saved (or reverted/applied) on another node and
    /// applies it, so every node of a multi-node host enforces the same rules. Only changes made after
    /// the node started are applied this way; what happens at boot is <see cref="ApplyPersistedRulesOnStartup"/>.
    /// <see cref="TimeSpan.Zero"/> disables it (single-node hosts). Default 10 seconds.
    /// </summary>
    public TimeSpan SyncInterval { get; set; } = TimeSpan.FromSeconds(10);
}
