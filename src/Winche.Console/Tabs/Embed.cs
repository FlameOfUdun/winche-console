namespace Winche.Console.Tabs;

/// <summary>
/// Escape-hatch leaf: mounts a consumer-authored document in a same-origin iframe at this position in the
/// layout tree. Binds to no data provider — the island self-fetches its own endpoints (the auth cookie rides
/// along because it is same-origin). See docs/superpowers/specs/2026-07-07-console-embed-escape-hatch-design.md.
/// </summary>
public sealed record Embed(string Id, string Route) : Node
{
    /// <summary>Share of a Row's width; same grid math as widgets. Must be &gt; 0.</summary>
    public int Flex { get; init; } = 1;

    /// <summary>Starting frame height (px) before the island reports its own via a resize message. Must be &gt; 0.</summary>
    public int MinHeight { get; init; } = 240;
}
