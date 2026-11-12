using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Winche.Console.Tests;

/// <summary>Just enough of Keycloak's admin REST API for the console's user directory, on a real port.</summary>
public sealed class FakeKeycloak : IAsyncDisposable
{
    private readonly WebApplication _app;
    public string Url { get; private set; } = "";
    public const string Secret = "kc-client-secret";
    public List<JsonObject> Users { get; } = [];
    public Dictionary<string, List<string>> Groups { get; } = [];
    public HashSet<string> Otp { get; } = [];
    public HashSet<string> Locked { get; } = [];
    public List<string> Calls { get; } = [];
    public List<JsonObject> Events { get; } = [];
    public string[] Roles { get; set; } = ["view-users", "manage-users", "query-groups"];

    private FakeKeycloak(WebApplication app) => _app = app;

    public static async Task<FakeKeycloak> StartAsync()
    {
        var b = WebApplication.CreateBuilder();
        b.WebHost.UseUrls("http://127.0.0.1:0");
        b.Logging.ClearProviders();
        var app = b.Build();
        var kc = new FakeKeycloak(app);
        kc.Users.Add(User("u-ana", "dr.costa@example.com", "Ana", "Costa", attrs: new JsonObject { ["org"] = new JsonArray("st-marys") }));
        kc.Users.Add(User("u-ben", "ben@example.com", "Ben", "Hall"));
        kc.Groups["u-ana"] = ["/clinicians"];
        kc.Otp.Add("u-ana");
        kc.Locked.Add("u-ben");
        const string admin = "/admin/realms/smartairway";

        app.MapPost("/realms/smartairway/protocol/openid-connect/token", async (HttpRequest r) =>
        {
            var form = await r.ReadFormAsync();
            if (form["client_secret"] != Secret) return Results.Json(new { error = "unauthorized_client", error_description = "Invalid client or Invalid client credentials" }, statusCode: 401);
            var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { resource_access = new Dictionary<string, object> { ["realm-management"] = new { roles = kc.Roles } } }))).TrimEnd('=');
            return Results.Json(new { access_token = $"h.{payload}.s", expires_in = 300 });
        });
        app.MapGet(admin + "/users", (string? search, int? first, int? max) =>
            Results.Json(kc.Match(search).Skip(first ?? 0).Take(max ?? 100)));
        app.MapGet(admin + "/users/count", (string? search) => Results.Json(kc.Match(search).Count()));
        app.MapGet(admin + "/users/{id}", (string id) => kc.Find(id) is { } u ? Results.Json(u) : Results.NotFound());
        app.MapPut(admin + "/users/{id}", async (string id, HttpRequest r) =>
        {
            var u = kc.Find(id);
            if (u is null) return Results.NotFound();
            var body = (await JsonNode.ParseAsync(r.Body))!.AsObject();
            foreach (var (k, v) in body) u[k] = v?.DeepClone();
            kc.Calls.Add($"update {id}");
            return Results.NoContent();
        });
        app.MapPost(admin + "/users", async (HttpRequest r) =>
        {
            var body = (await JsonNode.ParseAsync(r.Body))!.AsObject();
            if (kc.Users.Any(u => u["username"]!.GetValue<string>() == body["username"]!.GetValue<string>())) return Results.Conflict(new { errorMessage = "User exists with same username" });
            var id = $"u-{kc.Users.Count + 1}";
            kc.Users.Add(User(id, body["email"]!.GetValue<string>(), body["firstName"]?.GetValue<string>(), body["lastName"]?.GetValue<string>()));
            return Results.Created($"{kc.Url}{admin}/users/{id}", null);
        });
        app.MapDelete(admin + "/users/{id}", (string id) => kc.Users.RemoveAll(u => u["id"]!.GetValue<string>() == id) > 0 ? Results.NoContent() : Results.NotFound());
        app.MapGet(admin + "/users/{id}/groups", (string id) => Results.Json(kc.Groups.GetValueOrDefault(id, []).Select(p => new { name = p.TrimStart('/'), path = p })));
        app.MapGet(admin + "/users/{id}/sessions", (string id) => Results.Json(id == "u-ana"
            ? new object[] { new { id = "s-1", ipAddress = "10.0.0.7", start = 1794480000000, lastAccess = 1794500000000, clients = new Dictionary<string, string> { ["c1"] = "smartairway-app" } } }
            : []));
        app.MapGet(admin + "/users/{id}/credentials", (string id) => Results.Json(kc.Otp.Contains(id)
            ? new object[] { new { id = "cred-pw", type = "password" }, new { id = "cred-otp", type = "otp" } } : new object[] { new { id = "cred-pw", type = "password" } }));
        app.MapDelete(admin + "/users/{id}/credentials/{cred}", (string id, string cred) => { kc.Otp.Remove(id); kc.Calls.Add($"delete credential {cred}"); return Results.NoContent(); });
        app.MapGet(admin + "/attack-detection/brute-force/users/{id}", (string id) => Results.Json(new { disabled = kc.Locked.Contains(id), numFailures = kc.Locked.Contains(id) ? 5 : 0 }));
        app.MapDelete(admin + "/attack-detection/brute-force/users/{id}", (string id) => { kc.Locked.Remove(id); return Results.NoContent(); });
        app.MapPost(admin + "/users/{id}/logout", (string id) => { kc.Calls.Add($"logout {id}"); return Results.NoContent(); });
        app.MapDelete(admin + "/sessions/{id}", (string id) => { kc.Calls.Add($"delete session {id}"); return Results.NoContent(); });
        app.MapPut(admin + "/users/{id}/execute-actions-email", async (string id, HttpRequest r) => { kc.Calls.Add($"actions {id} {await new StreamReader(r.Body).ReadToEndAsync()}"); return Results.NoContent(); });
        app.MapPut(admin + "/users/{id}/send-verify-email", (string id) => { kc.Calls.Add($"verify {id}"); return Results.NoContent(); });
        app.MapGet(admin + "/events", () => kc.Roles.Contains("view-events") ? Results.Json(kc.Events.AsEnumerable().Reverse()) : Results.StatusCode(403));

        await app.StartAsync();
        kc.Url = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First().TrimEnd('/');
        return kc;
    }

    private IEnumerable<JsonObject> Match(string? search) => string.IsNullOrEmpty(search) ? Users
        : Users.Where(u => u.ToJsonString().Contains(search, StringComparison.OrdinalIgnoreCase));

    private JsonObject? Find(string id) => Users.FirstOrDefault(u => u["id"]!.GetValue<string>() == id);

    private static JsonObject User(string id, string email, string? first, string? last, JsonObject? attrs = null) => new()
    {
        ["id"] = id, ["username"] = email, ["email"] = email, ["emailVerified"] = id == "u-ana", ["enabled"] = true, ["firstName"] = first,
        ["lastName"] = last, ["createdTimestamp"] = 1794400000000, ["attributes"] = attrs ?? new JsonObject(),
    };

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();
}
