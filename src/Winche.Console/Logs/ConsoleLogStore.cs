using System.Text.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace Winche.Console.Logs;

/// <summary>One kept log entry.</summary>
public sealed record ConsoleLogEntry(
    long Id, DateTimeOffset At, LogLevel Level, string Category, int EventId, string Message,
    string? Exception, string? UserId, string Instance, IReadOnlyDictionary<string, string?>? Properties);

/// <summary>A log entry on its way to the store.</summary>
internal sealed record LogRecord(
    DateTimeOffset At, LogLevel Level, string Category, int EventId, string Message, string? Exception,
    string? UserId, IReadOnlyDictionary<string, string?>? Properties);

/// <summary>Which entries a view shows.</summary>
public sealed record LogQuery
{
    /// <summary>A category prefix the view is limited to (the Database / Storage sub-tabs), or null for all.</summary>
    public string? Scope { get; init; }
    public LogLevel MinimumLevel { get; init; } = LogLevel.Trace;
    /// <summary>A category prefix chosen in the view (e.g. <c>SmartAirway.Reports</c>).</summary>
    public string? Category { get; init; }
    /// <summary>Text matched (case-insensitively) in the message, exception, user and structured values (error ids too).</summary>
    public string? Search { get; init; }
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }
    /// <summary>Older than this id (paging back).</summary>
    public long? Before { get; init; }
    /// <summary>Newer than this id (live updates; returned oldest first).</summary>
    public long? After { get; init; }
    public int Limit { get; init; } = 100;
}

/// <summary>The <c>console_logs</c> table (plain SQL: it's written on a hot path and created on first start).</summary>
internal sealed class ConsoleLogStore(string connectionString, LogsOptions options)
{
    private readonly NpgsqlDataSource _source = NpgsqlDataSource.Create(connectionString);

    public LogsOptions Options => options;

    public async Task EnsureCreatedAsync(CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("""
            CREATE TABLE IF NOT EXISTS console_logs (
              id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
              at timestamptz NOT NULL,
              level smallint NOT NULL,
              category text NOT NULL,
              event_id integer NOT NULL DEFAULT 0,
              message text NOT NULL,
              exception text NULL,
              user_id text NULL,
              instance text NOT NULL,
              properties jsonb NULL
            );
            CREATE INDEX IF NOT EXISTS console_logs_at ON console_logs (at DESC);
            CREATE INDEX IF NOT EXISTS console_logs_category ON console_logs (category text_pattern_ops, id DESC);
            """);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task InsertAsync(IReadOnlyList<LogRecord> batch, string instance, CancellationToken ct)
    {
        if (batch.Count == 0) return;
        await using var cmd = _source.CreateCommand("""
            INSERT INTO console_logs (at, level, category, event_id, message, exception, user_id, instance, properties)
            SELECT * FROM unnest(@at, @level, @category, @event, @message, @exception, @user, @instance, @properties)
            """);
        cmd.Parameters.Add(new NpgsqlParameter("at", NpgsqlDbType.Array | NpgsqlDbType.TimestampTz) { Value = batch.Select(r => r.At.UtcDateTime).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("level", NpgsqlDbType.Array | NpgsqlDbType.Smallint) { Value = batch.Select(r => (short)r.Level).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("category", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Category).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("event", NpgsqlDbType.Array | NpgsqlDbType.Integer) { Value = batch.Select(r => r.EventId).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("message", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => Clip(r.Message, 16_000)).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("exception", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Exception is null ? null : Clip(r.Exception, 64_000)).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("user", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.UserId).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("instance", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(_ => instance).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("properties", NpgsqlDbType.Array | NpgsqlDbType.Jsonb)
        {
            Value = batch.Select(r => r.Properties is { Count: > 0 } p ? JsonSerializer.Serialize(p) : null).ToArray(),
        });
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    /// <summary>Drops entries older than the retention, and the oldest beyond <see cref="LogsOptions.MaxEntries"/>.</summary>
    public async Task PruneAsync(CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("""
            DELETE FROM console_logs WHERE at < now() - @retention;
            DELETE FROM console_logs WHERE id <= (SELECT id FROM console_logs ORDER BY id DESC OFFSET @max LIMIT 1);
            """);
        cmd.Parameters.AddWithValue("retention", options.Retention);
        cmd.Parameters.AddWithValue("max", Math.Max(0, options.MaxEntries));
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<ConsoleLogEntry>> QueryAsync(LogQuery q, CancellationToken ct)
    {
        var where = new List<string> { "level >= @minLevel" };
        await using var cmd = _source.CreateCommand();
        cmd.Parameters.AddWithValue("minLevel", (short)q.MinimumLevel);
        if (q.Scope is { Length: > 0 })
        {
            where.Add("category LIKE @scope");
            cmd.Parameters.AddWithValue("scope", Like(q.Scope) + "%");
        }
        if (q.Category is { Length: > 0 })
        {
            where.Add("category LIKE @category");
            cmd.Parameters.AddWithValue("category", Like(q.Category) + "%");
        }
        if (q.Search is { Length: > 0 })
        {
            where.Add("(message ILIKE @search OR exception ILIKE @search OR user_id ILIKE @search OR properties::text ILIKE @search)");
            cmd.Parameters.AddWithValue("search", "%" + Like(q.Search) + "%");
        }
        if (q.From is { } from) { where.Add("at >= @from"); cmd.Parameters.AddWithValue("from", from.UtcDateTime); }
        if (q.To is { } to) { where.Add("at <= @to"); cmd.Parameters.AddWithValue("to", to.UtcDateTime); }
        if (q.Before is { } before) { where.Add("id < @before"); cmd.Parameters.AddWithValue("before", before); }
        if (q.After is { } after) { where.Add("id > @after"); cmd.Parameters.AddWithValue("after", after); }
        cmd.Parameters.AddWithValue("limit", Math.Clamp(q.Limit, 1, 500));
        cmd.CommandText = $"""
            SELECT id, at, level, category, event_id, message, exception, user_id, instance, properties::text
            FROM console_logs WHERE {string.Join(" AND ", where)}
            ORDER BY id {(q.After is null ? "DESC" : "ASC")} LIMIT @limit
            """;

        var list = new List<ConsoleLogEntry>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var props = reader.IsDBNull(9) ? null : JsonSerializer.Deserialize<Dictionary<string, string?>>(reader.GetString(9));
            list.Add(new ConsoleLogEntry(
                reader.GetInt64(0), new DateTimeOffset(reader.GetDateTime(1), TimeSpan.Zero), (LogLevel)reader.GetInt16(2),
                reader.GetString(3), reader.GetInt32(4), reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7), reader.GetString(8), props));
        }
        return list;
    }

    /// <summary>The categories with entries in a scope (most frequent first), for the view's filter.</summary>
    public async Task<IReadOnlyList<string>> CategoriesAsync(string? scope, CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand(scope is { Length: > 0 }
            ? "SELECT category FROM console_logs WHERE category LIKE @scope GROUP BY category ORDER BY count(*) DESC LIMIT 200"
            : "SELECT category FROM console_logs GROUP BY category ORDER BY count(*) DESC LIMIT 200");
        if (scope is { Length: > 0 }) cmd.Parameters.AddWithValue("scope", Like(scope) + "%");
        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(reader.GetString(0));
        return list;
    }

    private static string Like(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
