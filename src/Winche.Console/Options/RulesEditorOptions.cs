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
}
