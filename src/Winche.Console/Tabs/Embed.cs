using System.Text;

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

    /// <summary>Extra sandbox capabilities added onto the mandatory base. Default None.</summary>
    public EmbedSandbox Sandbox { get; init; } = EmbedSandbox.None;
}

/// <summary>Extra iframe sandbox capabilities an <see cref="Embed"/> may opt into, added onto the mandatory base
/// (<c>allow-scripts allow-same-origin allow-forms</c>). Deliberately excludes navigation tokens like
/// allow-top-navigation — an island must not be able to navigate the whole console.</summary>
[Flags]
public enum EmbedSandbox
{
    None = 0,
    Popups = 1,                 // allow-popups
    Downloads = 2,              // allow-downloads
    Modals = 4,                 // allow-modals
    PopupsEscapeSandbox = 8,    // allow-popups-to-escape-sandbox
}

/// <summary>Merges the mandatory sandbox base with an <see cref="EmbedSandbox"/> selection into an attribute value.</summary>
internal static class EmbedSandboxPolicy
{
    public const string Base = "allow-scripts allow-same-origin allow-forms";

    public static string ToAttribute(EmbedSandbox extras)
    {
        if (extras == EmbedSandbox.None) return Base;
        var sb = new StringBuilder(Base);
        if (extras.HasFlag(EmbedSandbox.Popups)) sb.Append(" allow-popups");
        if (extras.HasFlag(EmbedSandbox.Downloads)) sb.Append(" allow-downloads");
        if (extras.HasFlag(EmbedSandbox.Modals)) sb.Append(" allow-modals");
        if (extras.HasFlag(EmbedSandbox.PopupsEscapeSandbox)) sb.Append(" allow-popups-to-escape-sandbox");
        return sb.ToString();
    }
}
