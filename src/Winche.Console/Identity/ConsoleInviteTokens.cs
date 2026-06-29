using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace Winche.Console.Identity;

/// <summary>
/// Mints and validates self-expiring invite tokens using ASP.NET Core Data Protection — the same primitive
/// Identity's token providers are built on. The token encodes only the invite id; expiry is enforced
/// cryptographically. Revocation/accepted state lives on the <see cref="ConsoleInvite"/> row.
/// </summary>
public sealed class ConsoleInviteTokens
{
    private readonly ITimeLimitedDataProtector _protector;

    public ConsoleInviteTokens(IDataProtectionProvider provider) =>
        _protector = provider.CreateProtector("Winche.Console.Invite").ToTimeLimitedDataProtector();

    public string Protect(Guid inviteId, TimeSpan lifetime) =>
        _protector.Protect(inviteId.ToString("N"), lifetime);

    public bool TryUnprotect(string? token, out Guid inviteId)
    {
        inviteId = Guid.Empty;
        if (string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            return Guid.TryParseExact(_protector.Unprotect(token), "N", out inviteId);
        }
        catch (CryptographicException)
        {
            return false;
        }
    }
}
