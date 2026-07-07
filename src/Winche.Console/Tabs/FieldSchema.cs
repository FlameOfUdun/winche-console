using System.ComponentModel.DataAnnotations;
using System.Reflection;

namespace Winche.Console.Tabs;

public enum FieldKind { Text, Textarea, Number, Boolean, Select, Date }

public sealed record FieldSchema
{
    public required string Key { get; init; }
    public required FieldKind Kind { get; init; }
    public required string Label { get; init; }
    public bool Required { get; init; }
    public object? Default { get; init; }
    public IReadOnlyList<string>? Options { get; init; }
    public double? Min { get; init; }
    public double? Max { get; init; }
    public string? Pattern { get; init; }
    public string? Placeholder { get; init; }

    /// <summary>Ordered fields for an input type, read from its primary-constructor parameters.</summary>
    public static IReadOnlyList<FieldSchema> For(Type inputType)
    {
        var ctor = inputType.GetConstructors().OrderByDescending(c => c.GetParameters().Length).First();
        return ctor.GetParameters().Select(p => FromParameter(p, inputType)).ToList();
    }

    private static FieldSchema FromParameter(ParameterInfo p, Type inputType)
    {
        var name = p.Name ?? "field";
        // Record primary-constructor `[property: ...]` attributes land on the generated
        // property, not the parameter; prefer the property, fall back to the parameter.
        var prop = p.Name is null ? null : inputType.GetProperty(p.Name);
        T? Attr<T>() where T : Attribute =>
            prop?.GetCustomAttribute<T>() ?? p.GetCustomAttribute<T>();

        var t = Nullable.GetUnderlyingType(p.ParameterType) ?? p.ParameterType;
        var display = Attr<DisplayAttribute>();
        var required = Attr<RequiredAttribute>() is not null;
        var pattern = Attr<RegularExpressionAttribute>()?.Pattern;
        var range = Attr<RangeAttribute>();
        var strLen = Attr<StringLengthAttribute>();
        var multiline = Attr<DataTypeAttribute>()?.DataType == DataType.MultilineText;

        var (kind, options) = Classify(t, multiline);
        return new FieldSchema
        {
            Key = name.ToLowerInvariant(),
            Kind = kind,
            Label = display?.Name ?? name,
            Required = required,
            Default = p.HasDefaultValue ? p.DefaultValue : null,
            Options = options,
            Min = range is not null ? ToDouble(range.Minimum) : strLen?.MinimumLength,
            Max = range is not null ? ToDouble(range.Maximum) : strLen?.MaximumLength,
            Pattern = pattern,
        };
    }

    private static (FieldKind, IReadOnlyList<string>?) Classify(Type t, bool multiline)
    {
        if (t.IsEnum) return (FieldKind.Select, Enum.GetNames(t));
        if (t == typeof(bool)) return (FieldKind.Boolean, null);
        if (t == typeof(int) || t == typeof(long) || t == typeof(double) || t == typeof(decimal) || t == typeof(float))
            return (FieldKind.Number, null);
        if (t == typeof(DateOnly) || t == typeof(DateTime) || t == typeof(DateTimeOffset))
            return (FieldKind.Date, null);
        return (multiline ? FieldKind.Textarea : FieldKind.Text, null);
    }

    private static double? ToDouble(object? o) => o is null ? null
        : double.TryParse(o.ToString(), out var d) ? d : null;
}
