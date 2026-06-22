namespace Winche.Console.Email;

/// <summary>The recipient of a console email, so the consumer can personalize the message.</summary>
public sealed record ConsoleEmailRecipient(string Email, string? FirstName, string? LastName);

/// <summary>
/// Optional consumer-provided email transport. Register an implementation in DI to enable self-service
/// password reset and admin invites. The console builds the secure link; the adapter sends the email
/// (subject/body/template are the consumer's concern — the console is email-agnostic).
/// </summary>
public interface IConsoleEmailSender
{
    Task SendPasswordResetAsync(ConsoleEmailRecipient user, string resetLink, CancellationToken ct = default);
    Task SendInviteAsync(ConsoleEmailRecipient user, string inviteLink, CancellationToken ct = default);
}
