# Keycloak Auth Provider for Winche.Console

**Date:** 2026-06-30
**Status:** Approved design — ready for implementation planning

## Summary

Winche.Console currently bakes in ASP.NET Core Identity as its only authentication
mechanism: a self-contained auth realm (cookie sessions, its own Postgres user DB,
plus built-in 2FA, invites, password reset, and user CRUD). This spec adds a second,
mutually-exclusive **Keycloak** provider so a host can delegate all identity to an
existing Keycloak realm.

The integration uses the **`Winche.KeycloakClient`** NuGet package (v1.2.x), which is a
**JWT bearer-token** integration (it depends on `Microsoft.AspNetCore.Authentication.JwtBearer`).
This dictates the architecture:

- The **SPA** becomes the OIDC client. It runs the Authorization Code + PKCE redirect
  to Keycloak, obtains an **access token**, and sends it as `Authorization: Bearer <token>`
  on every API call.
- The **backend** only validates that token (`AddKeycloakAuthentication`) and flattens
  Keycloak realm/resource roles into `ClaimTypes.Role` (`AddKeycloakAuthorization`).
- No server cookie and **no database** in Keycloak mode — the provider is fully stateless.

The two providers are selected per deployment and never run simultaneously. **Identity
mode is unchanged**; existing hosts need zero changes.

## Decisions (from brainstorming)

1. **Login flow:** OIDC redirect to Keycloak's own login page (Authorization Code + PKCE),
   driven from the SPA as a public client.
2. **User & role management:** Fully delegated to Keycloak. In Keycloak mode the console
   does **not** expose its own user-management, invites, 2FA, or password endpoints/UI.
   The package's Admin-API client (`AddKeycloakClient`) is **not** used.
3. **Role mapping:** Configurable. Host maps Keycloak role names → the console's
   `Admin`/`Member`/`Viewer`. Defaults to roles literally named `Admin`/`Member`/`Viewer`.
4. **Database:** None in Keycloak mode. Identity mode keeps using Postgres exactly as today.
5. **OIDC client library (SPA):** `oidc-client-ts`.
6. **SPA bootstrap:** a new anonymous `GET /api/auth/config` discovery endpoint.

## Architecture

### Provider selection

A new `ConsoleAuthProvider` enum (`Identity` | `Keycloak`) on `ConsoleOptions`, defaulting
to `Identity`. The provider is chosen by calling `o.UseKeycloak(...)`; if it is never called,
the console behaves exactly as today.

#### One dedicated console client

The console uses **one Keycloak client of its own**, separate from the consumer (host) app's
client. That single console client serves both roles:

- the **SPA's** OIDC public client (Authorization Code + PKCE login), and
- the **API's** expected audience for bearer validation.

So there is no separate "SPA client id" vs "API resource id" — `ClientId` is both. The host
adds an **Audience** protocol mapper on this client so issued access tokens carry it in `aud`
(required because the package's `ValidateAudience` defaults to `true`). The consumer app keeps
its own, unrelated client.

#### Configuration: manual or IConfiguration (both supported)

`KeycloakOptions` (set via `UseKeycloak`) carries the full settings so a host can configure
**entirely in code**:

```csharp
services.AddWincheConsole(o =>
{
    o.UseKeycloak(k =>
    {
        k.Server     = "https://id.example.com"; // optional if provided via IConfiguration
        k.Realm      = "myrealm";
        k.ClientId   = "winche-console";          // the dedicated console client (SPA + audience)
        k.ClientSecret = "...";                   // optional; only if the console client is confidential
        k.AdminRole  = "Admin";                   // Keycloak role name → console Admin (default "Admin")
        k.MemberRole = "Member";
        k.ViewerRole = "Viewer";
    });
});
```

Or a host can rely on the **standard `Keycloak` `IConfiguration` section** that
`Winche.KeycloakClient` already binds (`Keycloak:Server`, `Keycloak:Realm`, `Keycloak:Resource`,
`Keycloak:Authentication:*`, …) and pass it in:

```csharp
services.AddWincheConsole(builder.Configuration, o => o.UseKeycloak(k => { /* overrides only */ }));
```

**Resolution rule (merge):** the package extensions consume an `IConfiguration`. We build the
effective config as the host's `IConfiguration` (if supplied) as the **base**, with any values
set manually on `KeycloakOptions` overlaid **on top** (manual wins). Mapping of our option
names → the package's keys: `ClientId` → `Keycloak:Resource` *(and advertised to the SPA as its
client id)*, `Server`/`Realm`/`ClientSecret` → `Keycloak:Server`/`Keycloak:Realm`/
`Keycloak:Credentials:Secret`. The overlay is produced with
`ConfigurationBuilder().AddConfiguration(hostConfig?).AddInMemoryCollection(manualPairs).Build()`.
If neither source supplies a required value (`Server`, `Realm`, `ClientId`), throw a clear
`InvalidOperationException` at registration.

