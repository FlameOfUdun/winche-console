using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Winche.Console.Logs;

/// <summary>A level for the entries whose category starts with <see cref="Category"/>, until <see cref="Until"/> (if set).</summary>
public sealed record LogLevelOverride(
    [property: JsonPropertyName("category")] string Category,
    [property: JsonPropertyName("level")] LogLevel Level,
    [property: JsonPropertyName("until")] DateTimeOffset? Until = null);

/// <summary>Which entries the console keeps: a default level, and overrides by category prefix (the longest match wins).</summary>
public sealed record LogLevelSettings(
    [property: JsonPropertyName("defaultLevel")] LogLevel DefaultLevel,
    [property: JsonPropertyName("overrides")] IReadOnlyList<LogLevelOverride> Overrides)
{
    public const int MaxOverrides = 50;

    /// <summary>The level kept for <paramref name="category"/> at <paramref name="now"/>.</summary>
    public LogLevel For(string category, DateTimeOffset now)
    {
        LogLevelOverride? best = null;
        foreach (var o in Overrides)
        {
            if (o.Until is { } until && until <= now) continue;
            if (!Matches(category, o.Category)) continue;
            if (best is null || o.Category.Length > best.Category.Length) best = o;
        }
        return best?.Level ?? DefaultLevel;
    }

    /// <summary>A category is under a prefix when it equals it or continues it at a '.' (<c>A.B</c> covers <c>A.B.C</c>, not <c>A.BC</c>).</summary>
    public static bool Matches(string category, string prefix) =>
        category.StartsWith(prefix, StringComparison.Ordinal)
        && (category.Length == prefix.Length || prefix.EndsWith('.') || category[prefix.Length] == '.');

    /// <summary>The same settings without expired overrides.</summary>
    public LogLevelSettings WithoutExpired(DateTimeOffset now) =>
        this with { Overrides = [.. Overrides.Where(o => o.Until is null || o.Until > now)] };

    /// <summary>Problems with settings sent from the console, or empty.</summary>
    public IReadOnlyList<string> Problems(DateTimeOffset now)
    {
        var problems = new List<string>();
        if (!Enum.IsDefined(DefaultLevel)) problems.Add($"Unknown default level {(int)DefaultLevel}.");
        if (Overrides.Count > MaxOverrides) problems.Add($"At most {MaxOverrides} overrides.");
        foreach (var o in Overrides)
        {
            if (string.IsNullOrWhiteSpace(o.Category)) problems.Add("An override needs a source (a category or its start, e.g. SmartAirway.Reports).");
            if (!Enum.IsDefined(o.Level)) problems.Add($"Unknown level {(int)o.Level} for {o.Category}.");
            if (o.Until is { } until && until <= now) problems.Add($"The override for {o.Category} has already ended.");
        }
        foreach (var dup in Overrides.GroupBy(o => o.Category).Where(g => g.Count() > 1))
            problems.Add($"{dup.Key} has more than one override.");
        return problems;
    }
}
