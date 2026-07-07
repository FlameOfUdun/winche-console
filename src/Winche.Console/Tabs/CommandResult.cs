namespace Winche.Console.Tabs;

public enum CommandStatus { Ok, Invalid, Error }
public enum RefetchScope { Tab, None }

/// <summary>Outcome of a command handler. Business outcomes travel in the body (not HTTP status).</summary>
public sealed record CommandResult
{
    public CommandStatus Status { get; private init; }
    public string? Message { get; private init; }
    public IReadOnlyDictionary<string, string> FieldErrors { get; private init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);
    public RefetchScope Refetch { get; private init; } = RefetchScope.Tab;

    public static CommandResult Ok(string? message = null) =>
        new() { Status = CommandStatus.Ok, Message = message };

    public static CommandResult Fail(string message) =>
        new() { Status = CommandStatus.Error, Message = message, Refetch = RefetchScope.None };

    public static CommandResult Invalid(params (string Field, string Message)[] errors) => new()
    {
        Status = CommandStatus.Invalid,
        Refetch = RefetchScope.None,
        // Field keys are lower-cased to match the schema keys FieldSchema derives (and the SPA matches on),
        // so a handler's Invalid(nameof(X), ...) — which passes PascalCase — still lands on the right field.
        FieldErrors = errors.ToDictionary(e => e.Field.ToLowerInvariant(), e => e.Message, StringComparer.Ordinal),
    };

    public static CommandResult Invalid(string field, string message) => Invalid((field, message));

    public CommandResult WithoutRefetch() => this with { Refetch = RefetchScope.None };
}
