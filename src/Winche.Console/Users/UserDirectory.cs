using Microsoft.Extensions.DependencyInjection;
using Winche.Config;

namespace Winche.Console.Users;

/// <summary>A user as the Authentication tab shows them, from whichever directory holds them.</summary>
public sealed record DirectoryUser(
    string Uid, string? Email, bool EmailVerified, string? DisplayName, string? PhotoUrl, bool IsAnonymous, bool Disabled, bool MfaEnabled,
    IReadOnlyList<string> Providers, IReadOnlyDictionary<string, object?> CustomClaims, DateTimeOffset? CreatedAt, DateTimeOffset? LastSignInAt,
    DateTimeOffset? LockedOutUntil, IReadOnlyList<string>? Groups = null, string? Username = null);

public sealed record DirectorySession(string Id, string Provider, DateTimeOffset CreatedAt, DateTimeOffset LastUsedAt, DateTimeOffset? ExpiresAt,
    string? UserAgent, string? IpAddress);

public sealed record DirectoryUserDetail(DirectoryUser User, IReadOnlyList<DirectorySession> Sessions, int? RecoveryCodesLeft);

/// <summary>What a directory can do, so the console offers only that.</summary>
public sealed record DirectoryCapabilities(
    bool Create, bool Claims, string ClaimsLabel, bool Sessions, bool Unlock, bool ResetMfa, bool UnlinkProviders, bool PasswordReset,
    bool Verify, bool Delete, bool Disable, bool Groups);

/// <summary>An operation this directory doesn't support (e.g. Keycloak manages it in its own console).</summary>
public sealed class DirectoryNotSupportedException(string message) : Exception(message);

/// <summary>A problem the directory reported, with a sentence for people.</summary>
public sealed class DirectoryException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>Where the app's users live: Winche Auth, or an external system such as Keycloak.</summary>
public interface IUserDirectory
{
    /// <summary>wincheAuth or keycloak.</summary>
    string Kind { get; }
    string Label { get; }
    DirectoryCapabilities Capabilities { get; }

    Task<(IReadOnlyList<DirectoryUser> Users, int Total)> ListAsync(string? search, int offset, int limit, CancellationToken ct);
    Task<DirectoryUserDetail?> GetAsync(string uid, CancellationToken ct);
    Task<DirectoryUser> CreateAsync(string? email, string? password, string? displayName, CancellationToken ct);
    Task<DirectoryUser> SetDisabledAsync(string uid, bool disabled, CancellationToken ct);
    Task<DirectoryUser> SetClaimsAsync(string uid, IReadOnlyDictionary<string, object?>? claims, CancellationToken ct);
    Task<int?> SignOutEverywhereAsync(string uid, CancellationToken ct);
    Task<bool> RevokeSessionAsync(string uid, string sessionId, CancellationToken ct);
    Task<DirectoryUser> UnlinkProviderAsync(string uid, string provider, CancellationToken ct);
    Task<DirectoryUser> ResetMfaAsync(string uid, CancellationToken ct);
    Task<DirectoryUser> UnlockAsync(string uid, CancellationToken ct);
    Task SendPasswordResetAsync(string uid, CancellationToken ct);
    Task SendVerificationAsync(string uid, CancellationToken ct);
    Task<DirectoryUser> SetEmailVerifiedAsync(string uid, bool verified, CancellationToken ct);
    Task DeleteAsync(string uid, CancellationToken ct);
}

