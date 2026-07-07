using System.Text.Json;
using System.Text.Json.Serialization;

namespace Winche.Console.Tabs;

/// <summary>Projects tabs to the wire shapes the SPA consumes: a nav entry and a recursive layout tree.</summary>
internal static class TabManifest
{
    /// <summary>camelCase + string enums; used for the manifest AND the data payload so the SPA sees one casing.</summary>
    public static JsonSerializerOptions JsonOptions { get; } = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static object Nav(TabDefinition t) => new { id = t.Id, label = t.Label, icon = t.Icon };

    public static object Layout(TabDefinition t) => new { id = t.Id, label = t.Label, root = Project(t.Root) };

    private static object Project(Node node) => node switch
    {
        Column c => new { type = "column", children = c.Children.Select(Project).ToArray() },
        Row r => new { type = "row", children = r.Children.Select(Project).ToArray() },
        Section s => new { type = "section", title = s.Title, subtitle = s.Subtitle, children = s.Children.Select(Project).ToArray() },
        Filter { IsSwitch: false } f => new
        {
            type = "filter", control = Project(f.Control), mode = "reactive",
            children = f.Children!.Select(Project).ToArray(),
        },
        Filter { IsSwitch: true } f => new
        {
            type = "filter", control = Project(f.Control), mode = "switch",
            branches = f.Branches!.ToDictionary(kv => kv.Key, kv => kv.Value.Select(Project).ToArray()),
        },
        Embed e => new { type = "embed", id = e.Id, route = e.Route, flex = e.Flex, minHeight = e.MinHeight, sandbox = EmbedSandboxPolicy.ToAttribute(e.Sandbox) },
        WidgetNode w => ProjectWidget(w),
        _ => throw new InvalidOperationException($"Unknown node {node.GetType().Name}."),
    };

    // Chart carries an extra "chart" tag (via the IChartNode marker from WidgetNode.cs); others are plain.
    private static object ProjectWidget(WidgetNode w) => w is IChartNode c
        ? new { type = "widget", kind = w.Kind, id = w.Id, flex = w.Flex, chart = c.ChartKind.ToString().ToLowerInvariant() }
        : new { type = "widget", kind = w.Kind, id = w.Id, flex = w.Flex };

    private static object Project(Control c) => c switch
    {
        Select s => new { kind = s.Kind, id = s.Id, options = s.Options },
        DateRange d => new { kind = d.Kind, id = d.Id },
        _ => new { kind = c.Kind, id = c.Id },
    };
}
