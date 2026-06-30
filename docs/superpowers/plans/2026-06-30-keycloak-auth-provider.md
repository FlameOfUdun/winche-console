# Keycloak Auth Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mutually-exclusive Keycloak authentication provider (JWT bearer via `Winche.KeycloakClient`) alongside the existing ASP.NET Core Identity mode, with SPA-driven OIDC PKCE login and full delegation of user/role management to Keycloak.

**Architecture:** A `ConsoleAuthProvider` switch on `ConsoleOptions`. In Keycloak mode the backend registers the package's JWT-bearer auth + authorization, re-declares the existing `ConsoleViewer/Member/Admin` policy names over the JwtBearer scheme (so Data/Storage endpoints are untouched), skips all Identity-only endpoints and the auth DB, and the SPA runs an `oidc-client-ts` PKCE flow and sends `Authorization: Bearer` on every call. Identity mode is unchanged. The console uses one dedicated Keycloak client (SPA login + API audience). Config comes from manual code, `IConfiguration`, or both (manual overrides config).

**Tech Stack:** .NET 10, ASP.NET Core, `Winche.KeycloakClient` 1.2.1, `Microsoft.AspNetCore.Authentication.JwtBearer`, React + Vite + TypeScript, `oidc-client-ts`, xUnit, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-keycloak-auth-provider-design.md`

---

## File Structure

**Backend — `src/Winche.Console/`**
- `Options/ConsoleAuthProvider.cs` *(new)* — `Identity | Keycloak` enum.
- `Options/KeycloakOptions.cs` *(new)* — `Server`, `Realm`, `ClientId`, `ClientSecret`, `AdminRole`, `MemberRole`, `ViewerRole`.
- `Options/ConsoleOptions.cs` *(modify)* — add `Provider`, `Keycloak`, `UseKeycloak(...)`.
- `Identity/KeycloakConfigMerge.cs` *(new)* — pure helper: merge host `IConfiguration?` + manual options → effective `IConfiguration`; validate required keys.
- `Identity/KeycloakRoleMap.cs` *(new)* — pure helper: map a set of Keycloak role-claim values → highest canonical console role.
- `Identity/KeycloakRuntime.cs` *(new)* — singleton holding resolved `Authority`, `ClientId`, `Scopes` for the discovery endpoint.
- `Identity/ConsoleKeycloak.cs` *(new)* — `AddConsoleKeycloak`: package auth/z + the three policy names on the JwtBearer scheme + an authenticated-user policy.
- `Api/AuthConfigEndpoints.cs` *(new)* — `GET /api/auth/config`; the Keycloak `GET /api/auth/state`.
- `WincheConsoleExtensions.cs` *(modify)* — two `AddWincheConsole` overloads + shared core w/ provider branch; provider branch in `MapWincheConsole`.
- `Api/AuthEndpoints.cs` *(modify)* — add `provider` + `capabilities` to the Identity `/state` payload.
- `Winche.Console.csproj` *(modify)* — add `Winche.KeycloakClient`.

**Tests — `tests/`**
- `SampleHost/Program.cs` *(modify)* — branch to Keycloak mode on `Console:Provider`.
- `SampleHost/SampleHost.csproj` *(modify)* — add `System.IdentityModel.Tokens.Jwt`.
- `Winche.Console.Tests/KeycloakConsoleAppFactory.cs` *(new)* — boots SampleHost in Keycloak mode + overrides JwtBearer validation for tests.
- `Winche.Console.Tests/KeycloakTokens.cs` *(new)* — mints test bearer tokens.
- `Winche.Console.Tests/KeycloakConfigMergeTests.cs` *(new)* — unit tests for the merge helper.
- `Winche.Console.Tests/KeycloakRoleMapTests.cs` *(new)* — unit tests for role mapping.
- `Winche.Console.Tests/KeycloakModeTests.cs` *(new)* — integration: config endpoint, identity endpoints absent, role gating, state projection.

**SPA — `web/`**
- `package.json` *(modify)* — add `oidc-client-ts`.
- `src/api/types.ts` *(modify)* — `AuthConfig`, `provider`, `capabilities`.
- `src/api/client.ts` *(modify)* — `authConfig()`, bearer-aware `http()`.
- `src/auth/keycloak.ts` *(new)* — `oidc-client-ts` wrapper.
- `src/auth/session.tsx` *(modify)* — bootstrap via `authConfig`.
- `src/auth/AuthGate.tsx` *(modify)* — Keycloak sign-in branch.
- `src/auth/KeycloakCallback.tsx` *(new)* — handles the redirect callback.
- `src/App.tsx` *(modify)* — callback route + capability route guard.
- `src/layout/AppLayout.tsx` *(modify)* — capability-driven nav + logout.

---

## Phase 1 — Backend options & pure helpers

### Task 1: Add the `Winche.KeycloakClient` package reference

**Files:**
- Modify: `src/Winche.Console/Winche.Console.csproj:14-24`

- [ ] **Step 1: Add the package reference**

In the second `<ItemGroup>`, add after the existing `Microsoft.AspNetCore.Identity.EntityFrameworkCore` line:

```xml
    <PackageReference Include="Winche.KeycloakClient" Version="1.2.1" />
```

- [ ] **Step 2: Restore & build to verify it resolves**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded (the package is already in the local NuGet cache).

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Winche.Console.csproj
git commit -m "build: add Winche.KeycloakClient package reference"
```

---

### Task 2: `ConsoleAuthProvider` enum

**Files:**
- Create: `src/Winche.Console/Options/ConsoleAuthProvider.cs`

- [ ] **Step 1: Create the enum**

```csharp
namespace Winche.Console.Options;

/// <summary>Which authentication backend the console uses. Selected per deployment; mutually exclusive.</summary>
public enum ConsoleAuthProvider
{
    /// <summary>Built-in ASP.NET Core Identity (cookie sessions, console-owned user DB). Default.</summary>
    Identity = 0,

    /// <summary>External Keycloak realm (JWT bearer; user/role management delegated to Keycloak).</summary>
    Keycloak = 1,
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Options/ConsoleAuthProvider.cs
git commit -m "feat: add ConsoleAuthProvider enum"
```

---

### Task 3: `KeycloakOptions`

**Files:**
- Create: `src/Winche.Console/Options/KeycloakOptions.cs`

- [ ] **Step 1: Create the options class**

