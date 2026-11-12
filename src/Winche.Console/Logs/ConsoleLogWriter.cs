using Microsoft.Extensions.Hosting;

namespace Winche.Console.Logs;

/// <summary>
/// Writes queued log entries to <c>console_logs</c> in batches, and prunes old ones hourly. A failed write drops
/// that batch rather than logging about it (which would queue more entries to fail).
/// </summary>
internal sealed class ConsoleLogWriter(ConsoleLogQueue queue, ConsoleLogStore store, TimeProvider time) : BackgroundService
{
    private static readonly string Instance = $"{Environment.MachineName}:{Environment.ProcessId}";
    private DateTimeOffset _nextPrune;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await store.EnsureCreatedAsync(stoppingToken);
                break;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await Task.Delay(TimeSpan.FromSeconds(10), time, stoppingToken);   // the database isn't up yet
            }
        }

        var batch = new List<LogRecord>(500);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(store.Options.FlushInterval, time, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            await FlushAsync(batch, CancellationToken.None);
            if (time.GetUtcNow() >= _nextPrune)
            {
                _nextPrune = time.GetUtcNow().AddHours(1);
                try { await store.PruneAsync(stoppingToken); } catch (Exception ex) when (ex is not OperationCanceledException) { }
            }
        }
        await FlushAsync(batch, CancellationToken.None);   // what was logged while stopping
    }

    private async Task FlushAsync(List<LogRecord> batch, CancellationToken ct)
    {
        while (queue.Reader.TryRead(out var record))
        {
            batch.Add(record);
            if (batch.Count < 500) continue;
            await WriteAsync(batch, ct);
        }
        await WriteAsync(batch, ct);
    }

    private async Task WriteAsync(List<LogRecord> batch, CancellationToken ct)
    {
        if (batch.Count == 0) return;
        try
        {
            await store.InsertAsync(batch, Instance, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Dropped: the log store is unreachable. Logging this would only queue more entries to fail.
        }
        batch.Clear();
    }
}
