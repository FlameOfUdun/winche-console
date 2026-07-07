using Winche.Console.Options;

namespace Winche.Console.Tabs;

/// <summary>Holds all registered custom tabs. Singleton, resolved from ConsoleOptions.</summary>
public sealed class TabRegistry
{
    public IReadOnlyList<TabDefinition> Tabs { get; }

    internal TabRegistry(IReadOnlyList<TabDefinition> tabs) => Tabs = tabs;
    public TabRegistry(ConsoleOptions options) : this(options.Tabs) { }

    public TabDefinition? Find(string id) => Tabs.FirstOrDefault(t => t.Id == id);
    public IEnumerable<TabDefinition> Visible(ConsoleRole role) => Tabs.Where(t => role >= t.MinRole);
}
