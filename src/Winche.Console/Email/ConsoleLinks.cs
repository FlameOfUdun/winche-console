using Microsoft.AspNetCore.Http;

namespace Winche.Console.Email;

/// <summary>Holds the console's mount prefix (set in MapWincheConsole) for building absolute links.</summary>
internal sealed class ConsolePrefix
{
    public string Value { get; set; } = "/_console";
}

internal static class ConsoleLinks
{
    /// <summary>Builds an absolute reset/invite link to the SPA's reset-password page from the current request.</summary>
    public static string ResetPasswordLink(HttpContext http, string prefix, string email, string token) =>
        $"{http.Request.Scheme}://{http.Request.Host}{prefix}/reset-password" +
        $"?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

    /// <summary>Builds an absolute invite link to the SPA's invite-acceptance page from the current request.</summary>
    public static string InviteLink(HttpContext http, string prefix, string token) =>
        $"{http.Request.Scheme}://{http.Request.Host}{prefix}/invite" +
        $"?token={Uri.EscapeDataString(token)}";
}
