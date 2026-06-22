using System.Diagnostics.CodeAnalysis;
using System.Text;

namespace Winche.Console.Api;

internal static class ConsolePathEncoding
{
    /// <summary>Decodes a standard-base64 UTF-8 path segment (matches the SPA's b64Path encoding).</summary>
    public static string Decode(string base64) => Encoding.UTF8.GetString(Convert.FromBase64String(base64));

    /// <summary>Decodes a standard-base64 UTF-8 path segment; returns false on malformed input.</summary>
    public static bool TryDecode(string base64, [NotNullWhen(true)] out string? path)
    {
        try { path = Decode(base64); return true; }
        catch (FormatException) { path = null; return false; }
    }
}
