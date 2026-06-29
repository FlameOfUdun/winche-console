using Winche.Console.Email;

namespace Winche.Console.Sample;

/// <summary>
/// Demo email transport. Instead of sending real email, it logs the secure link to the application console
/// so you can copy it during local development — this is what makes invites and self-service password reset
/// work in the sample. Replace it with a real SMTP / transactional-email adapter in production; the console
/// only builds the link, the body/subject/template are entirely the adapter's concern.
/// </summary>
public sealed class LoggingConsoleEmailSender(ILogger<LoggingConsoleEmailSender> logger) : IConsoleEmailSender
{
    public Task SendPasswordResetAsync(ConsoleEmailRecipient user, string resetLink, CancellationToken ct = default)
    {
        logger.LogInformation("[Console email] Password reset for {Email} -> {Link}", user.Email, resetLink);
        return Task.CompletedTask;
    }

    public Task SendInviteAsync(ConsoleEmailRecipient user, string inviteLink, CancellationToken ct = default)
    {
        logger.LogInformation("[Console email] Invite for {Email} -> {Link}", user.Email, inviteLink);
        return Task.CompletedTask;
    }
}
