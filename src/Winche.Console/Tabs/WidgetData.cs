namespace Winche.Console.Tabs;

public enum Trend { Neutral, Up, Down }

public sealed record Stat(string Label, object Value, string? Delta = null, Trend Trend = Trend.Neutral);

public sealed record StatRowData(IReadOnlyList<Stat> Stats)
{
    public StatRowData(params Stat[] stats) : this((IReadOnlyList<Stat>)stats) { }
}

public sealed record Point(object X, double Y);
public sealed record Series(string Name, IReadOnlyList<Point> Points)
{
    public Series(string name, params Point[] points) : this(name, (IReadOnlyList<Point>)points) { }
}
public sealed record ChartData(IReadOnlyList<Series> Series)
{
    public ChartData(params Series[] series) : this((IReadOnlyList<Series>)series) { }
}

public sealed record TableRow(string Key, IReadOnlyList<object?> Cells);

public sealed record TableData
{
    public IReadOnlyList<string> Columns { get; init; }
    public int Total { get; init; }
    public IReadOnlyList<TableRow> Rows { get; init; }

    public TableData(IReadOnlyList<string> columns, int total, IReadOnlyList<TableRow> rows)
    {
        Columns = columns;
        Total = total;
        Rows = rows;
    }

    /// <summary>Typed table builder — columns are projections over the row type, so rows are never loose object[].</summary>
    public static TableBuilder<T> From<T>(IEnumerable<T> rows) => new(rows);

    /// <summary>Convenience for loose rows: total = row count, keys from an index.</summary>
    public static TableData Of(IReadOnlyList<string> columns, IReadOnlyList<IReadOnlyList<object?>> rows) =>
        new(columns, rows.Count, rows.Select((r, i) => new TableRow(i.ToString(), r)).ToList());
}

public sealed class TableBuilder<T>
{
    private readonly IReadOnlyList<T> _rows;
    private readonly List<string> _headers = new();
    private readonly List<Func<T, object?>> _selectors = new();
    private Func<T, object?>? _key;
    private int? _total;

    internal TableBuilder(IEnumerable<T> rows) => _rows = rows.ToList();

    /// <summary>Stable per-row key (e.g. a document path) that row actions target. Defaults to the row index.</summary>
    public TableBuilder<T> Key(Func<T, object?> key) { _key = key; return this; }

    /// <summary>Total row count across ALL pages (for a paginated table). Defaults to the number of rows given.</summary>
    public TableBuilder<T> Total(int total) { _total = total; return this; }

    public TableBuilder<T> Column(string header, Func<T, object?> value)
    {
        _headers.Add(header);
        _selectors.Add(value);
        return this;
    }

    public TableData Build() => new(
        _headers,
        _total ?? _rows.Count,
        _rows.Select((r, i) => new TableRow(
            _key?.Invoke(r)?.ToString() ?? i.ToString(),
            _selectors.Select(sel => sel(r)).ToList())).ToList());

    public static implicit operator TableData(TableBuilder<T> b) => b.Build();
}
