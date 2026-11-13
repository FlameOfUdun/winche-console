using System.Text.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace Winche.Console.Logs;

/// <summary>One kept log entry.</summary>
public sealed record ConsoleLogEntry(
    long Id, DateTimeOffset At, LogLevel Level, string Category, int EventId, string Message,
    string? Exception, string? UserId, string Instance, IReadOnlyDictionary<string, string?>? Properties,
    string Resource, string? Operation, string? Principal, string? Path, string? Outcome, long? LatencyMs);

/// <summary>What a saved query selects: resource, minimum level, field filters and search text.</summary>
public sealed record SavedQuerySpec(string? Resource, LogLevel MinimumLevel, IReadOnlyList<LogFieldFilter> Filters, string? Search);

/// <summary>A saved query; <see cref="CreatedBy"/> null for the built-in ones.</summary>
public sealed record SavedLogQuery(string Id, string Name, SavedQuerySpec Query, string? CreatedBy, DateTimeOffset? CreatedAt);

/// <summary>Levels saved in the console: by whom and when.</summary>
public sealed record SavedLevels(LogLevelSettings Settings, DateTimeOffset UpdatedAt, string? UpdatedBy);

/// <summary>A log entry on its way to the store.</summary>
internal sealed record LogRecord(
    DateTimeOffset At, LogLevel Level, string Category, int EventId, string Message, string? Exception,
    string? UserId, IReadOnlyDictionary<string, string?>? Properties)
{
    /// <summary>database, storage, console or app — from the category.</summary>
    public string Resource => ConsoleLogStore.ResourceOf(Category);
    public string? Operation => Properties?.GetValueOrDefault("Operation");
    public string? Path => Properties?.GetValueOrDefault("Path");
    public string? Principal => Properties?.GetValueOrDefault("Principal") ?? UserId;
    public string? Outcome => Properties?.GetValueOrDefault("Outcome");
    public long? LatencyMs => long.TryParse(Properties?.GetValueOrDefault("LatencyMs"), out var ms) ? ms : null;
}

/// <summary>One field filter: <c>principal = u2</c>, or with <see cref="Not"/> <c>outcome ≠ ok</c>.</summary>
public sealed record LogFieldFilter(string Field, string Value, bool Not = false);

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
    /// <summary>database, storage, console or app.</summary>
    public string? Resource { get; init; }
    /// <summary>Field filters, all of which must hold (fields: <see cref="ConsoleLogStore.FilterFields"/>).</summary>
    public IReadOnlyList<LogFieldFilter> Filters { get; init; } = [];
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }
    /// <summary>Older than this id (paging back).</summary>
    public long? Before { get; init; }
    /// <summary>Newer than this id (live updates; returned oldest first).</summary>
    public long? After { get; init; }
    public int Limit { get; init; } = 100;
}

/// <summary>The <c>console_logs</c> table (plain SQL: it's written on a hot path and created on first start).</summary>
internal sealed class ConsoleLogStore(string connectionString, LogsOptions options) : IAsyncDisposable
{
    private readonly NpgsqlDataSource _source = NpgsqlDataSource.Create(connectionString);

    /// <summary>Closes its connections when the app stops.</summary>
    public ValueTask DisposeAsync() => _source.DisposeAsync();

    public LogsOptions Options => options;

    /// <summary>The log table, in the order its parts were introduced (Winche.Core's WincheSchema).</summary>
    internal static readonly string[] Steps =
    [
        """
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
            ALTER TABLE console_logs
              ADD COLUMN IF NOT EXISTS resource text NOT NULL DEFAULT 'app',
              ADD COLUMN IF NOT EXISTS operation text NULL,
              ADD COLUMN IF NOT EXISTS principal text NULL,
              ADD COLUMN IF NOT EXISTS path text NULL,
              ADD COLUMN IF NOT EXISTS outcome text NULL,
              ADD COLUMN IF NOT EXISTS latency_ms bigint NULL;
            CREATE INDEX IF NOT EXISTS console_logs_resource ON console_logs (resource, id DESC);
            CREATE INDEX IF NOT EXISTS console_logs_principal ON console_logs (principal, id DESC);
            CREATE TABLE IF NOT EXISTS console_log_queries (
              id uuid PRIMARY KEY,
              name text NOT NULL,
              query jsonb NOT NULL,
              created_by text NULL,
              created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS console_logs_at ON console_logs (at DESC);
            CREATE INDEX IF NOT EXISTS console_logs_category ON console_logs (category text_pattern_ops, id DESC);
            CREATE TABLE IF NOT EXISTS console_log_settings (
              id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
              settings jsonb NOT NULL,
              updated_at timestamptz NOT NULL,
              updated_by text NULL
            );
        """,
    ];

