using Microsoft.AspNetCore.Identity;

namespace Winche.Console.Identity;

/// <summary>A console account. Email is also the user name.</summary>
public sealed class ConsoleUser : IdentityUser<Guid>
{
    public string? FirstName { get; set; }
    public string? LastName { get; set; }

    /// <summary>Admin enable/disable. Inactive accounts cannot sign in. Distinct from failed-login lockout.</summary>
    public bool Active { get; set; } = true;

    /// <summary>Admin mandates two-factor for this user (enforced in Phase 3).</summary>
    public bool TwoFactorRequired { get; set; }
}