```csharp
namespace Winche.Console.Options;

/// <summary>
/// Keycloak settings for the console's dedicated Keycloak client. Any value left null/empty is taken
/// from the host's <c>Keycloak</c> IConfiguration section instead; values set here override that section.
/// </summary>
public sealed class KeycloakOptions
{
    /// <summary>Keycloak base URL, no trailing slash, e.g. "https://id.example.com". Maps to Keycloak:Server.</summary>
    public string? Server { get; set; }

    /// <summary>Target realm. Maps to Keycloak:Realm.</summary>
    public string? Realm { get; set; }

    /// <summary>The dedicated console client id — used as the SPA's OIDC client and the API audience. Maps to Keycloak:Resource.</summary>
    public string? ClientId { get; set; }

    /// <summary>Optional secret, only if the console client is confidential. Maps to Keycloak:Credentials:Secret.</summary>
    public string? ClientSecret { get; set; }

    /// <summary>Keycloak role name that maps to the console Admin role.</summary>
    public string AdminRole { get; set; } = "Admin";

    /// <summary>Keycloak role name that maps to the console Member role.</summary>
    public string MemberRole { get; set; } = "Member";

    /// <summary>Keycloak role name that maps to the console Viewer role.</summary>
    public string ViewerRole { get; set; } = "Viewer";

    /// <summary>OAuth scopes the SPA requests. Default "openid profile email".</summary>
    public string Scopes { get; set; } = "openid profile email";
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Options/KeycloakOptions.cs
git commit -m "feat: add KeycloakOptions"
```

---

### Task 4: Wire `Provider`, `Keycloak`, and `UseKeycloak` onto `ConsoleOptions`

**Files:**
- Modify: `src/Winche.Console/Options/ConsoleOptions.cs:7-17`

- [ ] **Step 1: Add the provider state and `UseKeycloak`**

Insert after the `ConnectionString` property (line 10) and before the `SeedAdminEmail` property:

```csharp
    /// <summary>Which auth backend to use. Defaults to Identity; set to Keycloak by calling <see cref="UseKeycloak"/>.</summary>
    public ConsoleAuthProvider Provider { get; private set; } = ConsoleAuthProvider.Identity;

    /// <summary>Keycloak settings; only meaningful when <see cref="Provider"/> is Keycloak.</summary>
    public KeycloakOptions Keycloak { get; } = new();

    /// <summary>Switch the console to the Keycloak provider and configure it. ConnectionString/SeedAdmin* are ignored in this mode.</summary>
    public ConsoleOptions UseKeycloak(Action<KeycloakOptions> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        Provider = ConsoleAuthProvider.Keycloak;
        configure(Keycloak);
        return this;
    }
```

The file already has `using ... ;` for `Microsoft.Extensions.DependencyInjection` and `Winche.Console.Email`; `ConsoleAuthProvider` / `KeycloakOptions` are in the same `Winche.Console.Options` namespace, so no new using is needed.

- [ ] **Step 2: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Options/ConsoleOptions.cs
git commit -m "feat: add Provider/Keycloak/UseKeycloak to ConsoleOptions"
```

---

### Task 5: `KeycloakConfigMerge` — effective configuration (TDD)

**Files:**
- Create: `src/Winche.Console/Identity/KeycloakConfigMerge.cs`
- Test: `tests/Winche.Console.Tests/KeycloakConfigMergeTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using Microsoft.Extensions.Configuration;
using Winche.Console.Identity;
using Winche.Console.Options;
using Xunit;

namespace Winche.Console.Tests;

public class KeycloakConfigMergeTests
{
    private static KeycloakOptions Manual(string? server = null, string? realm = null, string? clientId = null, string? secret = null) =>
        new() { Server = server, Realm = realm, ClientId = clientId, ClientSecret = secret };

    [Fact]
    public void Manual_values_populate_package_keys()
    {
        var cfg = KeycloakConfigMerge.Build(null, Manual("https://id.test", "r1", "winche-console", "s3cr3t"));

        Assert.Equal("https://id.test", cfg["Keycloak:Server"]);
        Assert.Equal("r1", cfg["Keycloak:Realm"]);
        Assert.Equal("winche-console", cfg["Keycloak:Resource"]);
        Assert.Equal("s3cr3t", cfg["Keycloak:Credentials:Secret"]);
    }

    [Fact]
    public void Host_config_is_used_as_base_when_manual_is_empty()
    {
        var host = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Keycloak:Server"] = "https://host",
            ["Keycloak:Realm"] = "hostrealm",
            ["Keycloak:Resource"] = "host-client",
        }).Build();

        var cfg = KeycloakConfigMerge.Build(host, Manual());

        Assert.Equal("https://host", cfg["Keycloak:Server"]);
        Assert.Equal("hostrealm", cfg["Keycloak:Realm"]);
        Assert.Equal("host-client", cfg["Keycloak:Resource"]);
    }

    [Fact]
    public void Manual_values_override_host_config()
    {
        var host = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Keycloak:Server"] = "https://host",
            ["Keycloak:Realm"] = "hostrealm",
            ["Keycloak:Resource"] = "host-client",
        }).Build();

        var cfg = KeycloakConfigMerge.Build(host, Manual(clientId: "override-client"));

        Assert.Equal("https://host", cfg["Keycloak:Server"]);   // untouched from host
        Assert.Equal("override-client", cfg["Keycloak:Resource"]); // manual wins
    }

    [Fact]
    public void Throws_when_required_value_missing_from_both_sources()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            KeycloakConfigMerge.Build(null, Manual("https://id.test", "r1", clientId: null)));
        Assert.Contains("ClientId", ex.Message);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj --filter KeycloakConfigMergeTests`
Expected: FAIL — `KeycloakConfigMerge` does not exist (compile error).

- [ ] **Step 3: Implement the helper**

```csharp
using Microsoft.Extensions.Configuration;
using Winche.Console.Options;

namespace Winche.Console.Identity;

/// <summary>
/// Produces the effective <see cref="IConfiguration"/> the Winche.KeycloakClient extensions consume:
/// host config (if any) as the base, with non-empty manual <see cref="KeycloakOptions"/> overlaid on top.
/// </summary>
internal static class KeycloakConfigMerge
{
    public static IConfiguration Build(IConfiguration? hostConfig, KeycloakOptions options)
    {
        var overrides = new Dictionary<string, string?>();
        Add(overrides, "Keycloak:Server", options.Server);
        Add(overrides, "Keycloak:Realm", options.Realm);
        Add(overrides, "Keycloak:Resource", options.ClientId);
        Add(overrides, "Keycloak:Credentials:Secret", options.ClientSecret);

        var builder = new ConfigurationBuilder();
        if (hostConfig is not null) builder.AddConfiguration(hostConfig);
        builder.AddInMemoryCollection(overrides);
        var effective = builder.Build();

        Require(effective, "Keycloak:Server", "Server");
        Require(effective, "Keycloak:Realm", "Realm");
        Require(effective, "Keycloak:Resource", "ClientId");
        return effective;
    }

