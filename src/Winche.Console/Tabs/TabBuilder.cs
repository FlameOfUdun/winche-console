using System.Text.RegularExpressions;

namespace Winche.Console.Tabs;

/// <summary>Per-command configuration passed to <see cref="TabBuilder.Command{TProvider}"/>.</summary>
public sealed class TabCommandConfig
{
    public string Label { get; set; } = "";
    public ConsoleRole MinRole { get; set; } = ConsoleRole.Viewer;
    public string? Confirm { get; set; }
}

/// <summary>Fluent configuration for one custom tab; produces a validated <see cref="TabDefinition"/>.</summary>
public sealed class TabBuilder
{
    private static readonly Regex IdPattern = new("^[a-z][a-z0-9-]*$", RegexOptions.Compiled);
    private static readonly HashSet<string> SupportedIcons = new(StringComparer.Ordinal)
    {
        "layout-dashboard", "chart-bar", "report-analytics", "table",
    };

    // Route slugs the console's own SPA already owns at the top level. A custom tab id becomes a top-level
    // route (/{id}), so one of these would be silently shadowed by React Router's static-over-dynamic ranking;
    // reject it loudly at registration instead. (Built-in tabs: database/storage/access; public auth pages.)
    private static readonly HashSet<string> ReservedIds = new(StringComparer.Ordinal)
    {
        "database", "storage", "access", "forgot-password", "reset-password", "invite", "auth",
    };

    private Node? _root;
    private readonly List<CommandDefinition> _commands = new();

    public string Icon { get; set; } = "layout-dashboard";
    public ConsoleRole MinRole { get; set; } = ConsoleRole.Viewer;

    public void Layout(Node root) => _root = root;

    public CommandRef Command<TProvider, TInput>(
        Func<TProvider, CommandHandler<TInput>> selector, Action<TabCommandConfig> configure) where TProvider : class
    {
        var cfg = new TabCommandConfig();
        configure(cfg);
        if (string.IsNullOrWhiteSpace(cfg.Label)) throw new InvalidOperationException("A command needs a Label.");
        var def = CommandDefinition.Create(selector, cfg.Label, cfg.MinRole, cfg.Confirm);
        _commands.Add(def);
        return new CommandRef(def.Id, def.Label, def.MinRole, def.RowScoped);
    }

    public CommandRef Command<TProvider>(
        Func<TProvider, CommandHandler> selector, Action<TabCommandConfig> configure) where TProvider : class
    {
        var cfg = new TabCommandConfig();
        configure(cfg);
        if (string.IsNullOrWhiteSpace(cfg.Label)) throw new InvalidOperationException("A command needs a Label.");
        var def = CommandDefinition.Create(selector, cfg.Label, cfg.MinRole, cfg.Confirm);
        _commands.Add(def);
        return new CommandRef(def.Id, def.Label, def.MinRole, def.RowScoped);
    }

