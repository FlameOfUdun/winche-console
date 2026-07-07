using Winche.Console.Tabs;

namespace Winche.Console.Options;

/// <summary>Fluent config for a built-in browser tab (Database or Storage): a minimum role and an optional rules editor.</summary>
public sealed class BuiltInTabBuilder
{
    /// <summary>Floor to see and read the tab; writes require at least Member. Default Viewer (read-all, write-Member).</summary>
    public ConsoleRole MinRole { get; set; } = ConsoleRole.Viewer;

    internal RulesEditorOptions? RulesEditor { get; private set; }

    /// <summary>Enable the GUI rules editor for this subsystem (adds its Rules sub-tab).</summary>
    public void UseRulesEditor(Action<RulesEditorOptions>? configure = null)
    {
        var opts = new RulesEditorOptions();
        configure?.Invoke(opts);
        RulesEditor = opts;
    }
}

/// <summary>Resolved built-in tab config stored on <see cref="ConsoleOptions"/>.</summary>
internal sealed class BuiltInTabConfig
{
    public required ConsoleRole MinRole { get; init; }
    public RulesEditorOptions? RulesEditor { get; init; }
}
