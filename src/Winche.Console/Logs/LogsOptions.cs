using Microsoft.Extensions.Logging;

namespace Winche.Console.Logs;

/// <summary>
/// What the console keeps of the app's logs (the Logs tab, and the Database and Storage tabs' Logs sub-tabs).
/// Entries go to a <c>console_logs</c> table in the console's database, written in the background.
/// </summary>
public sealed class LogsOptions
{
    /// <summary>
    /// The lowest level kept (default <see cref="LogLevel.Warning"/>). It's the starting value: Admins can change it,
    /// and set levels per source, in the console (which then applies on every instance until reset).
    /// </summary>
    public LogLevel MinimumLevel { get; set; } = LogLevel.Warning;

    // Request entries (Winche.Database / Winche.Storage LogRequests) are sampled at Information: keep them by default.
    private readonly List<LogLevelOverride> _overrides =
    [
        new("Winche.Database.Requests", LogLevel.Information),
        new("Winche.Storage.Requests", LogLevel.Information),
        new("Winche.Auth.Events", LogLevel.Information),
    ];
    internal IReadOnlyList<LogLevelOverride> Overrides => _overrides;

    /// <summary>
    /// A starting level for the sources whose category starts with <paramref name="category"/> (the longest match wins),
    /// e.g. <c>SetLevel("Microsoft", LogLevel.Warning)</c> with an Information default. Changeable in the console.
    /// </summary>
    public LogsOptions SetLevel(string category, LogLevel level)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(category);
        _overrides.RemoveAll(o => o.Category == category);
        _overrides.Add(new LogLevelOverride(category, level));
        return this;
    }

    /// <summary>How often each instance re-reads the levels saved in the console (default 10 s).</summary>
    public TimeSpan LevelSyncInterval { get; set; } = TimeSpan.FromSeconds(10);

    internal LogLevelSettings CodeLevels => new(MinimumLevel, [.. _overrides]);

    /// <summary>How long entries are kept (default 7 days).</summary>
    public TimeSpan Retention { get; set; } = TimeSpan.FromDays(7);

    /// <summary>The most entries kept; the oldest go first beyond it (default 200,000).</summary>
    public int MaxEntries { get; set; } = 200_000;

    /// <summary>Entries waiting to be written beyond which new ones are dropped, so logging never blocks (default 10,000).</summary>
    public int QueueLimit { get; set; } = 10_000;

    /// <summary>How often queued entries are written (default 1 s).</summary>
    public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(1);
}