#### Provider branch in `AddWincheConsole`

Two overloads, both delegating to a shared core that takes an optional `IConfiguration?`:

- `AddWincheConsole(this IServiceCollection, Action<ConsoleOptions>)` — manual-only path
  (`IConfiguration` is null; Keycloak settings must come from `UseKeycloak`).
- `AddWincheConsole(this IServiceCollection, IConfiguration, Action<ConsoleOptions>)` — config
  base path (host section + manual overrides).

The core branches on the selected provider:

- **Identity provider** (default): current behavior — require `ConnectionString`, call
  `AddConsoleIdentity(options)`, register `ConsoleStartupService`.
- **Keycloak provider**: do **not** require `ConnectionString`; build the effective Keycloak
  `IConfiguration` (merge above) and call a new `AddConsoleKeycloak(options, effectiveConfig)`;
  do **not** register the DB-migrating startup service.

### Backend wiring — new `Identity/ConsoleKeycloak.cs`

Mirrors the shape of `Identity/ConsoleAuth.cs` but for the bearer model:

```csharp
internal static IServiceCollection AddConsoleKeycloak(
    this IServiceCollection services, ConsoleOptions options, IConfiguration config)
{
    services.AddKeycloakAuthentication(config);   // JWT bearer; validates realm tokens
    services.AddKeycloakAuthorization(config);    // flattens realm/resource roles → ClaimTypes.Role

    // Re-declare the SAME three policy names, now over the JwtBearer scheme and the
    // host-mapped Keycloak role names. Endpoints that use ConsoleRoles.*Policy are untouched.
    services.AddAuthorizationBuilder()
        .AddPolicy(ConsoleRoles.ViewerPolicy, p => p
            .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
            .RequireRole(options.Keycloak.ViewerRole, options.Keycloak.MemberRole, options.Keycloak.AdminRole))
        .AddPolicy(ConsoleRoles.MemberPolicy, p => p
            .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
            .RequireRole(options.Keycloak.MemberRole, options.Keycloak.AdminRole))
        .AddPolicy(ConsoleRoles.AdminPolicy, p => p
            .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
            .RequireRole(options.Keycloak.AdminRole));

    return services;
}
```

Key property: **the policy names (`ConsoleViewer`/`ConsoleMember`/`ConsoleAdmin`) are
identical across providers**, so every Data and Storage endpoint — which only references
those policy names — works unchanged. Only the scheme and role-claim sources differ.

The package flattens both realm and resource roles into `ClaimTypes.Role` (per its
`RolesSource` config, default `RealmAndResource`), so `RequireRole(...)` over the mapped
names is sufficient. Mapping is name-based: the host configures their Keycloak realm to
emit roles named per `AdminRole`/`MemberRole`/`ViewerRole` (defaulting to
`Admin`/`Member`/`Viewer`).

### Endpoint mapping — `MapWincheConsole`

`MapWincheConsole` branches on provider:

**Always mapped (both providers):**
- New `GET /api/auth/config` (anonymous) — the SPA bootstrap (see below).
- `GET /api/auth/state` — current identity + capability flags.
- `MapConsoleDataEndpoints()`, `MapConsoleStorageEndpoints()`, `ConsoleSpa.Map(...)`.

**Identity provider only (current behavior, unchanged):**
- The forced-2FA-setup endpoint filter.
- `MapAuthEndpoints()` (setup/login/2fa/password/forgot/reset/logout/profile),
  `MapTwoFactorEndpoints()`, `MapUserEndpoints()`, `MapInviteEndpoints()`.