    private static void Add(IDictionary<string, string?> map, string key, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value)) map[key] = value;
    }

    private static void Require(IConfiguration cfg, string key, string optionName)
    {
        if (string.IsNullOrWhiteSpace(cfg[key]))
            throw new InvalidOperationException(
                $"Keycloak mode requires '{optionName}'. Set it via UseKeycloak(k => k.{optionName} = ...) " +
                $"or provide '{key}' in configuration.");
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj --filter KeycloakConfigMergeTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/Winche.Console/Identity/KeycloakConfigMerge.cs tests/Winche.Console.Tests/KeycloakConfigMergeTests.cs
git commit -m "feat: add KeycloakConfigMerge with manual+config merge and validation"
```

---

### Task 6: `KeycloakRoleMap` — highest canonical role (TDD)

**Files:**
- Create: `src/Winche.Console/Identity/KeycloakRoleMap.cs`
- Test: `tests/Winche.Console.Tests/KeycloakRoleMapTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using Winche.Console.Identity;
using Winche.Console.Options;
using Xunit;

namespace Winche.Console.Tests;

public class KeycloakRoleMapTests
{
    private static readonly KeycloakOptions Defaults = new(); // Admin/Member/Viewer

    [Theory]
    [InlineData(new[] { "Admin" }, "Admin")]
    [InlineData(new[] { "Member" }, "Member")]
    [InlineData(new[] { "Viewer" }, "Viewer")]
    [InlineData(new[] { "Viewer", "Admin" }, "Admin")]   // highest wins
    [InlineData(new[] { "Viewer", "Member" }, "Member")]
    public void Maps_to_highest_canonical_role(string[] roles, string expected) =>
        Assert.Equal(expected, KeycloakRoleMap.HighestRole(roles, Defaults));

    [Fact]
    public void Returns_null_when_no_mapped_role_present() =>
        Assert.Null(KeycloakRoleMap.HighestRole(new[] { "unrelated" }, Defaults));

    [Fact]
    public void Honors_custom_role_names()
    {
        var opts = new KeycloakOptions { AdminRole = "kc-admin", MemberRole = "kc-editor", ViewerRole = "kc-reader" };
        Assert.Equal("Admin", KeycloakRoleMap.HighestRole(new[] { "kc-reader", "kc-admin" }, opts));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj --filter KeycloakRoleMapTests`
Expected: FAIL — `KeycloakRoleMap` does not exist.

- [ ] **Step 3: Implement the helper**

```csharp
using Winche.Console.Options;

namespace Winche.Console.Identity;

/// <summary>Maps Keycloak role-claim values to the highest matching canonical console role.</summary>
internal static class KeycloakRoleMap
{
    /// <summary>Returns "Admin", "Member", "Viewer" (canonical <see cref="ConsoleRoles"/> names), or null if none match.</summary>
    public static string? HighestRole(IEnumerable<string> roleClaims, KeycloakOptions options)
    {
        var roles = new HashSet<string>(roleClaims, StringComparer.Ordinal);
        if (roles.Contains(options.AdminRole)) return ConsoleRoles.Admin;
        if (roles.Contains(options.MemberRole)) return ConsoleRoles.Member;
        if (roles.Contains(options.ViewerRole)) return ConsoleRoles.Viewer;
        return null;
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj --filter KeycloakRoleMapTests`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/Winche.Console/Identity/KeycloakRoleMap.cs tests/Winche.Console.Tests/KeycloakRoleMapTests.cs
git commit -m "feat: add KeycloakRoleMap highest-canonical-role helper"
```

---

## Phase 2 — Backend Keycloak wiring

### Task 7: `KeycloakRuntime` singleton

**Files:**
- Create: `src/Winche.Console/Identity/KeycloakRuntime.cs`

- [ ] **Step 1: Create the runtime holder**

```csharp
namespace Winche.Console.Identity;

/// <summary>Resolved Keycloak values the discovery endpoint advertises to the SPA. Registered as a singleton.</summary>
internal sealed class KeycloakRuntime
{
    public required string Authority { get; init; }
    public required string ClientId { get; init; }
    public required string Scopes { get; init; }
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Identity/KeycloakRuntime.cs
git commit -m "feat: add KeycloakRuntime holder"
```

---

### Task 8: `AddConsoleKeycloak` — registration

**Files:**
- Create: `src/Winche.Console/Identity/ConsoleKeycloak.cs`

This mirrors `Identity/ConsoleAuth.cs` but for the bearer model. It re-declares the **same** three policy names so endpoints that reference `ConsoleRoles.*Policy` work unchanged, plus a `ConsoleKeycloakUser` policy (any authenticated bearer) used by `/api/auth/state`.

- [ ] **Step 1: Create the registration**

```csharp
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Options;
using Winche.KeycloakClient.DependencyInjection;

namespace Winche.Console.Identity;

internal static class ConsoleKeycloak
{
    /// <summary>Authenticated-bearer policy used by /api/auth/state (identity without a console role).</summary>
    public const string AuthenticatedPolicy = "ConsoleKeycloakUser";

    /// <summary>
    /// Registers Winche.KeycloakClient JWT-bearer authentication + authorization, advertises the resolved
    /// authority/client to the discovery endpoint, and re-declares the console role policies over the
    /// JwtBearer scheme using the host-mapped Keycloak role names.
    /// </summary>
    public static IServiceCollection AddConsoleKeycloak(
        this IServiceCollection services, ConsoleOptions options, IConfiguration effectiveConfig)
    {
        services.AddKeycloakClient(effectiveConfig);
        services.AddKeycloakAuthentication(effectiveConfig);
        services.AddKeycloakAuthorization(effectiveConfig);

        var server = effectiveConfig["Keycloak:Server"]!.TrimEnd('/');
        var realm = effectiveConfig["Keycloak:Realm"]!;
        var clientId = effectiveConfig["Keycloak:Resource"]!;
        services.AddSingleton(new KeycloakRuntime
        {
            Authority = $"{server}/realms/{realm}",
            ClientId = clientId,
            Scopes = options.Keycloak.Scopes,
        });

        var k = options.Keycloak;
        services.AddAuthorizationBuilder()
            .AddPolicy(ConsoleRoles.ViewerPolicy, p => p
                .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                .RequireRole(k.ViewerRole, k.MemberRole, k.AdminRole))
            .AddPolicy(ConsoleRoles.MemberPolicy, p => p
                .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                .RequireRole(k.MemberRole, k.AdminRole))
            .AddPolicy(ConsoleRoles.AdminPolicy, p => p
                .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                .RequireRole(k.AdminRole))
            .AddPolicy(AuthenticatedPolicy, p => p
                .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser());

        return services;
    }
}
```

> Note: `AddKeycloakClient` is registered because `AddKeycloakAuthorization`'s UMA handlers may resolve it; it does not force any Admin-API usage. If a build error shows `AddKeycloakClient` requires a delegated-client callback, call the parameterless-config overload `AddKeycloakClient(effectiveConfig)` as written — confirm against the package's `DependencyInjection` extensions surfaced in `Winche.KeycloakClient.dll`.

- [ ] **Step 2: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded. If `AddKeycloakClient`/`AddKeycloakAuthentication`/`AddKeycloakAuthorization` resolve to different signatures, adjust the calls to match the package (they all accept `IConfiguration` per the package README).

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Identity/ConsoleKeycloak.cs
git commit -m "feat: add AddConsoleKeycloak registration with bearer-scheme policies"
```

---

### Task 9: Discovery + Keycloak state endpoints

**Files:**
- Create: `src/Winche.Console/Api/AuthConfigEndpoints.cs`

- [ ] **Step 1: Create the endpoints**

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Winche.Console.Identity;
using Winche.Console.Options;

namespace Winche.Console.Api;

public static class AuthConfigEndpoints
{
    /// <summary>Anonymous bootstrap: tells the SPA how to authenticate, for both providers.</summary>
    public static IEndpointRouteBuilder MapAuthConfigEndpoint(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        app.MapGet("/api/auth/config", (KeycloakRuntime? kc) =>
        {
            if (options.Provider != ConsoleAuthProvider.Keycloak || kc is null)
                return Results.Json(new { provider = "identity" });
            return Results.Json(new { provider = "keycloak", authority = kc.Authority, clientId = kc.ClientId, scopes = kc.Scopes });
        });
        return app;
    }

    /// <summary>Keycloak-mode /api/auth/state: identity + roles projected from the bearer token's claims.</summary>
    public static IEndpointRouteBuilder MapKeycloakStateEndpoint(this IEndpointRouteBuilder app, ConsoleOptions options)
    {
        app.MapGet("/api/auth/state", (HttpContext http) =>
        {
            var user = http.User;
            var roles = user.FindAll(ClaimTypes.Role).Select(c => c.Value);
            var role = KeycloakRoleMap.HighestRole(roles, options.Keycloak);
            return Results.Json(new
            {
                provider = "keycloak",
                initialized = true,
                capabilities = new { manageUsers = false, invites = false, twoFactor = false, changePassword = false, editProfile = false },
                user = new
                {
                    id = user.FindFirstValue("sub"),
                    email = user.FindFirstValue("email"),
                    firstName = user.FindFirstValue("given_name"),
                    lastName = user.FindFirstValue("family_name"),
                    role,
                },
            });
        }).RequireAuthorization(ConsoleKeycloak.AuthenticatedPolicy);
        return app;
    }
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Winche.Console/Api/AuthConfigEndpoints.cs
git commit -m "feat: add /api/auth/config and Keycloak /api/auth/state endpoints"
```

---

### Task 10: Add `provider` + `capabilities` to the Identity `/state` payload

**Files:**
- Modify: `src/Winche.Console/Api/AuthEndpoints.cs:40-62`

- [ ] **Step 1: Add provider/capabilities to both return shapes**

In `MapAuthEndpoints`, the `/state` handler returns two anonymous objects. Update the **no-user** return (currently line 41):

```csharp
            if (principal is null)
                return Results.Json(new { provider = "identity", initialized, selfServiceResetEnabled, capabilities = IdentityCapabilities, user = (object?)null });
```

And update the **no-user-found** return (currently line 45) identically:

```csharp
            if (user is null)
                return Results.Json(new { provider = "identity", initialized, selfServiceResetEnabled, capabilities = IdentityCapabilities, user = (object?)null });
```

And the **success** return (currently starts line 47) — add the two fields at the top of the object:

```csharp
            return Results.Json(new
            {
                provider = "identity",
                initialized,
                selfServiceResetEnabled,
                capabilities = IdentityCapabilities,
                user = new
                {
                    // ...unchanged user projection...
```

- [ ] **Step 2: Add the `IdentityCapabilities` constant**

At the top of the `AuthEndpoints` class body (after the records, near line 23), add:

```csharp
    // In Identity mode the console owns the full lifecycle; manageUsers is role-gated client-side (Admin only).
    private static readonly object IdentityCapabilities = new
    {
        manageUsers = true, invites = true, twoFactor = true, changePassword = true, editProfile = true,
    };
```

- [ ] **Step 3: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add src/Winche.Console/Api/AuthEndpoints.cs
git commit -m "feat: add provider+capabilities to Identity /state payload"
```

---

### Task 11: Provider branch in `AddWincheConsole` + `MapWincheConsole`

**Files:**
- Modify: `src/Winche.Console/WincheConsoleExtensions.cs` (whole file)

- [ ] **Step 1: Add overloads + shared core with the provider branch**

Replace the `AddWincheConsole` method (lines 22-36) with two overloads and a private core. Add `using Microsoft.Extensions.Configuration;` and `using Winche.Console.Api;` to the file's usings.

```csharp
    public static IServiceCollection AddWincheConsole(this IServiceCollection services, Action<ConsoleOptions> configure)
        => services.AddWincheConsoleCore(configuration: null, configure);

    public static IServiceCollection AddWincheConsole(
        this IServiceCollection services, IConfiguration configuration, Action<ConsoleOptions> configure)
        => services.AddWincheConsoleCore(configuration, configure);

    private static IServiceCollection AddWincheConsoleCore(
        this IServiceCollection services, IConfiguration? configuration, Action<ConsoleOptions> configure)
    {
        var options = new ConsoleOptions();
        configure(options);

        services.AddSingleton(options);
        options.EmailSenderRegistration?.Invoke(services);
        services.AddSingleton<ConsolePrefix>();

        if (options.Provider == ConsoleAuthProvider.Keycloak)
        {
            var effective = KeycloakConfigMerge.Build(configuration, options.Keycloak);
            services.AddConsoleKeycloak(options, effective);
            // No auth DB, no migration/seeding hosted service in Keycloak mode.
        }
        else
        {
            if (string.IsNullOrWhiteSpace(options.ConnectionString))
                throw new InvalidOperationException(
                    "AddWincheConsole requires ConsoleOptions.ConnectionString (the console's own auth database).");
            services.AddConsoleIdentity(options);
            services.AddHostedService<ConsoleStartupService>();
        }

        return services;
    }
```

- [ ] **Step 2: Branch `MapWincheConsole` on provider**

Replace the body of `MapWincheConsole` (lines 41-66) so Identity-only groups + the forced-2FA filter are mapped only in Identity mode, while the discovery endpoint, data/storage, and SPA are always mapped:

```csharp
        endpoints.ServiceProvider.GetRequiredService<ConsolePrefix>().Value = prefix;
        var options = endpoints.ServiceProvider.GetRequiredService<ConsoleOptions>();
        var group = endpoints.MapGroup(prefix);

        group.MapAuthConfigEndpoint(options);

        if (options.Provider == ConsoleAuthProvider.Keycloak)
        {
            group.MapKeycloakStateEndpoint(options);
        }
        else
        {
            // Forced two-factor setup gate (Identity only).
            group.AddEndpointFilter(async (ctx, next) =>
            {
                var http = ctx.HttpContext;
                if (http.User.Identity?.IsAuthenticated == true)
                {
                    var users = http.RequestServices.GetRequiredService<UserManager<ConsoleUser>>();
                    var user = await users.GetUserAsync(http.User);
                    if (user is { TwoFactorRequired: true, TwoFactorEnabled: false } && !IsTwoFactorSetupExempt(http.Request.Path))
                        return Results.Json(new { error = "two_factor_setup_required" }, statusCode: StatusCodes.Status403Forbidden);
                }
                return await next(ctx);
            });

            group.MapAuthEndpoints();
            group.MapTwoFactorEndpoints();
            group.MapUserEndpoints();
            group.MapInviteEndpoints();
        }

        group.MapConsoleDataEndpoints();
        group.MapConsoleStorageEndpoints();
        ConsoleSpa.Map(group, prefix);
        return group;
```

> The endpoint filter is added to `group` only in the Identity branch, so it no longer wraps the discovery/data/storage endpoints in Keycloak mode. The `IsTwoFactorSetupExempt` helper and its usings remain unchanged.

- [ ] **Step 3: Build**

Run: `dotnet build src/Winche.Console/Winche.Console.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Run the existing test suite (Identity regression)**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj --filter "FullyQualifiedName!~Keycloak"`
Expected: PASS — all existing Identity-mode tests still green (the `/state` shape gained fields but kept the old ones).

- [ ] **Step 5: Commit**

```bash
git add src/Winche.Console/WincheConsoleExtensions.cs
git commit -m "feat: branch AddWincheConsole/MapWincheConsole on auth provider"
```

---

## Phase 3 — Backend integration tests (Keycloak mode)

### Task 12: Sample host Keycloak branch + JWT test dependency

**Files:**
- Modify: `tests/SampleHost/Program.cs:16`
- Modify: `tests/SampleHost/SampleHost.csproj`

- [ ] **Step 1: Branch the sample host on `Console:Provider`**

Replace line 16 (`builder.Services.AddWincheConsole(o => o.ConnectionString = authConn);`) with:

```csharp
if (string.Equals(builder.Configuration["Console:Provider"], "Keycloak", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddWincheConsole(builder.Configuration, o => o.UseKeycloak(_ => { })); // Keycloak:* comes from config
else
    builder.Services.AddWincheConsole(o => o.ConnectionString = authConn);   // no seed: tests use /setup
```

- [ ] **Step 2: Add the JWT package to the test-support host**

In `tests/SampleHost/SampleHost.csproj`, inside the `<ItemGroup>` with package references, add:

```xml
    <PackageReference Include="System.IdentityModel.Tokens.Jwt" Version="8.14.0" />
```

(Use the version already present transitively; run `dotnet list tests/SampleHost/SampleHost.csproj package --include-transitive | grep IdentityModel.Tokens.Jwt` to confirm and match the resolved version.)

- [ ] **Step 3: Build the test host**

Run: `dotnet build tests/SampleHost/SampleHost.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add tests/SampleHost/Program.cs tests/SampleHost/SampleHost.csproj
git commit -m "test: add Keycloak-mode branch to sample host"
```

---

### Task 13: Test token minting + Keycloak app factory

**Files:**
- Create: `tests/Winche.Console.Tests/KeycloakTokens.cs`
- Create: `tests/Winche.Console.Tests/KeycloakConsoleAppFactory.cs`

The factory boots the sample host in Keycloak mode and **post-configures the JwtBearer options** so tokens are validated against an in-test symmetric key (no live Keycloak). Tokens are minted with the real Keycloak `realm_access.roles` shape; the package flattens them to role claims.

- [ ] **Step 1: Create the token minter**

```csharp
using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;

namespace Winche.Console.Tests;

/// <summary>Mints HS256 bearer tokens for tests, shaped like Keycloak access tokens (realm_access.roles).</summary>
public static class KeycloakTokens
{
    public const string Issuer = "https://kc.test/realms/test";
    public const string Audience = "winche-console";
    // 32+ byte symmetric key shared between the minter and the test JwtBearer config.
    public static readonly SymmetricSecurityKey SigningKey =
        new(System.Text.Encoding.UTF8.GetBytes("winche-console-test-signing-key-0123456789"));

    public static string Mint(string[] realmRoles, string sub = "user-1", string email = "user@test", string given = "Test", string family = "User")
    {
        var creds = new SigningCredentials(SigningKey, SecurityAlgorithms.HmacSha256);
        var now = DateTime.UtcNow;
        var payload = new JwtPayload(Issuer, Audience, claims: new[]
        {
            new System.Security.Claims.Claim("sub", sub),
            new System.Security.Claims.Claim("email", email),
            new System.Security.Claims.Claim("given_name", given),
            new System.Security.Claims.Claim("family_name", family),
        }, notBefore: now, expires: now.AddMinutes(10));
        payload["realm_access"] = new Dictionary<string, object> { ["roles"] = realmRoles };

        var token = new JwtSecurityToken(new JwtHeader(creds), payload);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

- [ ] **Step 2: Create the Keycloak app factory**

```csharp
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Winche.Console.Tests;

/// <summary>Boots the sample host in Keycloak mode and validates bearer tokens against the in-test key.</summary>
public sealed class KeycloakConsoleAppFactory(PostgresFixture fx) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Winche:ConnectionString", fx.ConnectionString);
        builder.UseSetting("Console:Provider", "Keycloak");
        builder.UseSetting("Keycloak:Server", "https://kc.test");
        builder.UseSetting("Keycloak:Realm", "test");
        builder.UseSetting("Keycloak:Resource", KeycloakTokens.Audience);

        builder.ConfigureTestServices(services =>
        {
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o =>
            {
                // No live realm in tests: stop metadata discovery and validate against the symmetric key.
                o.Authority = null;
                o.MetadataAddress = null;
                o.RequireHttpsMetadata = false;
                o.Configuration = new OpenIdConnectConfiguration();
                o.TokenValidationParameters.ValidateIssuerSigningKey = true;
                o.TokenValidationParameters.IssuerSigningKey = KeycloakTokens.SigningKey;
                o.TokenValidationParameters.ValidIssuer = KeycloakTokens.Issuer;
                o.TokenValidationParameters.ValidAudience = KeycloakTokens.Audience;
                o.TokenValidationParameters.ValidateIssuer = true;
                o.TokenValidationParameters.ValidateAudience = true;
                o.TokenValidationParameters.ValidateLifetime = true;
            });
        });
    }
}
```

- [ ] **Step 3: Build the test project**

Run: `dotnet build tests/Winche.Console.Tests/Winche.Console.Tests.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add tests/Winche.Console.Tests/KeycloakTokens.cs tests/Winche.Console.Tests/KeycloakConsoleAppFactory.cs
git commit -m "test: add Keycloak token minter and app factory"
```

---

### Task 14: Keycloak-mode integration tests

**Files:**
- Create: `tests/Winche.Console.Tests/KeycloakModeTests.cs`

- [ ] **Step 1: Write the tests**

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class KeycloakModeTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    private static HttpClient Bearer(KeycloakConsoleAppFactory app, string[] roles)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", KeycloakTokens.Mint(roles));
        return client;
    }

    [Fact]
    public async Task Config_endpoint_advertises_keycloak()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var cfg = await anon.GetFromJsonAsync<Dictionary<string, object>>("/_console/api/auth/config");
        Assert.Equal("keycloak", cfg!["provider"].ToString());
        Assert.Equal("https://kc.test/realms/test", cfg["authority"].ToString());
        Assert.Equal("winche-console", cfg["clientId"].ToString());
    }

    [Fact]
    public async Task Identity_only_endpoints_are_not_mapped()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var login = await anon.PostAsJsonAsync("/_console/api/auth/login", new { email = "x", password = "y" });
        Assert.Equal(HttpStatusCode.NotFound, login.StatusCode);
        var users = await Bearer(app, ["Admin"]).GetAsync("/_console/api/users");
        Assert.Equal(HttpStatusCode.NotFound, users.StatusCode);
    }

    [Fact]
    public async Task State_projects_identity_and_role_from_token()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var client = Bearer(app, ["Member"]);
        var state = await client.GetFromJsonAsync<Dictionary<string, object>>("/_console/api/auth/state");
        Assert.Equal("keycloak", state!["provider"].ToString());
        var user = (System.Text.Json.JsonElement)state["user"];
        Assert.Equal("Member", user.GetProperty("role").GetString());
        Assert.Equal("user@test", user.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Anonymous_data_request_is_unauthorized()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        using var anon = app.CreateClient();
        var resp = await anon.GetAsync("/_console/api/usage");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Viewer_can_read_but_not_write()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        var read = await Bearer(app, ["Viewer"]).GetAsync("/_console/api/usage");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var write = await Bearer(app, ["Viewer"]).PutAsJsonAsync(
            $"/_console/api/data/documents/{B64("users/alice")}",
            new { fields = new { name = new { stringValue = "Alice" } } });
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
    }

    [Fact]
    public async Task Member_can_write()
    {
        using var app = new KeycloakConsoleAppFactory(fx);
        var write = await Bearer(app, ["Member"]).PutAsJsonAsync(
            $"/_console/api/data/documents/{B64("users/bob")}",
            new { fields = new { name = new { stringValue = "Bob" } } });
        Assert.Equal(HttpStatusCode.OK, write.StatusCode);
    }
}
```

- [ ] **Step 2: Run the Keycloak tests**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj --filter KeycloakModeTests`
Expected: PASS (6 tests).

If `State_projects...` or the gating tests fail because role claims are absent, the package is flattening from resource roles only — set `builder.UseSetting("Keycloak:Authentication:RolesSource", "RealmAndResource")` in the factory (it is the documented default, but pin it explicitly).

- [ ] **Step 3: Commit**

```bash
git add tests/Winche.Console.Tests/KeycloakModeTests.cs
git commit -m "test: add Keycloak-mode integration tests (config, gating, state)"
```

---

### Task 15: Full backend regression

- [ ] **Step 1: Run the entire backend suite**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj`
Expected: PASS — both Identity and Keycloak suites green.

- [ ] **Step 2: Commit (only if any fixups were needed)**

```bash
git add -A && git commit -m "test: backend regression green for both providers"
```

---

## Phase 4 — SPA

### Task 16: Add `oidc-client-ts`

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install the dependency**

Run: `cd web && npm install oidc-client-ts@3`
Expected: `oidc-client-ts` added to `dependencies` in `web/package.json`.

- [ ] **Step 2: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "build(web): add oidc-client-ts"
```

---

### Task 17: Types for provider/capabilities/config

**Files:**
- Modify: `web/src/api/types.ts`

- [ ] **Step 1: Add the new types**

Add an `AuthConfig` type and extend `AuthState`. Find the existing `AuthState` interface and add the fields; add `AuthConfig` and `Capabilities` next to it:

```typescript
export type AuthProvider = "identity" | "keycloak";

export interface Capabilities {
  manageUsers: boolean;
  invites: boolean;
  twoFactor: boolean;
  changePassword: boolean;
  editProfile: boolean;
}

export type AuthConfig =
  | { provider: "identity" }
  | { provider: "keycloak"; authority: string; clientId: string; scopes: string };
```

Then add to the existing `AuthState` interface these properties:

```typescript
  provider: AuthProvider;
  capabilities: Capabilities;
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: errors only where `provider`/`capabilities` are now required but not yet supplied (fixed in later tasks) — note them and proceed.

- [ ] **Step 3: Commit**

```bash
git add web/src/api/types.ts
git commit -m "feat(web): add AuthConfig/Capabilities/provider types"
```

---

### Task 18: API client — discovery + bearer support

**Files:**
- Modify: `web/src/api/client.ts:14-30`

- [ ] **Step 1: Add a token provider hook and make `http()` bearer-aware**

Replace the `apiUrl`/`http` block (lines 14-27) with:

```typescript
// All API URLs resolve relative to <base href> (the console prefix injected by the host).
const apiUrl = (rel: string) => new URL(rel, document.baseURI).toString();

// Set by the session bootstrap when the provider is Keycloak; returns the current access token (or null).
let bearerTokenProvider: (() => Promise<string | null>) | null = null;
export function setBearerTokenProvider(fn: (() => Promise<string | null>) | null) {
  bearerTokenProvider = fn;
}

async function http<T>(method: string, rel: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearerTokenProvider) {
    const token = await bearerTokenProvider();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(apiUrl(rel), {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
```

- [ ] **Step 2: Add the `authConfig` call**

In the `api` object (after the `authState` line, ~line 30), add:

```typescript
  authConfig: () => http<import("./types").AuthConfig>("GET", "api/auth/config"),
```

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(web): bearer-aware http client + authConfig discovery"
```

---

### Task 19: `oidc-client-ts` wrapper

**Files:**
- Create: `web/src/auth/keycloak.ts`

- [ ] **Step 1: Create the wrapper**

```typescript
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

let mgr: UserManager | null = null;

/** Initialize the OIDC client from the discovery response. Idempotent. */
export function initKeycloak(cfg: { authority: string; clientId: string; scopes: string }): UserManager {
  if (mgr) return mgr;
  mgr = new UserManager({
    authority: cfg.authority,
    client_id: cfg.clientId,
    redirect_uri: new URL("auth/callback", document.baseURI).toString(),
    post_logout_redirect_uri: document.baseURI,
    response_type: "code",
    scope: cfg.scopes,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
  return mgr;
}

function require_mgr(): UserManager {
  if (!mgr) throw new Error("Keycloak not initialized");
  return mgr;
}

export const keycloakLogin = () => require_mgr().signinRedirect();
export const keycloakLogout = () => require_mgr().signoutRedirect();
export const keycloakCallback = (): Promise<User> => require_mgr().signinRedirectCallback();

/** Current access token, refreshing if the stored user is expired. Null when signed out. */
export async function keycloakAccessToken(): Promise<string | null> {
  const m = require_mgr();
  let user = await m.getUser();
  if (user?.expired) {
    try { user = await m.signinSilent(); } catch { return null; }
  }
  return user?.access_token ?? null;
}

export async function keycloakIsAuthenticated(): Promise<boolean> {
  const user = await require_mgr().getUser();
  return !!user && !user.expired;
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add web/src/auth/keycloak.ts
git commit -m "feat(web): add oidc-client-ts wrapper"
```

---

### Task 20: Session bootstrap via `authConfig`

**Files:**
- Modify: `web/src/auth/session.tsx`

- [ ] **Step 1: Bootstrap the provider before loading state**

Replace the file contents with:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setBearerTokenProvider } from "../api/client";
import type { AuthState, SessionUser } from "../api/types";
import { initKeycloak, keycloakAccessToken, keycloakIsAuthenticated } from "./keycloak";

interface SessionCtx {
  state: AuthState | null;
  user: SessionUser | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ state: null, user: null, refresh: async () => {} });
export const SessionContext = Ctx;
export const useSession = () => useContext(Ctx);

const SIGNED_OUT: AuthState = {
  provider: "keycloak",
  initialized: true,
  capabilities: { manageUsers: false, invites: false, twoFactor: false, changePassword: false, editProfile: false },
  user: null,
} as AuthState;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);

  const refresh = async () => {
    const cfg = await api.authConfig().catch(() => ({ provider: "identity" as const }));
    if (cfg.provider === "keycloak") {
      initKeycloak(cfg);
      setBearerTokenProvider(keycloakAccessToken);
      if (!(await keycloakIsAuthenticated())) {
        setState(SIGNED_OUT);
        return;
      }
    }
    setState(await api.authState().catch(() =>
      cfg.provider === "keycloak"
        ? SIGNED_OUT
        : ({ provider: "identity", initialized: true, selfServiceResetEnabled: false, capabilities: SIGNED_OUT.capabilities, user: null } as AuthState)));
  };

  useEffect(() => { void refresh(); }, []);
  return <Ctx.Provider value={{ state, user: state?.user ?? null, refresh }}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors from this file (downstream files updated next).

- [ ] **Step 3: Commit**

```bash
git add web/src/auth/session.tsx
git commit -m "feat(web): bootstrap auth provider via /api/auth/config"
```

---

### Task 21: Keycloak sign-in branch in `AuthGate`

**Files:**
- Modify: `web/src/auth/AuthGate.tsx`

- [ ] **Step 1: Branch on provider**

Replace the file with:

```tsx
import { Button, Card, Center, Loader, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useSession } from "./session";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { LoginPage } from "../pages/LoginPage";
import { SetupPage } from "../pages/SetupPage";
import { keycloakLogin } from "./keycloak";

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useSession();
  if (!state) return <Center h="100vh"><Loader /></Center>;

  if (state.provider === "keycloak") {
    if (!state.user) {
      return (
        <Center h="100vh" bg="#f6f8fb">
          <Card withBorder shadow="sm" radius="md" p="xl" w={420}>
            <Stack>
              <Text fw={600} size="lg">Winche Console</Text>
              <Text c="dimmed" size="sm">Sign in with your organization account.</Text>
              <Button onClick={() => void keycloakLogin()}>Sign in with Keycloak</Button>
            </Stack>
          </Card>
        </Center>
      );
    }
    return <>{children}</>;
  }

  // Identity provider (unchanged behavior).
  if (!state.initialized) return <SetupPage />;
  if (!state.user) return <LoginPage />;
  if (state.user.mustSetupTwoFactor) {
    return (
      <Center h="100vh" bg="#f6f8fb">
        <Card withBorder shadow="sm" radius="md" p="xl" w={420}>
          <TwoFactorSetup forced onDone={refresh} />
        </Card>
      </Center>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add web/src/auth/AuthGate.tsx
git commit -m "feat(web): Keycloak sign-in branch in AuthGate"
```

---

### Task 22: Callback route + capability route guard

**Files:**
- Create: `web/src/auth/KeycloakCallback.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create the callback component**

```tsx
import { Center, Loader } from "@mantine/core";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { keycloakCallback } from "./keycloak";
import { useSession } from "./session";

/** Handles the OIDC redirect: completes the code exchange, refreshes session, returns to the app root. */
export function KeycloakCallback() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  useEffect(() => {
    (async () => {
      try { await keycloakCallback(); } catch { /* fall through to gate */ }
      await refresh();
      navigate("/data", { replace: true });
    })();
  }, [navigate, refresh]);
  return <Center h="100vh"><Loader /></Center>;
}
```

- [ ] **Step 2: Wire the route + capability guard in `App.tsx`**

Replace `App.tsx` with:

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthGate } from "./auth/AuthGate";
import { KeycloakCallback } from "./auth/KeycloakCallback";
import { useSession } from "./auth/session";
import { AppLayout } from "./layout/AppLayout";
import { DataBrowserPage } from "./pages/DataBrowserPage";
import { StorageBrowserPage } from "./pages/StorageBrowserPage";
import { UsersPage } from "./pages/UsersPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";

export function App() {
  return (
    <Routes>
      {/* Anonymous, outside the auth gate. */}
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="invite" element={<AcceptInvitePage />} />
      <Route path="auth/callback" element={<KeycloakCallback />} />
      <Route path="*" element={<GatedApp />} />
    </Routes>
  );
}

function GatedApp() {
  const { state } = useSession();
  const canManageUsers = state?.capabilities?.manageUsers ?? false;
  return (
    <AuthGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="data" replace />} />
          <Route path="data" element={<DataBrowserPage />} />
          <Route path="storage" element={<StorageBrowserPage />} />
          <Route path="users" element={canManageUsers ? <UsersPage /> : <Navigate to="/data" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
```

> Note: in Identity mode `manageUsers` is `true` for everyone in the `/state` payload, so the Admin-only restriction must stay enforced by the nav/role check that already exists in `AppLayout` (next task) and server-side by the `ConsoleAdmin` policy on `/api/users`. The route guard here only hides the page when the capability is entirely absent (Keycloak mode). Keep server-side enforcement as the source of truth.

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/auth/KeycloakCallback.tsx web/src/App.tsx
git commit -m "feat(web): OIDC callback route + capability route guard"
```

---

### Task 23: Capability-driven nav + Keycloak logout

**Files:**
- Modify: `web/src/layout/AppLayout.tsx`

- [ ] **Step 1: Read the current `AppLayout`**

Run: `sed -n '1,200p' web/src/layout/AppLayout.tsx` (read it; it renders the nav, the Users link, profile/password UI, and a logout action).

- [ ] **Step 2: Gate the Users nav item, profile/password UI, and logout**

Apply these changes (anchor to what you find in step 1):

1. Import session + keycloak logout:
```tsx
import { useSession } from "../auth/session";
import { keycloakLogout } from "../auth/keycloak";
import { api } from "../api/client";
```
2. Compute capabilities + provider near the top of the component:
```tsx
const { state, user } = useSession();
const caps = state?.capabilities;
const isKeycloak = state?.provider === "keycloak";
```
3. Show the **Users** nav link only when `caps?.manageUsers && user?.role === "Admin"` (Identity Admins) — i.e. replace the existing Users-link condition with `caps?.manageUsers && user?.role === "Admin"`. In Keycloak mode `manageUsers` is false, so it hides.
4. Render the profile-name editor only when `caps?.editProfile`, and the change-password UI only when `caps?.changePassword`.
5. Logout handler becomes provider-aware:
```tsx
const onLogout = async () => {
  if (isKeycloak) { await keycloakLogout(); return; }
  await api.logout();
  window.location.assign(document.baseURI);
};
```
Use `onLogout` wherever the existing logout button's handler is wired.

- [ ] **Step 3: Type-check + build the SPA**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: type-check clean; Vite build succeeds (this also refreshes the embedded `wwwroot` assets).

- [ ] **Step 4: Commit**

```bash
git add web/src/layout/AppLayout.tsx src/Winche.Console/wwwroot
git commit -m "feat(web): capability-driven nav and provider-aware logout"
```

---

### Task 24: SPA tests for the provider branch

**Files:**
- Create: `web/src/auth/__tests__/AuthGate.keycloak.test.tsx`

- [ ] **Step 1: Read an existing SPA test for the harness pattern**

Run: `sed -n '1,80p' web/src/pages/__tests__/AcceptInvitePage.test.tsx` (mirror its render/mock setup and `vi.mock` style).

- [ ] **Step 2: Write the test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { AuthGate } from "../AuthGate";
import { SessionContext } from "../session";
import type { AuthState } from "../../api/types";

vi.mock("../keycloak", () => ({ keycloakLogin: vi.fn(), keycloakLogout: vi.fn() }));

function renderWithState(state: AuthState | null) {
  return render(
    <MantineProvider>
      <SessionContext.Provider value={{ state, user: state?.user ?? null, refresh: vi.fn() }}>
        <AuthGate><div>PROTECTED</div></AuthGate>
      </SessionContext.Provider>
    </MantineProvider>
  );
}

const keycloakSignedOut: AuthState = {
  provider: "keycloak",
  initialized: true,
  capabilities: { manageUsers: false, invites: false, twoFactor: false, changePassword: false, editProfile: false },
  user: null,
} as AuthState;

describe("AuthGate (Keycloak)", () => {
  it("shows the Keycloak sign-in button when signed out", () => {
    renderWithState(keycloakSignedOut);
    expect(screen.getByText("Sign in with Keycloak")).toBeInTheDocument();
    expect(screen.queryByText("PROTECTED")).not.toBeInTheDocument();
  });

  it("renders protected content when a Keycloak user is present", () => {
    renderWithState({ ...keycloakSignedOut, user: { id: "u1", email: "a@b", role: "Member" } } as AuthState);
    expect(screen.getByText("PROTECTED")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the SPA tests**

Run: `cd web && npm test -- --run`
Expected: PASS — new Keycloak tests green and existing SPA tests still green.

- [ ] **Step 4: Commit**

```bash
git add web/src/auth/__tests__/AuthGate.keycloak.test.tsx
git commit -m "test(web): AuthGate Keycloak sign-in branch"
```

---

## Phase 5 — Documentation

### Task 25: README — Keycloak mode

**Files:**
- Modify: `README.md` (the repo or `src/Winche.Console` README — match where the existing usage docs live; search for `AddWincheConsole`).

- [ ] **Step 1: Find the existing usage section**

Run: `grep -rn "AddWincheConsole" README.md src/Winche.Console/README.md 2>/dev/null`

- [ ] **Step 2: Add a "Keycloak provider" section**

Add documentation covering:

````markdown
## Using Keycloak instead of built-in Identity

The console can delegate all authentication to an existing Keycloak realm. In this mode it
holds no user database — Keycloak owns login, MFA, password reset, and user/role management.

```csharp
// Config-driven (reads the standard `Keycloak` section), with code overrides:
builder.Services.AddWincheConsole(builder.Configuration, o => o.UseKeycloak(k =>
{
    k.ClientId   = "winche-console"; // the console's dedicated Keycloak client
    k.AdminRole  = "Admin";          // Keycloak role names → console roles (defaults shown)
    k.MemberRole = "Member";
    k.ViewerRole = "Viewer";
}));

// …or entirely in code (no IConfiguration):
builder.Services.AddWincheConsole(o => o.UseKeycloak(k =>
{
    k.Server = "https://id.example.com";
    k.Realm = "myrealm";
    k.ClientId = "winche-console";
}));
```

In your realm:

1. Create **one dedicated client** for the console (separate from your app's own client) with the
   console URL (e.g. `https://yourapp/_console/auth/callback`) in **Valid Redirect URIs** and the
   origin in **Web Origins**. A public client (PKCE) is sufficient; set `ClientSecret` only if you
   make it confidential.
2. Add an **Audience** protocol mapper on that client so access tokens include it in `aud`.
3. Define realm roles `Admin` / `Member` / `Viewer` (or your mapped names) and assign them.

`ConnectionString`, `SeedAdmin*`, invites, 2FA, and the user-management screens do not apply in
Keycloak mode.
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the Keycloak auth provider"
```

---

## Phase 6 — Final verification & version bump

### Task 26: Full build + test sweep

- [ ] **Step 1: Backend**

Run: `dotnet test tests/Winche.Console.Tests/Winche.Console.Tests.csproj`
Expected: PASS (all Identity + Keycloak tests).

- [ ] **Step 2: SPA**

Run: `cd web && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: type-check clean, tests pass, build succeeds.

- [ ] **Step 3: Bump the package version**

Per the repo convention (recent commits bump versions), bump the console package version (minor) in `src/Winche.Console/Winche.Console.csproj` if a `<Version>`/`<PackageVersion>` is present, or wherever the project tracks it (check the recent "bump to 1.3.0" commit for the exact location). Set to the next minor (e.g. `1.4.0`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: Keycloak auth provider; bump to 1.4.0"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** provider switch (Tasks 2,4,11), one-client model + manual/config merge (Tasks 3,5,11), bearer policies reusing policy names (Task 8), discovery endpoint (Task 9), Keycloak/Identity `/state` shapes (Tasks 9,10), endpoint omission in Keycloak mode (Task 11), no-DB startup (Task 11), SPA PKCE + bearer + capability UI (Tasks 16-23), host realm docs (Task 25), tests (Tasks 5,6,14,24).
- **Riskiest task:** Task 13/14 — the JwtBearer post-config + token mint. If the package validates roles via `OnTokenValidated` reading `realm_access.roles`, the minted token's shape matches and gating works. If gating fails, pin `Keycloak:Authentication:RolesSource=RealmAndResource` and confirm role claim type via a debug assertion on `/api/auth/state` before adjusting.
- **Type consistency:** policy names come from `ConsoleRoles.*Policy` (unchanged) in both providers; `KeycloakRoleMap.HighestRole` returns canonical `ConsoleRoles` names; SPA `AuthState.provider`/`capabilities` are set by every code path that builds an `AuthState`.
