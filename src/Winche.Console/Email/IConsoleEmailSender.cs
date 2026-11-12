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

/// <summary>
/// A sender that may not be set up yet (e.g. it uses SMTP configured later in the console). While it isn't ready the
/// console behaves as if there were no sender: invites and resets say email isn't set up.
/// </summary>
public interface IConsoleEmailReadiness
{
    bool Ready { get; }
    /// <summary>Why not, in a sentence, with where to fix it.</summary>
    string WhyNotReady { get; }
}

/// <summary>The console's way to find its email sender.</summary>
public static class ConsoleEmail
{
    /// <summary>The sender when there's one that's ready; null otherwise.</summary>
    public static IConsoleEmailSender? Sender(IServiceProvider sp) =>
        sp.GetService(typeof(IConsoleEmailSender)) is IConsoleEmailSender s && (s is not IConsoleEmailReadiness r || r.Ready) ? s : null;

    /// <summary>Why there's no sender, for messages.</summary>
    public static string Missing(IServiceProvider sp, string what) =>
        sp.GetService(typeof(IConsoleEmailSender)) is IConsoleEmailReadiness { Ready: false } r ? $"{what} need email: {r.WhyNotReady}" : $"{what} need an email sender.";
}
