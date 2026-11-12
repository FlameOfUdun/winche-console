using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Winche.Console.Users;

/// <summary>
/// Brings Keycloak's sign-ins, failures and sign-outs into the Logs Explorer (resource <c>auth</c>) when the directory is
/// Keycloak and <c>SignInEvents</c> is on: it reads the realm's saved events every half minute.
/// </summary>
internal sealed class KeycloakSignInEvents(IServiceProvider services, UserDirectories directories, ILoggerFactory loggers) : BackgroundService
{
    private readonly ILogger _events = loggers.CreateLogger(Winche.Auth.Logging.AuthEvents.Category);
    private readonly ILogger _logger = loggers.CreateLogger<KeycloakSignInEvents>();
    private DateTimeOffset _since = DateTimeOffset.UtcNow.AddMinutes(-5);
    private string? _warned;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try { await PollAsync(stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                if (_warned != ex.Message) _logger.LogWarning("Couldn't read Keycloak's sign-in events: {Message}", ex.Message);
                _warned = ex.Message;
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>One Keycloak event as an auth entry, shaped like Winche Auth's own.</summary>
    internal static void Write(ILogger events, System.Text.Json.Nodes.JsonObject e)
    {
        var type = e["type"]?.GetValue<string>();
        var user = e["details"]?["username"]?.GetValue<string>() ?? e["userId"]?.GetValue<string>() ?? "someone";
        var principal = e["userId"]?.GetValue<string>() ?? user;
        var client = e["clientId"]?.GetValue<string>();
        var error = e["error"]?.GetValue<string>();
        var outcome = error is null ? "ok" : Camel(error);
        var (operation, level, message) = type switch
        {
            "LOGIN" => ("auth.signIn.keycloak", LogLevel.Information, $"{user} signed in with Keycloak{(client is null ? "" : $" ({client})")}."),
            "LOGOUT" => ("auth.signOut.keycloak", LogLevel.Information, $"{user} signed out of Keycloak."),
            _ => ("auth.signIn.keycloak", LogLevel.Warning, $"Sign-in as {user} failed in Keycloak: {error ?? "unknown reason"}."),
        };
        if (type == "LOGIN_ERROR" && outcome == "ok") outcome = "failed";
        var email = user.Contains('@') ? user : null;
        events.Log(level, new EventId(outcome == "ok" ? 1 : 2, "Auth"), new Winche.Auth.Logging.AuthEvent(operation, principal, outcome, message, email), null,
            static (ev, _) => ev.Message);
    }

    /// <summary>"invalid_user_credentials" → "invalidUserCredentials", like Winche Auth's outcomes.</summary>
    private static string Camel(string code)
    {
        var parts = code.ToLowerInvariant().Split('_');
        return parts[0] + string.Concat(parts.Skip(1).Where(p => p.Length > 0).Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
    }

    private async Task PollAsync(CancellationToken ct)
    {
        if (directories.EffectiveKind != "keycloak" || directories.Settings.Keycloak is not { SignInEvents: true }) return;
        await using var scope = services.CreateAsyncScope();
        if (await directories.CurrentAsync(scope.ServiceProvider, ct) is not KeycloakDirectory keycloak) return;
        foreach (var e in await keycloak.SignInEventsAsync(_since, ct))
        {
            Write(_events, e);
            if (e["time"]?.GetValue<long>() is { } ms) _since = DateTimeOffset.FromUnixTimeMilliseconds(ms);
        }
        _warned = null;
    }
}
