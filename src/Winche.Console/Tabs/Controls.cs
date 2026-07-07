namespace Winche.Console.Tabs;

/// <summary>A filter-bar control. Keys are the query keys its value(s) occupy in WidgetContext.Filters.</summary>
public abstract record Control
{
    public abstract string Kind { get; }
    public abstract string Id { get; }
    public abstract IReadOnlyList<string> Keys { get; }
}

public sealed record Select : Control
{
    public override string Id { get; }
    public IReadOnlyList<string> Options { get; }
    public Select(string id, IReadOnlyList<string> options) { Id = id; Options = options; }
    public override string Kind => "select";
    public override IReadOnlyList<string> Keys => new[] { Id };
}

public sealed record DateRange : Control
{
    public override string Id { get; }
    public DateRange(string id) => Id = id;
    public override string Kind => "dateRange";
    public override IReadOnlyList<string> Keys => new[] { $"{Id}From", $"{Id}To" };
}
