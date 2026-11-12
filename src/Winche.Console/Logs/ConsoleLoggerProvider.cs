using System.Threading.Channels;
using Microsoft.Extensions.Logging;

namespace Winche.Console.Logs;

/// <summary>
/// Entries waiting to be written, and which categories are kept at all: everything when the Logs tab is on, else
/// only the libraries whose sub-tab is on (<c>Winche.Database</c>, <c>Winche.Storage</c>).
/// </summary>
internal sealed class ConsoleLogQueue
{
    public const string OwnCategory = "Winche.Console.Logs";

    private readonly Channel<LogRecord> _channel;
    private readonly Func<string, bool> _keep;
    private readonly TimeProvider _time;
    private volatile LogLevelSettings _levels;

    public ConsoleLogQueue(LogsOptions options, bool everything, IReadOnlyList<string> prefixes, TimeProvider? time = null)
    {
        _time = time ?? TimeProvider.System;
        _levels = options.CodeLevels;
        _channel = Channel.CreateBounded<LogRecord>(new BoundedChannelOptions(Math.Max(1, options.QueueLimit))
        {
            FullMode = BoundedChannelFullMode.DropWrite,   // never block the code that logs
            SingleReader = true,
        });
        _keep = category => !category.StartsWith(OwnCategory, StringComparison.Ordinal)
            && (everything || prefixes.Any(p => category.StartsWith(p, StringComparison.Ordinal)));
    }

    /// <summary>The levels in force (the code's, or the ones saved in the console).</summary>
    public LogLevelSettings Levels
    {
        get => _levels;
        set => _levels = value;
    }

    /// <summary>The lowest level kept for <paramref name="category"/> right now.</summary>
    public LogLevel MinimumFor(string category) => _levels.For(category, _time.GetUtcNow());
    public ChannelReader<LogRecord> Reader => _channel.Reader;
    public bool Keeps(string category) => _keep(category);
    public void Add(LogRecord record) => _channel.Writer.TryWrite(record);
}

/// <summary>The console's logging provider: queues the entries it keeps for <see cref="ConsoleLogWriter"/>.</summary>
internal sealed class ConsoleLoggerProvider(ConsoleLogQueue queue) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new Logger(queue, categoryName, queue.Keeps(categoryName));
    public void Dispose() { }

    private sealed class Logger(ConsoleLogQueue queue, string category, bool kept) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => kept && logLevel != LogLevel.None && logLevel >= queue.MinimumFor(category);

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            Dictionary<string, string?>? properties = null;
            string? user = null;
            if (state is IReadOnlyList<KeyValuePair<string, object?>> values)
            {
                foreach (var (key, value) in values)
                {
                    if (key == "{OriginalFormat}") continue;
                    var text = value?.ToString();
                    (properties ??= new(StringComparer.Ordinal))[key] = text;
                    if (user is null && key is "UserId" or "User" or "Uid" or "Sub" && text is { Length: > 0 } && text != "(signed out)") user = text;
                }
            }
            string message;
            try { message = formatter(state, exception); }
            catch (FormatException) { message = state?.ToString() ?? ""; }
            queue.Add(new LogRecord(DateTimeOffset.UtcNow, logLevel, category, eventId.Id, message, exception?.ToString(), user, properties));
        }
    }
}
