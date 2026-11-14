using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using Winche.Console.Options;

namespace Winche.Console.Identity;

/// <summary>
/// A console API token: <c>cli</c> (made when someone approves <c>winche login</c> in the browser; acts as them, with
/// their role as it is now) or <c>ci</c> (made by an admin for CI; named, limited to <see cref="Scopes"/>, and never
/// more than its maker can do).
/// </summary>
public sealed record ConsoleToken(string Id, string Kind, string Name, string UserId, string? UserEmail, string Role,
    IReadOnlyList<string> Scopes, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, DateTimeOffset? LastUsedAt);

/// <summary>Marks an endpoint a CI token with <see cref="Scope"/> may call (CI tokens can call nothing else).</summary>
public sealed record ConsoleCiScope(string Scope)
{
    public const string Functions = "functions", Rules = "rules", Indexes = "indexes";
    public static readonly string[] All = [Functions, Rules, Indexes];
}

/// <summary>
/// The console's API tokens and the one-time codes of the CLI's browser sign-in, in the project's config database
/// (<c>AddWincheConfig</c>). Tokens are <c>wct_&lt;id&gt;_&lt;secret&gt;</c>; only the secret's hash is kept.
/// </summary>
public sealed class ConsoleTokenStore
{
    public const string Prefix = "wct_";
    internal const string Tokens = "winche_console_tokens", Codes = "winche_console_cli_codes";

    private static readonly string[] Schema =
    [
        $"""
        CREATE TABLE IF NOT EXISTS {Tokens} (
            id           text        PRIMARY KEY,
            kind         text        NOT NULL,
            name         text        NOT NULL,
            user_id      text        NOT NULL,
            user_email   text        NULL,
            role         text        NOT NULL,
            scopes       text[]      NOT NULL,
            hash         bytea       NOT NULL,
            created_at   timestamptz NOT NULL,
            expires_at   timestamptz NOT NULL,
            last_used_at timestamptz NULL,
            revoked_at   timestamptz NULL
        );
        CREATE TABLE IF NOT EXISTS {Codes} (
            hash       bytea       PRIMARY KEY,
            challenge  text        NOT NULL,
            user_id    text        NOT NULL,
            user_email text        NULL,
            role       text        NOT NULL,
            name       text        NOT NULL,
            expires_at timestamptz NOT NULL
        );
        """,
    ];

    private readonly NpgsqlDataSource? _db;
    private readonly TimeProvider _time;
    private bool _ready;

    public ConsoleTokenStore(IServiceProvider services, TimeProvider? time = null)
    {
        _db = services.GetKeyedService<NpgsqlDataSource>("WincheConfigOptions");
        _time = time ?? TimeProvider.System;
    }

    /// <summary>False without <c>AddWincheConfig</c>: there's nowhere to keep tokens.</summary>
    public bool Available => _db is not null;

    /// <summary>How long a <c>winche login</c> lasts.</summary>
    public static readonly TimeSpan CliLifetime = TimeSpan.FromDays(90);

    private NpgsqlDataSource Db => _db ?? throw new InvalidOperationException("Console tokens need AddWincheConfig(…).");

    private async Task EnsureAsync(CancellationToken ct)
    {
        if (_ready) return;
        await Winche.Core.WincheSchema.EnsureAsync(Db, "console-tokens", Schema, ct);
        _ready = true;
    }

