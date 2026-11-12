using Winche.Console.Tabs;

namespace Winche.Console.Options;

/// <summary>Fluent config for a built-in browser tab (Database or Storage): a minimum role and an optional rules editor.</summary>
public sealed class BuiltInTabBuilder
{
    /// <summary>Floor to see and read the tab; writes require at least Member. Default Viewer (read-all, write-Member).</summary>
    public ConsoleRole MinRole { get; set; } = ConsoleRole.Viewer;

    internal RulesEditorOptions? RulesEditor { get; private set; }

    internal bool Logs { get; private set; }

    /// <summary>
    /// Add a <b>Logs</b> sub-tab (Admins) showing this library's log entries (<c>Winche.Database.*</c> or
    /// <c>Winche.Storage.*</c>). What's kept, and for how long, is <see cref="ConsoleOptions.Logs"/>; needs
    /// <see cref="ConsoleOptions.ConnectionString"/> (the entries are stored in the console's database).
    /// </summary>
    public void UseLogs() => Logs = true;

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
    public bool Logs { get; init; }
}
