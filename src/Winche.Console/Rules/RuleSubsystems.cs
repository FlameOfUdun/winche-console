namespace Winche.Console.Rules;

/// <summary>
/// Shared subsystem identifiers for the rules editor. Used as the <see cref="RuleVersion.Subsystem"/>
/// discriminator, the DI/registration key, and the value surfaced to the SPA (e.g. in
/// <c>api/rules/subsystems</c> and auth-state capability flags).
/// </summary>
public static class RuleSubsystems
{
    public const string Database = "database";
    public const string Storage = "storage";
}
