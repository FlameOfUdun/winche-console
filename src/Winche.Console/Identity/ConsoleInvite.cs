namespace Winche.Console.Identity;

/// <summary>
/// A pending invitation to create a console account. The <see cref="ConsoleUser"/> is created only when
/// the invitee accepts; until then this row carries the email, role, requirements, and expiry.
/// </summary>
public sealed class ConsoleInvite
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string Role { get; set; } = "";
    public string? FirstName { get; set; }
    public string? LastName { get; set; }

    /// <summary>Invitee must supply both first and last name when accepting.</summary>
    public bool RequireName { get; set; }

    /// <summary>Sets <see cref="ConsoleUser.TwoFactorRequired"/> on accept (forced-setup gate enrolls them).</summary>
    public bool RequireTwoFactor { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid? CreatedByUserId { get; set; }

    /// <summary>Non-null once accepted; such invites drop off the admin Invites list.</summary>
    public DateTimeOffset? AcceptedAt { get; set; }

    /// <summary>Non-null once revoked by an admin.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Derived lifecycle state. Evaluated accepted → revoked → expired → pending.</summary>
    public string Status(DateTimeOffset now) =>
        AcceptedAt is not null ? "accepted"
        : RevokedAt is not null ? "revoked"
        : now > ExpiresAt ? "expired"
        : "pending";
}
