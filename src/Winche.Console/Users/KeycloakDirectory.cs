using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Winche.Console.Users;

/// <summary>What a Keycloak connection test found: the realm, and which permissions the service account has.</summary>
public sealed record KeycloakConnectionTest(bool Connected, string? Error, int? Users, IReadOnlyList<KeycloakPermission> Permissions);

/// <summary>One realm-management role the console uses, whether the service account has it, and what it's for.</summary>
public sealed record KeycloakPermission(string Role, bool Granted, string For);

/// <summary>
/// The app's users in a Keycloak realm, through Keycloak's admin REST API, signed in as a service account (client
/// credentials). Changes happen in Keycloak itself; the console keeps no copy.
/// </summary>
public sealed class KeycloakDirectory : IUserDirectory
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly KeycloakDirectorySettings _settings;
    private readonly string? _secret;
    private (string Token, DateTimeOffset Expires)? _token;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    internal KeycloakDirectory(KeycloakDirectorySettings settings, string? secret)
    {
        _settings = settings;
        _secret = secret;
    }

    public string Kind => "keycloak";
    public string Label => "Keycloak";
    public DirectoryCapabilities Capabilities { get; } = new(Create: true, Claims: true, ClaimsLabel: "Attributes", Sessions: true, Unlock: true,
        ResetMfa: true, UnlinkProviders: false, PasswordReset: true, Verify: true, Delete: true, Disable: true, Groups: true);

    internal KeycloakDirectorySettings Settings => _settings;
    private string Server => _settings.ServerUrl.TrimEnd('/');
    private string Admin => $"{Server}/admin/realms/{Uri.EscapeDataString(_settings.Realm)}";

    // ── users ───────────────────────────────────────────────────────────────────

    public async Task<(IReadOnlyList<DirectoryUser> Users, int Total)> ListAsync(string? search, int offset, int limit, CancellationToken ct)
    {
        var q = string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search.Trim())}";
        var users = await GetAsync<JsonArray>($"{Admin}/users?first={offset}&max={limit}&briefRepresentation=false{q}", ct);
        var total = await GetAsync<int>($"{Admin}/users/count?{q.TrimStart('&')}", ct);
        return ([.. users.Select(u => From(u!.AsObject()))], total);
    }

    public async Task<DirectoryUserDetail?> GetAsync(string uid, CancellationToken ct)
    {
        var user = await GetOrNullAsync<JsonObject>($"{Admin}/users/{Id(uid)}", ct);
        if (user is null) return null;
        var groups = await GetAsync<JsonArray>($"{Admin}/users/{Id(uid)}/groups", ct);
        var sessions = await GetAsync<JsonArray>($"{Admin}/users/{Id(uid)}/sessions", ct);
        var credentials = await GetAsync<JsonArray>($"{Admin}/users/{Id(uid)}/credentials", ct);
        var lockout = await GetOrNullAsync<JsonObject>($"{Admin}/attack-detection/brute-force/users/{Id(uid)}", ct);
        var mfa = credentials.Any(c => c?["type"]?.GetValue<string>() == "otp");
        DateTimeOffset? lockedUntil = lockout?["disabled"]?.GetValue<bool>() == true ? DateTimeOffset.UtcNow.AddMinutes(1) : null;
        var directoryUser = From(user, [.. groups.Select(g => g?["path"]?.GetValue<string>() ?? g?["name"]?.GetValue<string>() ?? "")], mfa, lockedUntil);
        var list = sessions.Select(s => s!.AsObject()).Select(s => new DirectorySession(
            s["id"]!.GetValue<string>(),
            s["clients"] is JsonObject clients && clients.Count > 0 ? string.Join(", ", clients.Select(c => c.Value?.GetValue<string>())) : "keycloak",
            Ms(s["start"]) ?? DateTimeOffset.UtcNow, Ms(s["lastAccess"]) ?? DateTimeOffset.UtcNow, null, null, s["ipAddress"]?.GetValue<string>())).ToList();
        return new DirectoryUserDetail(directoryUser, list, null);
    }

    public async Task<DirectoryUser> CreateAsync(string? email, string? password, string? displayName, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(email)) throw new DirectoryException("Keycloak users need an email (it's also their username here).");
        var parts = (displayName ?? "").Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        var body = new JsonObject
        {
            ["username"] = email.Trim(), ["email"] = email.Trim(), ["enabled"] = true,
            ["firstName"] = parts.Length > 0 ? parts[0] : null, ["lastName"] = parts.Length > 1 ? parts[1] : null,
        };
        if (!string.IsNullOrEmpty(password))
            body["credentials"] = new JsonArray(new JsonObject { ["type"] = "password", ["value"] = password, ["temporary"] = true });
        using var resp = await SendAsync(HttpMethod.Post, $"{Admin}/users", body, ct);
        var id = resp.Headers.Location?.Segments.LastOrDefault() ?? throw new DirectoryException("Keycloak created the user but didn't say its id.");
        return (await GetAsync(id, ct))!.User;
    }

    public async Task<DirectoryUser> SetDisabledAsync(string uid, bool disabled, CancellationToken ct)
    {
        await UpdateAsync(uid, new JsonObject { ["enabled"] = !disabled }, ct);
        if (disabled) await SignOutEverywhereAsync(uid, ct);
        return (await GetAsync(uid, ct))!.User;
    }

    /// <summary>Keycloak attributes: string lists. A single value shows as a string.</summary>
    public async Task<DirectoryUser> SetClaimsAsync(string uid, IReadOnlyDictionary<string, object?>? claims, CancellationToken ct)
    {
        var attributes = new JsonObject();
        foreach (var (k, v) in claims ?? new Dictionary<string, object?>())
        {
            var values = v switch
            {
                null => [],
                string text => [JsonValue.Create(text)],
                System.Collections.IEnumerable list => list.Cast<object?>().Select(x => (JsonNode?)JsonValue.Create(x?.ToString())).ToArray(),
                _ => [JsonValue.Create(v.ToString())],
            };
            attributes[k] = new JsonArray(values);
        }
        await UpdateAsync(uid, new JsonObject { ["attributes"] = attributes }, ct);
        var user = (await GetAsync(uid, ct))!.User;
        // Keycloak's user profile keeps only the attributes it declares, and drops the rest without saying so.
        var dropped = attributes.Select(a => a.Key).Where(k => !user.CustomClaims.ContainsKey(k)).ToList();
        if (dropped.Count > 0)
            throw new DirectoryException($"Keycloak didn't keep {string.Join(", ", dropped)}: its user profile only keeps attributes it knows. " +
                "In Keycloak, add them under Realm settings → User profile, or set Unmanaged attributes to Enabled.");
        return user;
    }

    public async Task<int?> SignOutEverywhereAsync(string uid, CancellationToken ct)
    {
        var sessions = await GetAsync<JsonArray>($"{Admin}/users/{Id(uid)}/sessions", ct);
        using var _ = await SendAsync(HttpMethod.Post, $"{Admin}/users/{Id(uid)}/logout", null, ct);
        return sessions.Count;
    }

    public async Task<bool> RevokeSessionAsync(string uid, string sessionId, CancellationToken ct)
    {
        using var resp = await SendAsync(HttpMethod.Delete, $"{Admin}/sessions/{Id(sessionId)}", null, ct, allowNotFound: true);
        return resp.StatusCode != HttpStatusCode.NotFound;
    }

    public Task<DirectoryUser> UnlinkProviderAsync(string uid, string provider, CancellationToken ct) =>
        throw new DirectoryNotSupportedException("Linked accounts are managed in Keycloak's own admin console.");

    public async Task<DirectoryUser> ResetMfaAsync(string uid, CancellationToken ct)
    {
        foreach (var c in await GetAsync<JsonArray>($"{Admin}/users/{Id(uid)}/credentials", ct))
            if (c?["type"]?.GetValue<string>() == "otp")
                using (await SendAsync(HttpMethod.Delete, $"{Admin}/users/{Id(uid)}/credentials/{Id(c["id"]!.GetValue<string>())}", null, ct)) { }
        return (await GetAsync(uid, ct))!.User;
    }

    public async Task<DirectoryUser> UnlockAsync(string uid, CancellationToken ct)
    {
        using (await SendAsync(HttpMethod.Delete, $"{Admin}/attack-detection/brute-force/users/{Id(uid)}", null, ct, allowNotFound: true)) { }
        return (await GetAsync(uid, ct))!.User;
    }

    public async Task SendPasswordResetAsync(string uid, CancellationToken ct)
    {
        using var _ = await SendAsync(HttpMethod.Put, $"{Admin}/users/{Id(uid)}/execute-actions-email", new JsonArray("UPDATE_PASSWORD"), ct);
    }

    public async Task SendVerificationAsync(string uid, CancellationToken ct)
    {
        using var _ = await SendAsync(HttpMethod.Put, $"{Admin}/users/{Id(uid)}/send-verify-email", null, ct);
    }

    public async Task<DirectoryUser> SetEmailVerifiedAsync(string uid, bool verified, CancellationToken ct)
    {
        await UpdateAsync(uid, new JsonObject { ["emailVerified"] = verified }, ct);
        return (await GetAsync(uid, ct))!.User;
    }

    public async Task DeleteAsync(string uid, CancellationToken ct)
    {
        using var _ = await SendAsync(HttpMethod.Delete, $"{Admin}/users/{Id(uid)}", null, ct);
    }

    // ── connection test and events ──────────────────────────────────────────────

    private static readonly (string Role, string For)[] Roles =
    [
        ("view-users", "list and open users"),
        ("manage-users", "disable, delete, sign out, unlock, send emails, edit attributes"),
        ("query-groups", "show each user's groups"),
        ("view-events", "show sign-ins and failures in Logs"),
    ];

    /// <summary>Signs in as the service account, reads the realm's user count, and checks its realm-management roles.</summary>
    public async Task<KeycloakConnectionTest> TestAsync(CancellationToken ct)
    {
        string token;
        try { token = await TokenAsync(ct, force: true); }
        catch (DirectoryException ex) { return new KeycloakConnectionTest(false, ex.Message, null, []); }
        var granted = RolesIn(token);
        var permissions = Roles.Select(r => new KeycloakPermission(r.Role, granted.Contains(r.Role) || granted.Contains("realm-admin"), r.For)).ToList();
        int? users = null;
        try { users = await GetAsync<int>($"{Admin}/users/count", ct); }
        catch (DirectoryException ex) { return new KeycloakConnectionTest(true, ex.Message, null, permissions); }
        return new KeycloakConnectionTest(true, null, users, permissions);
    }

    /// <summary>Sign-in events since <paramref name="since"/> (oldest first): needs view-events and events saved in the realm.</summary>
    internal async Task<IReadOnlyList<JsonObject>> SignInEventsAsync(DateTimeOffset since, CancellationToken ct)
    {
        var url = $"{Admin}/events?type=LOGIN&type=LOGIN_ERROR&type=LOGOUT&dateFrom={since.UtcDateTime:yyyy-MM-dd}&first=0&max=200";
        var events = await GetAsync<JsonArray>(url, ct);
        return [.. events.Select(e => e!.AsObject()).Where(e => Ms(e["time"]) > since).OrderBy(e => Ms(e["time"]))];
    }

    // ── plumbing ────────────────────────────────────────────────────────────────

    private static DirectoryUser From(JsonObject u, IReadOnlyList<string>? groups = null, bool mfa = false, DateTimeOffset? lockedUntil = null)
    {
        var first = u["firstName"]?.GetValue<string>();
        var last = u["lastName"]?.GetValue<string>();
        var name = string.Join(' ', new[] { first, last }.Where(s => !string.IsNullOrWhiteSpace(s)));
        var attributes = new Dictionary<string, object?>();
        if (u["attributes"] is JsonObject attrs)
            foreach (var (k, v) in attrs)
            {
                var values = v is JsonArray a ? a.Select(x => x?.GetValue<string>()).ToList() : [v?.ToString()];
                attributes[k] = values.Count == 1 ? values[0] : values;
            }
        return new DirectoryUser(
            u["id"]!.GetValue<string>(), u["email"]?.GetValue<string>(), u["emailVerified"]?.GetValue<bool>() ?? false,
            name.Length > 0 ? name : null, null, false, !(u["enabled"]?.GetValue<bool>() ?? true), mfa,
            u["federationLink"] is null ? ["keycloak"] : ["keycloak", "federated"], attributes, Ms(u["createdTimestamp"]), null, lockedUntil,
            groups, u["username"]?.GetValue<string>());
    }

    private static DateTimeOffset? Ms(JsonNode? n) => n is JsonValue v && v.TryGetValue<long>(out var ms) ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : null;

    private static string Id(string id) => Uri.EscapeDataString(id);

    private async Task UpdateAsync(string uid, JsonObject changes, CancellationToken ct)
    {
        // Keycloak's PUT replaces the representation's given fields: send the user with the changes applied.
        var user = await GetOrNullAsync<JsonObject>($"{Admin}/users/{Id(uid)}", ct) ?? throw new DirectoryException("There's no such user in Keycloak.", 404);
        foreach (var (k, v) in changes) user[k] = v?.DeepClone();
        using var _ = await SendAsync(HttpMethod.Put, $"{Admin}/users/{Id(uid)}", user, ct);
    }

    private async Task<T> GetAsync<T>(string url, CancellationToken ct) =>
        await GetOrNullAsync<T>(url, ct) ?? throw new DirectoryException("Keycloak didn't find that.", 404);

    private async Task<T?> GetOrNullAsync<T>(string url, CancellationToken ct)
    {
        using var resp = await SendAsync(HttpMethod.Get, url, null, ct, allowNotFound: true);
        if (resp.StatusCode == HttpStatusCode.NotFound) return default;
        var text = await resp.Content.ReadAsStringAsync(ct);
        return string.IsNullOrEmpty(text) ? default : JsonSerializer.Deserialize<T>(text);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, JsonNode? body, CancellationToken ct, bool allowNotFound = false)
    {
        for (var attempt = 0; ; attempt++)
        {
            var request = new HttpRequestMessage(method, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await TokenAsync(ct, force: attempt > 0));
            if (body is not null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            HttpResponseMessage resp;
            try { resp = await Http.SendAsync(request, ct); }
            catch (HttpRequestException ex) { throw new DirectoryException($"Couldn't reach Keycloak at {Server}: {ex.Message}", 502); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new DirectoryException($"Keycloak at {Server} didn't answer in time.", 504); }
            if (resp.StatusCode == HttpStatusCode.Unauthorized && attempt == 0) { resp.Dispose(); continue; }   // a stale token: once more
            if (resp.IsSuccessStatusCode || (allowNotFound && resp.StatusCode == HttpStatusCode.NotFound)) return resp;
            var detail = await resp.Content.ReadAsStringAsync(ct);
            resp.Dispose();
            throw resp.StatusCode switch
            {
                HttpStatusCode.Forbidden => new DirectoryException("Keycloak refused: the service account is missing a realm-management role. Use Test connection in Settings → User directory to see which.", 403),
                HttpStatusCode.NotFound => new DirectoryException("Keycloak didn't find that.", 404),
                HttpStatusCode.Conflict => new DirectoryException("Keycloak already has a user with that username or email.", 409),
                _ when Message(detail).Contains("email", StringComparison.OrdinalIgnoreCase) && url.Contains("email", StringComparison.Ordinal) =>
                    new DirectoryException($"Keycloak couldn't send the email: {Message(detail)}. Set up email in Keycloak under Realm settings → Email.", 502),
                _ => new DirectoryException($"Keycloak answered {(int)resp.StatusCode}: {Message(detail)}", 502),
            };
        }
    }

    private static string Message(string body)
    {
        try
        {
            var o = JsonNode.Parse(body);
            return o?["errorMessage"]?.GetValue<string>() ?? o?["error_description"]?.GetValue<string>() ?? o?["error"]?.GetValue<string>() ?? body;
        }
        catch (JsonException) { return body.Length > 200 ? body[..200] : body; }
    }

    private async Task<string> TokenAsync(CancellationToken ct, bool force)
    {
        if (!force && _token is { } t && t.Expires > DateTimeOffset.UtcNow.AddSeconds(30)) return t.Token;
        await _tokenLock.WaitAsync(ct);
        try
        {
            if (string.IsNullOrEmpty(_secret)) throw new DirectoryException("The Keycloak client secret isn't set: add it in Settings → User directory.");
            using var resp = await Http.PostAsync($"{Server}/realms/{Uri.EscapeDataString(_settings.Realm)}/protocol/openid-connect/token",
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials", ["client_id"] = _settings.ClientId, ["client_secret"] = _secret,
                }), ct).ContinueWith(task =>
                {
                    if (task.IsFaulted) throw new DirectoryException($"Couldn't reach Keycloak at {Server}: {task.Exception!.GetBaseException().Message}", 502);
                    return task.Result;
                }, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new DirectoryException(resp.StatusCode == HttpStatusCode.NotFound
                    ? $"There's no realm '{_settings.Realm}' at {Server}."
                    : $"Keycloak didn't let the service account sign in: {Message(text)}", 400);
            var json = JsonNode.Parse(text)!;
            var token = json["access_token"]!.GetValue<string>();
            _token = (token, DateTimeOffset.UtcNow.AddSeconds(json["expires_in"]?.GetValue<int>() ?? 60));
            return token;
        }
        finally { _tokenLock.Release(); }
    }

    /// <summary>The realm-management roles in a service-account token.</summary>
    private static HashSet<string> RolesIn(string token)
    {
        try
        {
            var payload = JsonNode.Parse(WincheBase64Url.Decode(token.Split('.')[1]));
            return [.. (payload?["resource_access"]?["realm-management"]?["roles"] as JsonArray ?? []).Select(r => r!.GetValue<string>())];
        }
        catch (Exception) { return []; }
    }

}
