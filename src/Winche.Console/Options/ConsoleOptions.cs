namespace Winche.Console.Options;

/// <summary>Configuration for the console's built-in authentication.</summary>
public sealed class ConsoleOptions
{
    /// <summary>Connection string for the console's own auth database (Identity tables). Required.</summary>
    public string ConnectionString { get; set; } = "";

    /// <summary>Optional first-admin seed; applied on startup only when no users exist.</summary>
    public string? SeedAdminEmail { get; set; }
    public string? SeedAdminPassword { get; set; }

    /// <summary>Self-service password reset (effective only when an IConsoleEmailSender is registered). Phase 4.</summary>
    public bool AllowSelfServicePasswordReset { get; set; } = true;
}