**Keycloak provider:** none of the Identity-only groups are mapped. The forced-2FA filter
is also skipped (Keycloak owns MFA). Logout is client-side (the SPA clears its token and
redirects to Keycloak's end-session endpoint); no server logout endpoint is required.

### `GET /api/auth/config` (new, anonymous, both providers)

The SPA's first call. Tells the SPA how to authenticate before it has any session.

- Identity: `{ "provider": "identity" }`
- Keycloak: `{ "provider": "keycloak", "authority": "<Server>/realms/<Realm>", "clientId": "<ClientId>", "scopes": "openid profile email" }`

`authority` and `clientId` are derived server-side from the bound `Keycloak` config plus
`UseKeycloak`'s `ClientId`. No secrets are returned (the SPA is a public PKCE client).

### `GET /api/auth/state` (mode-aware)

- **Identity:** unchanged — reads the console cookie, returns
  `{ initialized, selfServiceResetEnabled, user }`.
- **Keycloak:** requires the bearer token (the SPA only calls it after login). Returns the
  user projected from token claims plus capability flags:
  ```json
  {
    "provider": "keycloak",
    "initialized": true,
    "capabilities": { "manageUsers": false, "invites": false, "twoFactor": false, "changePassword": false, "editProfile": false },
    "user": { "id": "<sub>", "email": "<email>", "firstName": "<given_name>", "lastName": "<family_name>", "role": "<highest mapped role>" }
  }
  ```
  `id` ← `sub`, `email` ← `email`, names ← `given_name`/`family_name`, `role` ← the highest
  of the mapped roles present in `ClaimTypes.Role`. The package preserves original OIDC claim
  names (`sub`, `email`, `preferred_username`) on the principal, so these reads are direct.

  Identity-mode `state` also gains a `"provider": "identity"` field and a `capabilities`
  object (all true) so the SPA has one uniform shape to branch on.

### Startup

No `ConsoleStartupService` is registered in Keycloak mode (nothing to migrate or seed).
Identity mode is unchanged.

## SPA changes (`web/`)

### Bootstrap & provider branch

- `SessionProvider` first calls `api.authConfig()` → `/api/auth/config`. The returned
  `provider` drives everything downstream.
- New module `web/src/auth/keycloak.ts` wraps `oidc-client-ts`'s `UserManager`, configured
  from the discovery response (`authority`, `clientId`, `redirect_uri` = the console prefix
  callback route, `response_type=code`, PKCE on, `scope` from config, in-memory user store,
  silent renew).

### Auth flow

- **Identity provider:** the existing flow is untouched — `AuthGate` renders
  `SetupPage`/`LoginPage`/`TwoFactorSetup`, cookie session via `api.authState()`.
- **Keycloak provider:**
  - `AuthGate` (Keycloak branch): if no token, render a minimal page with a
    **"Sign in with Keycloak"** button that calls `signinRedirect()`. The current
    email/password `LoginPage`, `SetupPage`, 2FA, forgot/reset pages are not used.
  - New callback route (e.g. `/auth/callback`) handles `signinRedirectCallback()`, then
    loads `/api/auth/state` and proceeds into `GatedApp`.
  - Logout calls `signoutRedirect()` (Keycloak end-session), no server round-trip.

### API client (`web/src/api/client.ts`)

`http<T>()` becomes auth-aware:
- Identity: `credentials: "same-origin"` (cookie), as today.
- Keycloak: attach `Authorization: Bearer <access_token>` from the `oidc-client-ts`
  `UserManager` (refreshing if near expiry). On `401`, trigger `signinRedirect()`.

A small accessor (set once the provider is known) lets the non-React `api` module read the
current token without importing React context.

### Navigation & screens

Driven by `state.capabilities`:
- **Users** nav item and `/users` route: shown only when `capabilities.manageUsers` (Admin
  in Identity mode; always false in Keycloak mode → hidden).
- Profile name editing and change-password UI: hidden/read-only when the corresponding
  capability is false (Keycloak owns them).
- Invite acceptance / forgot / reset routes: Identity-only; effectively dead in Keycloak
  mode (the endpoints aren't mapped, and the SPA never links to them).

The existing `user?.role === "Admin"` route guard in `App.tsx` is replaced by the
capability flag so it works identically under both providers.

## Host's Keycloak setup (documentation deliverable)

For the README / docs, the host must, in their realm:

1. Create **one dedicated console client** (separate from the consumer app's client), with
   the console's callback URL in **Valid Redirect URIs** and **Web Origins**. It is used as
   both the SPA's PKCE login client and the API's audience. Its id is the `ClientId` passed to
   `UseKeycloak` (= `Keycloak:Resource`). A public client (no secret) is sufficient for the
   PKCE SPA flow; a confidential client is also supported via `ClientSecret`.
2. Add an **Audience** protocol mapper on that client so issued access tokens include it in
   `aud`. Required because `Authentication.ValidateAudience` defaults to `true`.
3. Define realm (or resource) roles named per the `AdminRole`/`MemberRole`/`ViewerRole`
   mapping and assign them to users.

Pure bearer-token validation needs only the realm's JWKS; a client secret is required only
if the host makes the console client confidential. The package's service-account / Admin-API
flow is **not** used by this design.

## Out of scope (YAGNI)

- Proxying Keycloak's Admin API from the console (rejected: full delegation).
- Mirroring users / console-local user data keyed by Keycloak `sub` (rejected: stateless).
- Mixing both providers in one deployment.
- Cookie-bridging the OIDC login server-side (the package is bearer-based; the SPA holds
  the token).

## Testing strategy

- **Backend unit/integration:**
  - `AddWincheConsole` provider branch: Keycloak mode does not require `ConnectionString`,
    does not register `ConsoleIdentityDbContext` or `ConsoleStartupService`, and does
    register the JwtBearer-scheme policies.
  - `/api/auth/config` returns the correct shape for each provider.
  - `/api/auth/state` (Keycloak) projects claims and computes the highest mapped role;
    capability flags are all false.
  - Policy authorization: a bearer token carrying the mapped Admin/Member/Viewer role
    satisfies `ConsoleAdmin`/`ConsoleMember`/`ConsoleViewer` respectively; a token without
    the role is 403. (Use a test JWT signed by a test key / mocked JwtBearer options.)
  - Identity-mode regression: existing endpoints and tests pass unchanged.
- **SPA:**
  - `authConfig` provider branch renders the Keycloak sign-in button vs the Identity login.
  - API client attaches the bearer header in Keycloak mode and falls back to cookies in
    Identity mode.
  - Capability-driven nav hides Users/profile/password in Keycloak mode.
  - Existing Identity-mode SPA tests pass unchanged.

## Affected files (anticipated)

**Backend**
- `Options/ConsoleOptions.cs` — add `ConsoleAuthProvider Provider`, nested
  `KeycloakOptions Keycloak`, and `UseKeycloak(Action<KeycloakOptions>)`.
- `Options/KeycloakOptions.cs` *(new)* — `Server`, `Realm`, `ClientId`, `ClientSecret`,
  `AdminRole`, `MemberRole`, `ViewerRole` (role names default to `Admin`/`Member`/`Viewer`).
- `Options/ConsoleAuthProvider.cs` *(new)* — `Identity` | `Keycloak` enum.
- `WincheConsoleExtensions.cs` — two `AddWincheConsole` overloads (manual + `IConfiguration`)
  over a shared core; provider branch + effective-config merge; provider branch in
  `MapWincheConsole`; map `/api/auth/config`.
- `Identity/ConsoleKeycloak.cs` *(new)* — `AddConsoleKeycloak`, bearer-scheme policies.
- `Api/AuthEndpoints.cs` (or a new `Api/AuthConfigEndpoints.cs`) — `/api/auth/config`;
  mode-aware `/api/auth/state`.
- `Winche.Console.csproj` — add `Winche.KeycloakClient` package reference.

**SPA**
- `web/package.json` — add `oidc-client-ts`.
- `web/src/auth/keycloak.ts` *(new)*, `web/src/auth/session.tsx`, `web/src/auth/AuthGate.tsx`,
  `web/src/App.tsx` (callback route + capability guard), `web/src/api/client.ts`,
  `web/src/api/types.ts` (provider + capabilities on `AuthState`), `web/src/layout/AppLayout.tsx`.

**Docs**
- README — Keycloak mode setup (realm clients, audience mapper, roles).
