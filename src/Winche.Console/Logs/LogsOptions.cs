using Microsoft.Extensions.Logging;

namespace Winche.Console.Logs;

/// <summary>
/// What the console keeps of the app's logs (the Logs tab, and the Database and Storage tabs' Logs sub-tabs).
/// Entries go to a <c>console_logs</c> table in the console's database, written in the background.
/// </summary>
public sealed class LogsOptions
{
    /// <summary>The lowest level kept (default <see cref="LogLevel.Warning"/>; Information while debugging).</summary>
    public LogLevel MinimumLevel { get; set; } = LogLevel.Warning;

    /// <summary>How long entries are kept (default 7 days).</summary>
    public TimeSpan Retention { get; set; } = TimeSpan.FromDays(7);

    /// <summary>The most entries kept; the oldest go first beyond it (default 200,000).</summary>
    public int MaxEntries { get; set; } = 200_000;

    /// <summary>Entries waiting to be written beyond which new ones are dropped, so logging never blocks (default 10,000).</summary>
    public int QueueLimit { get; set; } = 10_000;

    /// <summary>How often queued entries are written (default 1 s).</summary>
    public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(1);
}