    private static byte[] Hash(string secret) => SHA256.HashData(Encoding.UTF8.GetBytes(secret));
    private static string Random(int bytes) => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(bytes));

    /// <summary>A new token; the returned string is shown once.</summary>
    public async Task<(ConsoleToken Token, string Secret)> CreateAsync(string kind, string name, string userId, string? email, string role,
        IReadOnlyList<string> scopes, TimeSpan lifetime, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        var id = Random(8);
        var secret = Random(24);
        var now = _time.GetUtcNow();
        await using var cmd = Db.CreateCommand($"""
            INSERT INTO {Tokens} (id, kind, name, user_id, user_email, role, scopes, hash, created_at, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """);
        foreach (var p in new object?[] { id, kind, name, userId, (object?)email ?? DBNull.Value, role, scopes.ToArray(), Hash(secret), now, now + lifetime })
            cmd.Parameters.Add(new NpgsqlParameter { Value = p ?? DBNull.Value });
        await cmd.ExecuteNonQueryAsync(ct);
        return (new ConsoleToken(id, kind, name, userId, email, role, scopes, now, now + lifetime, null), $"{Prefix}{id}_{secret}");
    }

    /// <summary>The live token <paramref name="bearer"/> is, or null (wrong, expired, revoked).</summary>
    public async Task<ConsoleToken?> FindAsync(string bearer, CancellationToken ct = default)
    {
        if (_db is null || !bearer.StartsWith(Prefix, StringComparison.Ordinal)) return null;
        var parts = bearer[Prefix.Length..].Split('_', 2);
        if (parts is not [{ Length: 16 } id, { Length: 48 } secret]) return null;
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"""
            SELECT id, kind, name, user_id, user_email, role, scopes, created_at, expires_at, last_used_at, hash
            FROM {Tokens} WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
            """);
        cmd.Parameters.AddWithValue(id);
        ConsoleToken? token = null;
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            if (!await r.ReadAsync(ct)) return null;
            if (!CryptographicOperations.FixedTimeEquals(r.GetFieldValue<byte[]>(10), Hash(secret))) return null;
            token = Read(r);
        }
        // Last use, at most once a minute.
        if (token.LastUsedAt is null || _time.GetUtcNow() - token.LastUsedAt > TimeSpan.FromMinutes(1))
        {
            await using var touch = Db.CreateCommand($"UPDATE {Tokens} SET last_used_at = now() WHERE id = $1");
            touch.Parameters.AddWithValue(id);
            await touch.ExecuteNonQueryAsync(ct);
        }
        return token;
    }

    private static ConsoleToken Read(NpgsqlDataReader r) => new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3),
        r.IsDBNull(4) ? null : r.GetString(4), r.GetString(5), r.GetFieldValue<string[]>(6), r.GetFieldValue<DateTimeOffset>(7),
        r.GetFieldValue<DateTimeOffset>(8), r.IsDBNull(9) ? null : r.GetFieldValue<DateTimeOffset>(9));

    /// <summary>The live tokens, newest first.</summary>
    public async Task<IReadOnlyList<ConsoleToken>> ListAsync(CancellationToken ct = default)
    {
        if (_db is null) return [];
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"""
            SELECT id, kind, name, user_id, user_email, role, scopes, created_at, expires_at, last_used_at
            FROM {Tokens} WHERE revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC
            """);
        var list = new List<ConsoleToken>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(Read(r));
        return list;
    }

    /// <summary>Revokes token <paramref name="id"/>; false when there's no such live token.</summary>
    public async Task<bool> RevokeAsync(string id, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"UPDATE {Tokens} SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL");
        cmd.Parameters.AddWithValue(id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    /// <summary>A one-time code (5 minutes) for the CLI's sign-in, redeemed with the PKCE verifier of <paramref name="challenge"/>.</summary>
    public async Task<string> CreateCodeAsync(string challenge, string userId, string? email, string role, string name, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        var code = Random(24);
        await using (var sweep = Db.CreateCommand($"DELETE FROM {Codes} WHERE expires_at < now()")) await sweep.ExecuteNonQueryAsync(ct);
        await using var cmd = Db.CreateCommand(
            $"INSERT INTO {Codes} (hash, challenge, user_id, user_email, role, name, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)");
        foreach (var p in new object?[] { Hash(code), challenge, userId, email, role, name, _time.GetUtcNow() + TimeSpan.FromMinutes(5) })
            cmd.Parameters.Add(new NpgsqlParameter { Value = p ?? DBNull.Value });
        await cmd.ExecuteNonQueryAsync(ct);
        return code;
    }

    /// <summary>The sign-in <paramref name="code"/> is for (once), if <paramref name="verifier"/> matches its challenge.</summary>
    public async Task<(string UserId, string? Email, string Role, string Name)?> RedeemCodeAsync(string code, string verifier, CancellationToken ct = default)
    {
        await EnsureAsync(ct);
        await using var cmd = Db.CreateCommand($"""
            DELETE FROM {Codes} WHERE hash = $1 AND expires_at > now() RETURNING challenge, user_id, user_email, role, name
            """);
        cmd.Parameters.AddWithValue(Hash(code));
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        var expected = r.GetString(0);
        var actual = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(actual))) return null;
        return (r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2), r.GetString(3), r.GetString(4));
    }

    internal static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>
