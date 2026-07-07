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

/// <summary>When a control's value is committed to the filter set: reactively on change, or manually on apply.</summary>
public enum Apply { Reactive, Manual }

/// <summary>A free-text filter control. When <see cref="Apply"/> is Manual the input renders an inline submit
/// button (labelled <see cref="SubmitLabel"/>) beside it, since a buffered value needs an explicit apply.</summary>
public sealed record TextInput : Control
{
    public override string Id { get; }
    public Apply Apply { get; init; } = Apply.Manual;
    public string? Placeholder { get; init; }
    /// <summary>Label of the inline submit button shown for a Manual input. Ignored when Reactive.</summary>
    public string SubmitLabel { get; init; } = "Search";
    public TextInput(string id) => Id = id;
    public override string Kind => "text";
    public override IReadOnlyList<string> Keys => new[] { Id };
}
