using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Winche.Console.Api;

/// <summary>The console's own refusals, in the shared Winche error shape.</summary>
internal static class ConsoleErrors
{
    /// <summary>
    /// <c>invalid-argument</c> with <paramref name="reason"/> (e.g. <c>invalid-settings</c>) and, when there are any,
    /// each problem in <c>details.errors</c>.
    /// </summary>
    public static IResult Problem(string reason, string message, IReadOnlyList<string>? errors) =>
        new WincheError(WincheErrorCode.InvalidArgument, message, reason,
            errors is { Count: > 0 } ? new JsonObject { ["errors"] = new JsonArray([.. errors.Select(e => JsonValue.Create(e))]) } : null).ToResult();
}
