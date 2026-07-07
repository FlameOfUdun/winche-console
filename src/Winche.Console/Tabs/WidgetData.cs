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

public sealed record TableData(IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyList<object?>> Rows)
{
    /// <summary>Typed table builder — columns are projections over the row type, so rows are never loose object[].</summary>
    public static TableBuilder<T> From<T>(IEnumerable<T> rows) => new(rows);
}

public sealed class TableBuilder<T>
{
    private readonly IReadOnlyList<T> _rows;
    private readonly List<string> _headers = new();
    private readonly List<Func<T, object?>> _selectors = new();

    internal TableBuilder(IEnumerable<T> rows) => _rows = rows.ToList();

    public TableBuilder<T> Column(string header, Func<T, object?> value)
    {
        _headers.Add(header);
        _selectors.Add(value);
        return this;
    }

    public TableData Build() => new(
        _headers,
        _rows.Select(r => (IReadOnlyList<object?>)_selectors.Select(sel => sel(r)).ToList()).ToList());

    public static implicit operator TableData(TableBuilder<T> b) => b.Build();
}
