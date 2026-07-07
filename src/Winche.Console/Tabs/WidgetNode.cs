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

public sealed record Table<TData> : WidgetNode where TData : class
{
    public override string Kind => "table";
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

/// <summary>Derives a widget id from the method the selector binds to (e.g. d => d.Kpis  ->  "kpis").</summary>
internal static class WidgetId
{
    public static string FromSelector<TData, TResult>(Func<TData, WidgetHandler<TResult>> selector) where TData : class
    {
        // The selector MUST be a pure method-group (`d => d.Method`): it forms a delegate off its argument
        // without reading instance state, so an uninitialized probe instance suffices to read the bound
        // method name. A selector that dereferences instance fields would NRE against the probe.
        var probe = (TData)RuntimeHelpers.GetUninitializedObject(typeof(TData));
        var name = selector(probe).Method.Name;
        return name.ToLowerInvariant();
    }
}
