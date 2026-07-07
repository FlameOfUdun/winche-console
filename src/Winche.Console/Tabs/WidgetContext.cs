using System.Security.Claims;

namespace Winche.Console.Tabs;

/// <summary>The current console user as seen by a widget handler. Derived from the validated session.</summary>
public sealed record ConsoleTabUser(string Id, string? Email, ConsoleRole Role)
{
    public static ConsoleTabUser From(ClaimsPrincipal user, Winche.Console.Options.ConsoleOptions options) => new(
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub") ?? "",
        user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email"),
        ConsoleRolePolicy.Highest(user, options));
}

/// <summary>Everything a widget handler receives for one request. Inputs = filter + control values.</summary>
public sealed record WidgetContext(
    ConsoleTabUser User,
    IReadOnlyDictionary<string, string?> Inputs,
    IServiceProvider Services)
{
    /// <summary>1-based page for a paginated widget, from reserved key "page:{widgetId}". Clamped to >= 1.</summary>
    public (int Page, int Size) Page(string widgetId, int size)
    {
        var raw = Inputs.TryGetValue($"page:{widgetId}", out var v) ? v : null;
        var page = int.TryParse(raw, out var p) && p >= 1 ? p : 1;
        return (page, size);
    }
}

/// <summary>Optional marker for a tab's data-provider class. Not required — any class works.</summary>
public interface ITabData { }
