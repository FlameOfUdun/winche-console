namespace Winche.Console.Tabs;

/// <summary>Depth-first traversal of a layout tree, descending containers and both filter forms.</summary>
internal static class LayoutWalk
{
    public static IEnumerable<Node> All(Node node)
    {
        yield return node;
        foreach (var child in ChildrenOf(node))
            foreach (var n in All(child))
                yield return n;
    }

    public static IEnumerable<WidgetNode> Widgets(Node root) => All(root).OfType<WidgetNode>();

    public static IEnumerable<Embed> Embeds(Node root) => All(root).OfType<Embed>();

    public static IReadOnlyList<Control> Controls(Node root) =>
        All(root).OfType<Filter>().Select(f => f.Control).ToList();

    public static IReadOnlyList<Type> ProviderTypes(Node root) =>
        Widgets(root).Select(w => w.ProviderType).Distinct().ToList();

    public static WidgetNode? FindWidget(Node root, string id) =>
        Widgets(root).FirstOrDefault(w => w.Id == id);

    private static IEnumerable<Node> ChildrenOf(Node node) => node switch
    {
        Column c => c.Children,
        Row r => r.Children,
        Section s => s.Children,
        Filter { IsSwitch: false } f => f.Children!,
        Filter { IsSwitch: true } f => f.Branches!.Values.SelectMany(b => b),
        _ => Enumerable.Empty<Node>(),
    };
}