    public async Task EnsureCreatedAsync(CancellationToken ct)
    {
        await Winche.Core.WincheSchema.EnsureAsync(_source, "console-logs", Steps, ct);
    }

    public async Task InsertAsync(IReadOnlyList<LogRecord> batch, string instance, CancellationToken ct)
    {
        if (batch.Count == 0) return;
        await using var cmd = _source.CreateCommand("""
            INSERT INTO console_logs (at, level, category, event_id, message, exception, user_id, instance, properties,
                                      resource, operation, principal, path, outcome, latency_ms)
            SELECT * FROM unnest(@at, @level, @category, @event, @message, @exception, @user, @instance, @properties,
                                 @resource, @operation, @principal, @path, @outcome, @latency)
            """);
        cmd.Parameters.Add(new NpgsqlParameter("resource", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Resource).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("operation", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Operation).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("principal", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Principal).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("path", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Path).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("outcome", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = batch.Select(r => r.Outcome).ToArray() });
        cmd.Parameters.Add(new NpgsqlParameter("latency", NpgsqlDbType.Array | NpgsqlDbType.Bigint) { Value = batch.Select(r => r.LatencyMs).ToArray() });
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

    /// <summary>Levels saved in the console, or null (the code's apply).</summary>
    public async Task<SavedLevels?> GetLevelsAsync(CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("SELECT settings::text, updated_at, updated_by FROM console_log_settings WHERE id = 1");
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        var settings = JsonSerializer.Deserialize<LogLevelSettings>(reader.GetString(0), LevelJson)!;
        return new SavedLevels(settings, new DateTimeOffset(reader.GetDateTime(1), TimeSpan.Zero), reader.IsDBNull(2) ? null : reader.GetString(2));
    }

    public async Task<SavedLevels> SaveLevelsAsync(LogLevelSettings settings, string? by, CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("""
            INSERT INTO console_log_settings (id, settings, updated_at, updated_by) VALUES (1, @settings::jsonb, now(), @by)
            ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
            RETURNING updated_at
            """);
        cmd.Parameters.AddWithValue("settings", JsonSerializer.Serialize(settings, LevelJson));
        cmd.Parameters.AddWithValue("by", (object?)by ?? DBNull.Value);
        var at = (DateTime)(await cmd.ExecuteScalarAsync(ct))!;
        return new SavedLevels(settings, new DateTimeOffset(at, TimeSpan.Zero), by);
    }

    public async Task ResetLevelsAsync(CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("DELETE FROM console_log_settings WHERE id = 1");
        await cmd.ExecuteNonQueryAsync(ct);
    }

    internal static readonly JsonSerializerOptions LevelJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

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

    /// <summary>The fields a filter can name, and their columns.</summary>
    public static readonly IReadOnlyDictionary<string, string> FilterFields = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["resource"] = "resource", ["operation"] = "operation", ["principal"] = "principal", ["path"] = "path",
        ["outcome"] = "outcome", ["category"] = "category", ["instance"] = "instance", ["user"] = "user_id",
    };

    public static string ResourceOf(string category) =>
        category.StartsWith("Winche.Database", StringComparison.Ordinal) ? "database"
        : category.StartsWith("Winche.Storage", StringComparison.Ordinal) ? "storage"
        : category.StartsWith("Winche.Console", StringComparison.Ordinal) ? "console"
        : category.StartsWith("Winche.Auth", StringComparison.Ordinal) ? "auth"
        : category.StartsWith("Winche.Functions", StringComparison.Ordinal) ? "functions"
        : "app";

    /// <summary>The WHERE clause for <paramref name="q"/> (paging excluded), adding its parameters to <paramref name="cmd"/>.</summary>
    private static List<string> Where(LogQuery q, NpgsqlCommand cmd)
    {
        var where = new List<string> { "level >= @minLevel" };
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
        if (q.Resource is { Length: > 0 })
        {
            where.Add("resource = @resource");
            cmd.Parameters.AddWithValue("resource", q.Resource);
        }
        for (var i = 0; i < q.Filters.Count; i++)
        {
            var f = q.Filters[i];
            if (!FilterFields.TryGetValue(f.Field, out var column)) throw new ArgumentException($"Unknown field '{f.Field}'.");
            where.Add(f.Not ? $"{column} IS DISTINCT FROM @f{i}" : $"{column} = @f{i}");
            cmd.Parameters.AddWithValue($"f{i}", f.Value);
        }
        if (q.From is { } from) { where.Add("at >= @from"); cmd.Parameters.AddWithValue("from", from.UtcDateTime); }
        if (q.To is { } to) { where.Add("at <= @to"); cmd.Parameters.AddWithValue("to", to.UtcDateTime); }
        return where;
    }

