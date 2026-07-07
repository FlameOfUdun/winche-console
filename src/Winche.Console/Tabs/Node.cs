namespace Winche.Console.Tabs;

/// <summary>Base of the layout tree. Concrete kinds: Column/Row/Section (containers), Filter, and WidgetNode leaves.</summary>
public abstract record Node;

public sealed record Column(IReadOnlyList<Node> Children) : Node;
public sealed record Row(IReadOnlyList<Node> Children) : Node;
public sealed record Section(string Title, string? Subtitle, IReadOnlyList<Node> Children) : Node;
