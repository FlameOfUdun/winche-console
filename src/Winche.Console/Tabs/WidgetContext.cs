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

/// <summary>Everything a widget handler receives for one request.</summary>
public sealed record WidgetContext(
    ConsoleTabUser User,
    IReadOnlyDictionary<string, string?> Filters,
    IServiceProvider Services);

/// <summary>Optional marker for a tab's data-provider class. Not required — any class works.</summary>
public interface ITabData { }