/// Signs in requests carrying <c>Authorization: Bearer wct_…</c>. A CLI token acts as its user with their role now; a
/// CI token acts as itself, with the lower of its role and its maker's, and only on endpoints marked with one of its
/// scopes (<see cref="ConsoleCiScope"/>). In Identity mode a token stops working when its user is removed or locked out.
/// </summary>
internal sealed class ConsoleTokenHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "WincheConsoleToken";
    public const string TokenIdClaim = "winche_token", TokenKindClaim = "winche_token_kind";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer " + ConsoleTokenStore.Prefix, StringComparison.Ordinal)) return AuthenticateResult.NoResult();
        var store = Context.RequestServices.GetRequiredService<ConsoleTokenStore>();
        if (await store.FindAsync(header[7..].Trim(), Context.RequestAborted) is not { } token)
            return AuthenticateResult.Fail("That token isn't valid (wrong, expired or revoked): run winche login, or make a new CI token.");

        var console = Context.RequestServices.GetRequiredService<ConsoleOptions>();
        var role = token.Role;
        string? email = token.UserEmail;
        if (console.Provider == ConsoleAuthProvider.Identity)
        {
            var users = Context.RequestServices.GetRequiredService<UserManager<ConsoleUser>>();
            var user = await users.FindByIdAsync(token.UserId);
            if (user is null || await users.IsLockedOutAsync(user)) return AuthenticateResult.Fail("The token's user is no longer in the console.");
            var roles = await users.GetRolesAsync(user);
            var now = roles.Contains(ConsoleRoles.Admin) ? ConsoleRoles.Admin : roles.Contains(ConsoleRoles.Member) ? ConsoleRoles.Member
                : roles.Contains(ConsoleRoles.Viewer) ? ConsoleRoles.Viewer : null;
            if (now is null) return AuthenticateResult.Fail("The token's user has no console role.");
            role = token.Kind == "cli" ? now : Lower(token.Role, now);
            email = user.Email;
        }

        if (token.Kind == "ci")
        {
            var allowed = Context.GetEndpoint()?.Metadata.GetOrderedMetadata<ConsoleCiScope>() ?? [];
            if (!allowed.Any(s => token.Scopes.Contains(s.Scope)))
                return AuthenticateResult.Fail($"The CI token '{token.Name}' can only deploy ({string.Join(", ", token.Scopes)}).");
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, token.UserId),
            new(TokenIdClaim, token.Id),
            new(TokenKindClaim, token.Kind),
            new(ClaimTypes.Role, RoleName(role, console)),
        };
        if (token.Kind == "cli")
        {
            if (email is not null) claims.Add(new Claim(ClaimTypes.Email, email));
            claims.Add(new Claim(ClaimTypes.Name, email ?? token.UserId));
        }
        else
        {
            // The version history names the token and who made it: "gitlab-main (CI token by ann@example.com)".
            claims.Add(new Claim(ClaimTypes.Name, $"{token.Name} (CI token by {token.UserEmail ?? token.UserId})"));
        }
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme, ClaimTypes.Name, ClaimTypes.Role));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme));
    }

    private static int Rank(string role) => role switch { ConsoleRoles.Admin => 2, ConsoleRoles.Member => 1, _ => 0 };
    internal static string Lower(string a, string b) => Rank(a) <= Rank(b) ? a : b;

    /// <summary>The role claim the policies expect: the canonical name, or the host's Keycloak role name.</summary>
    private static string RoleName(string role, ConsoleOptions o) => o.Provider != ConsoleAuthProvider.Keycloak ? role : role switch
    {
        ConsoleRoles.Admin => o.Keycloak.AdminRole,
        ConsoleRoles.Member => o.Keycloak.MemberRole,
        _ => o.Keycloak.ViewerRole,
    };
}