/// <summary>The settings area <c>console.userDirectory</c>: which directory the Users tab manages.</summary>
public sealed record UserDirectorySettings
{
    /// <summary>auto (Winche Auth when installed), wincheAuth, keycloak or none.</summary>
    public string Kind { get; init; } = "auto";
    public KeycloakDirectorySettings? Keycloak { get; init; }

    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (Kind is not ("auto" or "wincheAuth" or "keycloak" or "none")) problems.Add($"'{Kind}' isn't a directory (auto, wincheAuth, keycloak or none).");
        if (Kind == "keycloak")
        {
            if (Keycloak is null) problems.Add("Fill in the Keycloak connection.");
            else
            {
                if (!Uri.TryCreate(Keycloak.ServerUrl, UriKind.Absolute, out var u) || u.Scheme is not ("https" or "http"))
                    problems.Add("The Keycloak address must be a full address, like https://auth.example.com.");
                if (string.IsNullOrWhiteSpace(Keycloak.Realm)) problems.Add("Give the realm.");
                if (string.IsNullOrWhiteSpace(Keycloak.ClientId)) problems.Add("Give the service account's client id.");
            }
        }
        return problems;
    }
}

public sealed record KeycloakDirectorySettings
{
    /// <summary>The Keycloak server, e.g. https://auth.example.com (without /realms/…).</summary>
    public string ServerUrl { get; init; } = "";
    public string Realm { get; init; } = "";
    /// <summary>A confidential client with a service account holding realm-management roles (view-users, manage-users, …).</summary>
    public string ClientId { get; init; } = "";
    /// <summary>Show Keycloak sign-ins and failures in the Logs Explorer (needs the view-events role and events turned on in the realm).</summary>
    public bool SignInEvents { get; init; } = true;
}

/// <summary>Picks the directory in force from the settings, building a Keycloak one when its settings or secret change.</summary>
public sealed class UserDirectories(IServiceProvider services)
{
    public const string Area = "console.userDirectory";
    public const string SecretName = "console.keycloak.clientSecret";

    private KeycloakDirectory? _keycloak;
    private (KeycloakDirectorySettings Settings, DateTimeOffset? SecretSetAt) _keycloakFor;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public UserDirectorySettings Settings => services.GetService<SettingsArea<UserDirectorySettings>>()?.Current ?? new UserDirectorySettings();

    /// <summary>wincheAuth, keycloak or none: what <see cref="Settings"/> resolves to in this app.</summary>
    public string EffectiveKind => Settings.Kind switch
    {
        "keycloak" => "keycloak",
        "none" => "none",
        _ when WincheAuthInstalled => "wincheAuth",
        _ => "none",
    };

    public bool WincheAuthInstalled => services.GetService<IServiceProviderIsService>()?.IsService(typeof(Winche.Auth.IWincheAuth)) == true;

    /// <summary>The directory for this request, or null when there's none.</summary>
    public async Task<IUserDirectory?> CurrentAsync(IServiceProvider requestServices, CancellationToken ct)
    {
        switch (EffectiveKind)
        {
            case "wincheAuth":
                return new WincheAuthDirectory(requestServices.GetRequiredService<Winche.Auth.IWincheAuth>());
            case "keycloak":
                var settings = Settings.Keycloak!;
                var secrets = services.GetService<SecretStore>();
                var info = secrets is null ? null : await secrets.InfoAsync(SecretName, ct);
                await _lock.WaitAsync(ct);
                try
                {
                    if (_keycloak is null || _keycloakFor.Settings != settings || _keycloakFor.SecretSetAt != info?.SetAt)
                    {
                        var secret = secrets is null ? null : await secrets.GetAsync(SecretName, ct);
                        _keycloak = new KeycloakDirectory(settings, secret);
                        _keycloakFor = (settings, info?.SetAt);
                    }
                    return _keycloak;
                }
                finally { _lock.Release(); }
            default:
                return null;
        }
    }

    /// <summary>A Keycloak directory for a draft (Test connection), not the one in force.</summary>
    public async Task<KeycloakDirectory> DraftAsync(KeycloakDirectorySettings settings, string? newSecret, CancellationToken ct)
    {
        var secret = newSecret ?? (services.GetService<SecretStore>() is { } s ? await s.GetAsync(SecretName, ct) : null);
        return new KeycloakDirectory(settings, secret);
    }
}
