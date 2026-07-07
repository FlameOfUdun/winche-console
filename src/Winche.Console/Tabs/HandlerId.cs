using System.Text.RegularExpressions;

namespace Winche.Console.Tabs;

/// <summary>Derives a stable lower-case id from a bound handler's runtime method name. Handles both a real
/// method group (name is the method) and a property-bodied lambda (name is the compiler-generated
/// "&lt;get_Xxx&gt;b__n_m", from which we recover "Xxx").</summary>
internal static class HandlerId
{
    private static readonly Regex LambdaOwner = new(@"^<(?:get_|set_)?(?<name>[^>]+)>", RegexOptions.Compiled);

    public static string Normalize(string methodName)
    {
        var m = LambdaOwner.Match(methodName);
        var name = m.Success ? m.Groups["name"].Value : methodName;
        return name.ToLowerInvariant();
    }
}
