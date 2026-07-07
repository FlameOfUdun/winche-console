namespace Winche.Console.Tabs;

/// <summary>Base of the layout tree. Concrete kinds: Column/Row/Section (containers), Filter, and WidgetNode leaves.</summary>
public abstract record Node;

public sealed record Column(IReadOnlyList<Node> Children) : Node;

/// <summary>Horizontal container. Default: a 12-column grid sized by each child's Flex (best for widgets).
/// Set <see cref="Justify"/> to instead pack children tightly (content-width) with that horizontal alignment
/// — the right choice for a toolbar of buttons/controls.</summary>
public sealed record Row(IReadOnlyList<Node> Children) : Node
{
    public RowJustify? Justify { get; init; }
}

/// <summary>How a <see cref="Row"/> with <see cref="Row.Justify"/> set distributes its (content-width) children.</summary>
public enum RowJustify { Start, Center, End, SpaceBetween }

public sealed record Section(string Title, string? Subtitle, IReadOnlyList<Node> Children) : Node;