    public async Task<IReadOnlyList<ConsoleLogEntry>> QueryAsync(LogQuery q, CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand();
        var where = Where(q, cmd);
        if (q.Before is { } before) { where.Add("id < @before"); cmd.Parameters.AddWithValue("before", before); }
        if (q.After is { } after) { where.Add("id > @after"); cmd.Parameters.AddWithValue("after", after); }
        cmd.Parameters.AddWithValue("limit", Math.Clamp(q.Limit, 1, 500));
        cmd.CommandText = $"""
            SELECT id, at, level, category, event_id, message, exception, user_id, instance, properties::text,
                   resource, operation, principal, path, outcome, latency_ms
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
                reader.IsDBNull(7) ? null : reader.GetString(7), reader.GetString(8), props,
                reader.GetString(10), reader.IsDBNull(11) ? null : reader.GetString(11), reader.IsDBNull(12) ? null : reader.GetString(12),
                reader.IsDBNull(13) ? null : reader.GetString(13), reader.IsDBNull(14) ? null : reader.GetString(14),
                reader.IsDBNull(15) ? null : reader.GetInt64(15)));
        }
        return list;
    }

    /// <summary>Entries per time bucket between <c>From</c> and <c>To</c>: info (and below), warning, error (and up).</summary>
    public async Task<IReadOnlyList<(DateTimeOffset Start, long Info, long Warning, long Error)>> HistogramAsync(
        LogQuery q, int buckets, CancellationToken ct)
    {
        var from = q.From ?? DateTimeOffset.UtcNow.AddDays(-1);
        var to = q.To ?? DateTimeOffset.UtcNow;
        var size = (to - from) / buckets;
        await using var cmd = _source.CreateCommand();
        var where = Where(q with { From = from, To = to }, cmd);
        cmd.Parameters.AddWithValue("start", from.UtcDateTime);
        cmd.Parameters.AddWithValue("size", size.TotalSeconds);
        cmd.Parameters.AddWithValue("buckets", buckets);
        cmd.CommandText = $"""
            SELECT LEAST(floor(extract(epoch FROM at - @start) / @size)::int, @buckets - 1) AS b,
                   count(*) FILTER (WHERE level <= 2), count(*) FILTER (WHERE level = 3), count(*) FILTER (WHERE level >= 4)
            FROM console_logs WHERE {string.Join(" AND ", where)}
            GROUP BY b
            """;
        var counts = new (long, long, long)[buckets];
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct))
            {
                var b = reader.GetInt32(0);
                if (b >= 0 && b < buckets) counts[b] = (reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3));
            }
        return [.. counts.Select((c, i) => (from + size * i, c.Item1, c.Item2, c.Item3))];
    }

    public async Task<long> CountAsync(LogQuery q, CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand();
        var where = Where(q, cmd);
        cmd.CommandText = $"SELECT count(*) FROM console_logs WHERE {string.Join(" AND ", where)}";
        return (long)(await cmd.ExecuteScalarAsync(ct))!;
    }

    // ── saved queries ───────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<SavedLogQuery>> SavedQueriesAsync(CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("SELECT id, name, query::text, created_by, created_at FROM console_log_queries ORDER BY created_at");
        var list = new List<SavedLogQuery>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            list.Add(new SavedLogQuery(reader.GetGuid(0).ToString(), reader.GetString(1),
                JsonSerializer.Deserialize<SavedQuerySpec>(reader.GetString(2), LevelJson)!, reader.IsDBNull(3) ? null : reader.GetString(3),
                new DateTimeOffset(reader.GetDateTime(4), TimeSpan.Zero)));
        return list;
    }

    public async Task<SavedLogQuery> SaveQueryAsync(string name, SavedQuerySpec spec, string? by, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        await using var cmd = _source.CreateCommand(
            "INSERT INTO console_log_queries (id, name, query, created_by) VALUES (@id, @name, @query::jsonb, @by) RETURNING created_at");
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("query", JsonSerializer.Serialize(spec, LevelJson));
        cmd.Parameters.AddWithValue("by", (object?)by ?? DBNull.Value);
        var at = (DateTime)(await cmd.ExecuteScalarAsync(ct))!;
        return new SavedLogQuery(id.ToString(), name, spec, by, new DateTimeOffset(at, TimeSpan.Zero));
    }

    public async Task<bool> DeleteQueryAsync(Guid id, CancellationToken ct)
    {
        await using var cmd = _source.CreateCommand("DELETE FROM console_log_queries WHERE id = @id");
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
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
