using System.Runtime.CompilerServices;
using Microsoft.Extensions.DependencyInjection;

namespace Winche.Console.Tabs;

/// <summary>A widget handler: given the request context, returns that widget's typed data.</summary>
public delegate Task<T> WidgetHandler<T>(WidgetContext ctx, CancellationToken ct);

public enum ChartKind { Line, Bar }

/// <summary>Non-generic marker so the manifest can read a chart's kind without knowing its provider type.</summary>
internal interface IChartNode { ChartKind ChartKind { get; } }

public delegate Task<object> WidgetInvoke(IServiceProvider services, WidgetContext ctx, CancellationToken ct);

/// <summary>
/// Base for a leaf widget. Positional so derived leaves set the shared members via the base constructor
/// (no `required`/`[SetsRequiredMembers]`), while `Flex` stays overridable through an object initializer.
/// </summary>
public abstract record WidgetNode(string Id, Type ProviderType, WidgetInvoke Invoke) : Node
{
    public abstract string Kind { get; }
    public int Flex { get; init; } = 1;
}

public sealed record StatRow<TData> : WidgetNode where TData : class
{
    public override string Kind => "statRow";
    public StatRow(Func<TData, WidgetHandler<StatRowData>> selector)
        : base(WidgetId.FromSelector(selector), typeof(TData),
               async (sp, ctx, ct) => await selector((TData)sp.GetRequiredService(typeof(TData)))(ctx, ct)) { }
}

internal interface IHasRowActions { IReadOnlyList<RowActionRef> RowActions { get; } }
internal interface IPaginatedTable { int? Paginate { get; } }

public sealed record Table<TData> : WidgetNode, IHasRowActions, IPaginatedTable where TData : class
{
    public override string Kind => "table";
    public int? Paginate { get; init; }
    public IReadOnlyList<RowActionRef> RowActions { get; init; } = Array.Empty<RowActionRef>();
    public Table(Func<TData, WidgetHandler<TableData>> selector)
        : base(WidgetId.FromSelector(selector), typeof(TData),
               async (sp, ctx, ct) => await selector((TData)sp.GetRequiredService(typeof(TData)))(ctx, ct)) { }
}

public sealed record Chart<TData> : WidgetNode, IChartNode where TData : class
{
    public override string Kind => "chart";
    public ChartKind ChartKind { get; }
    public Chart(Func<TData, WidgetHandler<ChartData>> selector, ChartKind kind)
        : base(WidgetId.FromSelector(selector), typeof(TData),
               async (sp, ctx, ct) => await selector((TData)sp.GetRequiredService(typeof(TData)))(ctx, ct))
        => ChartKind = kind;
}

/// <summary>Derives a widget id from the member the selector binds to. Works for a pure method-group
/// (`d => d.Kpis` -> "kpis") and for a property-bodied handler whose lambda name is the compiler-generated
/// "&lt;get_Kpis&gt;b__…" (also -> "kpis"); see <see cref="HandlerId"/>.</summary>
internal static class WidgetId
{
    public static string FromSelector<TData, TResult>(Func<TData, WidgetHandler<TResult>> selector) where TData : class
    {
        // The selector MUST be a pure method-group (`d => d.Method`): it forms a delegate off its argument
        // without reading instance state, so an uninitialized probe instance suffices to read the bound
        // method name. A selector that dereferences instance fields would NRE against the probe.
        var probe = (TData)RuntimeHelpers.GetUninitializedObject(typeof(TData));
        return HandlerId.Normalize(selector(probe).Method.Name);
    }
}
