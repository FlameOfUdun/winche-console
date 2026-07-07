namespace Winche.Console.Tabs;

/// <summary>
/// A filter node: renders a control and scopes its value to descendants. Reactive form keeps one child
/// subtree (widgets re-fetch on change); switch form materializes one branch per Select option.
/// </summary>
public sealed record Filter : Node
{
    public Control Control { get; }
    public bool IsSwitch { get; }
    public IReadOnlyList<Node>? Children { get; }
    public IReadOnlyDictionary<string, IReadOnlyList<Node>>? Branches { get; }

    /// <summary>Reactive: the same children always render; their handlers read the control's value.</summary>
    public Filter(Control control, IReadOnlyList<Node> children)
    {
        Control = control;
        Children = children;
        IsSwitch = false;
    }

    /// <summary>Switch: a branch per option (Select only). Branches are evaluated once per option now.</summary>
    public Filter(Select control, Func<string, IReadOnlyList<Node>> branches)
    {
        Control = control;
        IsSwitch = true;
        var map = new Dictionary<string, IReadOnlyList<Node>>(StringComparer.Ordinal);
        foreach (var option in control.Options)
            map[option] = branches(option);
        Branches = map;
    }
}