    internal TabDefinition Build(string id, string label)
    {
        if (!IdPattern.IsMatch(id))
            throw new InvalidOperationException($"Tab id '{id}' must be lower-case letters, digits and hyphens, starting with a letter.");
        if (ReservedIds.Contains(id))
            throw new InvalidOperationException($"Tab id '{id}' is reserved by a built-in console tab or route; choose another id.");
        if (!SupportedIcons.Contains(Icon))
            throw new InvalidOperationException($"Tab '{id}' icon '{Icon}' is not supported. Supported: {string.Join(", ", SupportedIcons)}.");
        if (_root is null)
            throw new InvalidOperationException($"Tab '{id}' has no layout; call Layout(...).");

        var widgets = LayoutWalk.Widgets(_root).ToList();
        var embeds = LayoutWalk.Embeds(_root).ToList();
        if (widgets.Count == 0 && embeds.Count == 0)
            throw new InvalidOperationException($"Tab '{id}' has no widgets or embeds.");

        foreach (var w in widgets)
        {
            if (!IdPattern.IsMatch(w.Id))
                throw new InvalidOperationException($"Widget id '{w.Id}' on tab '{id}' is invalid.");
            if (w.Flex <= 0)
                throw new InvalidOperationException($"Widget '{w.Id}' on tab '{id}' has Flex <= 0.");
        }

        foreach (var e in embeds)
        {
            if (!IdPattern.IsMatch(e.Id))
                throw new InvalidOperationException($"Embed id '{e.Id}' on tab '{id}' is invalid.");
            if (e.Flex <= 0)
                throw new InvalidOperationException($"Embed '{e.Id}' on tab '{id}' has Flex <= 0.");
            if (e.MinHeight <= 0)
                throw new InvalidOperationException($"Embed '{e.Id}' on tab '{id}' has MinHeight <= 0.");
            if (!IsSameOriginRoute(e.Route))
                throw new InvalidOperationException(
                    $"Embed '{e.Id}' on tab '{id}' route '{e.Route}' must be a root-relative same-origin path (start with a single '/').");
        }

        var dupId = widgets.Select(w => w.Id).Concat(embeds.Select(e => e.Id))
            .GroupBy(x => x).FirstOrDefault(g => g.Count() > 1);
        if (dupId is not null)
            throw new InvalidOperationException($"Tab '{id}' has duplicate widget/embed id '{dupId.Key}'.");

        ValidateControlIds(_root, id);

        var dupCmd = _commands.GroupBy(c => c.Id).FirstOrDefault(g => g.Count() > 1);
        if (dupCmd is not null)
            throw new InvalidOperationException($"Tab '{id}' has duplicate command id '{dupCmd.Key}'.");

        var registered = _commands.Select(c => c.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var reference in LayoutWalk.CommandRefs(_root))
            if (!registered.Contains(reference.Id))
                throw new InvalidOperationException($"Tab '{id}' references command '{reference.Id}' that was not registered with Command(...).");

        foreach (var cmd in _commands)
            if (cmd.MinRole < MinRole)
                throw new InvalidOperationException(
                    $"Command '{cmd.Id}' MinRole ({cmd.MinRole}) is below tab '{id}' MinRole ({MinRole}); a command may raise the floor, never lower it.");

        var providerTypes = LayoutWalk.ProviderTypes(_root)
            .Concat(_commands.Select(c => c.ProviderType))
            .Distinct().ToList();

        return new TabDefinition(id, label, Icon, MinRole, _root, providerTypes, _commands);
    }

    // A same-origin island route is a single-slash root-relative path: starts with '/', but not '//' (which is
    // protocol-relative / cross-origin). This also rejects absolute "http(s):" URLs, which never start with '/'.
    // Backslashes are rejected outright: browsers fold '\' to '/' for http(s), so "/\evil.com" would resolve to
    // the cross-origin https://evil.com — the one form a naive "starts with a single /" check would let through.
    private static bool IsSameOriginRoute(string route) =>
        route.Length >= 2 && route[0] == '/' && route[1] != '/' && !route.Contains('\\');

    // Distinct control ids reachable in `node`. Reactive filters + containers put all descendants on one
    // visible path (their ids must be unique together). A switch's branches are alternatives, so ids may
    // repeat ACROSS branches — but each branch is validated internally and against the switch's own control.
    private static IReadOnlySet<string> ValidateControlIds(Node node, string tabId)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        void Merge(IReadOnlySet<string> more)
        {
            foreach (var id in more)
                if (!ids.Add(id))
                    throw new InvalidOperationException($"Tab '{tabId}' has two controls with id '{id}' that can be visible at once.");
        }

        switch (node)
        {
            case Filter { IsSwitch: false } f:
                Merge(new HashSet<string>(StringComparer.Ordinal) { f.Control.Id });
                foreach (var child in f.Children!) Merge(ValidateControlIds(child, tabId));
                break;
            case Filter { IsSwitch: true } f:
                Merge(new HashSet<string>(StringComparer.Ordinal) { f.Control.Id });
                // Branches are alternatives: union their ids (dedup across branches allowed), but each branch
                // is internally validated and must not reuse the switch's own control id.
                var union = new HashSet<string>(StringComparer.Ordinal);
                foreach (var branch in f.Branches!.Values)
                {
                    var branchIds = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var child in branch)
                        foreach (var id in ValidateControlIds(child, tabId))
                            if (!branchIds.Add(id))
                                throw new InvalidOperationException($"Tab '{tabId}' has two controls with id '{id}' that can be visible at once.");
                    if (branchIds.Contains(f.Control.Id))
                        throw new InvalidOperationException($"Tab '{tabId}' switch branch reuses its own control id '{f.Control.Id}'.");
                    union.UnionWith(branchIds);
                }
                Merge(union);
                break;
            case Column c: foreach (var child in c.Children) Merge(ValidateControlIds(child, tabId)); break;
            case Row r: foreach (var child in r.Children) Merge(ValidateControlIds(child, tabId)); break;
            case Section s: foreach (var child in s.Children) Merge(ValidateControlIds(child, tabId)); break;
        }
        return ids;
    }
}
