# Keycloak Auth Provider for Winche.Console

**Date:** 2026-06-30
**Status:** Approved design — ready for implementation planning

## Summary

Winche.Console currently bakes in ASP.NET Core Identity as its only authentication
mechanism: a self-contained auth realm (cookie sessions, its own Postgres user DB,
plus built-in 2FA, invites, password reset, and user CRUD). This spec adds a second,
mutually-exclusive **Keycloak** provider so a host can delegate all identity to an
existing Keycloak realm.

The integration is **JWT bearer-token** based, and the console registers its **own,
isolated** authentication scheme dedicated to its own Keycloak client:

- The **SPA** becomes the OIDC client. It runs the Authorization Code + PKCE redirect
  to Keycloak, obtains an **access token**, and sends it as `Authorization: Bearer <token>`
  on every API call.
- The **backend** registers a dedicated, named JWT-bearer scheme (`"WincheConsoleKeycloak"`)
  bound to the console's own client, validates the token against it, and flattens Keycloak
  realm/resource roles into `ClaimTypes.Role`.
- No server cookie and **no database** in Keycloak mode — the provider is fully stateless.

**Why the console owns its scheme (and does *not* use `Winche.KeycloakClient`).** The
consumer (host) app most likely already uses `Winche.KeycloakClient` for its *own* auth.
That package has no scheme-name overload: `AddKeycloakAuthentication` always registers the
standard `Bearer` scheme and binds a single global `KeycloakClientOptions`. Calling it again
from the console would **collide on the scheme and overwrite the host's options**. To stay
fully independent of the consumer's Keycloak DI — a dedicated console client, separate scheme,
separate options — the console **hand-rolls** a JWT-bearer scheme via
`AddAuthentication().AddJwtBearer("WincheConsoleKeycloak", …)` plus a ~25-line role-flatten,
and does **not** reference `Winche.KeycloakClient`. Consumer tokens (audience = consumer
client, validated by `Bearer`) and console tokens (audience = console client, validated by
`WincheConsoleKeycloak`) never cross.

The two providers are selected per deployment and never run simultaneously. **Identity
mode is unchanged**; existing hosts need zero changes.

## Decisions (from brainstorming)

1. **Login flow:** OIDC redirect to Keycloak's own login page (Authorization Code + PKCE),
   driven from the SPA as a public client.
2. **User & role management:** Fully delegated to Keycloak. In Keycloak mode the console
   does **not** expose its own user-management, invites, 2FA, or password endpoints/UI.
3. **Role mapping:** Configurable. Host maps Keycloak role names → the console's
   `Admin`/`Member`/`Viewer`. Defaults to roles literally named `Admin`/`Member`/`Viewer`.
4. **Database:** None in Keycloak mode. Identity mode keeps using Postgres exactly as today.
5. **OIDC client library (SPA):** `oidc-client-ts`.
6. **SPA bootstrap:** a new anonymous `GET /api/auth/config` discovery endpoint.
7. **Isolation:** The console owns a dedicated Keycloak client and a dedicated, named
   JWT-bearer scheme, fully independent of the consumer app's Keycloak DI. The console does
   **not** use `Winche.KeycloakClient` (it can't register a second isolated scheme); it
   hand-rolls its JWT-bearer scheme and role flattening.

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
(the console's JWT-bearer scheme validates `Audience == ClientId`). The consumer app keeps
its own, unrelated client and its own `Bearer` scheme; the two never interact.

#### Configuration: explicit in code only (no IConfiguration)

`KeycloakOptions` (set via `UseKeycloak`) carries the full settings; the host **must configure
them explicitly in code**. The console does **not** read any `IConfiguration` section — there is
a single `AddWincheConsole(IServiceCollection, Action<ConsoleOptions>)` entry point. (If the host
keeps its values in config, *it* reads them and passes them in — see the sample.)

```csharp
services.AddWincheConsole(o => o.UseKeycloak(k =>
{
    k.Server     = "https://id.example.com"; // required
    k.Realm      = "myrealm";                 // required
    k.ClientId   = "winche-console";          // required — the dedicated console client (SPA + audience)
    k.ClientSecret = "...";                   // optional; only if the console client is confidential
    k.AdminRole  = "Admin";                   // Keycloak role name → console Admin (default "Admin")
    k.MemberRole = "Member";
    k.ViewerRole = "Viewer";
    k.RequireHttpsMetadata = true;            // default true; set false only for http dev (e.g. local Keycloak)
}));
```

These are the **console's own** settings (its dedicated client), held in the console's own
options instance — they do not touch, share, or depend on any `KeycloakClientOptions` the
consumer app may have registered. `AddConsoleKeycloak` validates that `Server`, `Realm`, and
`ClientId` are non-empty and throws a clear `InvalidOperationException` otherwise.

#### Provider branch in `AddWincheConsole`

A single `AddWincheConsole(this IServiceCollection, Action<ConsoleOptions>)` branches on the
selected provider:

- **Identity provider** (default): current behavior — require `ConnectionString`, call
  `AddConsoleIdentity(options)`, register `ConsoleStartupService`.
- **Keycloak provider**: do **not** require `ConnectionString`; call
  `AddConsoleKeycloak(options)`; do **not** register the DB-migrating startup service.

### Backend wiring — new `Identity/ConsoleKeycloak.cs`

Registers the console's **own, isolated** JWT-bearer scheme — `"WincheConsoleKeycloak"` (a
constant, distinct from the default `Bearer` the consumer's `Winche.KeycloakClient` owns) —
plus the three role policies bound to that scheme. It does **not** call any
`Winche.KeycloakClient` extension.

```csharp
public const string Scheme = "WincheConsoleKeycloak";

internal static IServiceCollection AddConsoleKeycloak(this IServiceCollection services, ConsoleOptions options)
{
    var k = options.Keycloak;                              // validated: Server/Realm/ClientId required
    var server = k.Server!.TrimEnd('/');
    var realm  = k.Realm!;
    var clientId = k.ClientId!;                            // the console's dedicated client
    var authority = $"{server}/realms/{realm}";

    services.AddSingleton(new KeycloakRuntime { Authority = authority, ClientId = clientId, Scopes = k.Scopes });

    // Our own scheme + options instance — no default scheme, host's Bearer untouched.
    services.AddAuthentication().AddJwtBearer(Scheme, o =>
    {
        o.Authority = authority;
        o.Audience = clientId;
        o.RequireHttpsMetadata = k.RequireHttpsMetadata;
        o.MapInboundClaims = false;                        // keep sub/email/preferred_username as-is
        o.TokenValidationParameters.RoleClaimType = ClaimTypes.Role;
        o.Events = new JwtBearerEvents
        {
            // Flatten Keycloak realm + resource roles into ClaimTypes.Role so RequireRole(...) works.
            OnTokenValidated = ctx => { KeycloakClaims.AddRoleClaims(ctx.Principal!, clientId); return Task.CompletedTask; },
            // API semantics: 401/403 status codes, not redirects (no default behavior to inherit here).
        };
    });

    // The SAME three policy names as Identity mode, now bound to the console scheme + mapped role names.
    // Endpoints that reference ConsoleRoles.*Policy are untouched.
    services.AddAuthorizationBuilder()
        .AddPolicy(ConsoleRoles.ViewerPolicy, p => p.AddAuthenticationSchemes(Scheme)
            .RequireRole(k.ViewerRole, k.MemberRole, k.AdminRole))
        .AddPolicy(ConsoleRoles.MemberPolicy, p => p.AddAuthenticationSchemes(Scheme)
            .RequireRole(k.MemberRole, k.AdminRole))
        .AddPolicy(ConsoleRoles.AdminPolicy, p => p.AddAuthenticationSchemes(Scheme)
            .RequireRole(k.AdminRole))
        .AddPolicy(AuthenticatedPolicy, p => p.AddAuthenticationSchemes(Scheme)
            .RequireAuthenticatedUser());

    return services;
}
```

Key property: **the policy names (`ConsoleViewer`/`ConsoleMember`/`ConsoleAdmin`) are
identical across providers**, so every Data and Storage endpoint — which only references
those policy names — works unchanged. Only the scheme and role-claim sources differ.

**Role flattening — new `Identity/KeycloakClaims.cs`.** `AddRoleClaims(principal, clientId)`
reads the access token's `realm_access.roles` (JSON) and `resource_access.{clientId}.roles`
and adds each as a `Claim(ClaimTypes.Role, name)` on the identity (skipping duplicates). This
replaces the package's `KeycloakClaimsTransformer`. Mapping stays name-based: the realm emits
roles named per `AdminRole`/`MemberRole`/`ViewerRole` (defaulting to `Admin`/`Member`/`Viewer`).

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
  of the mapped roles present in `ClaimTypes.Role`. Because the scheme sets
  `MapInboundClaims = false`, the original OIDC claim names (`sub`, `email`, `given_name`,
  `family_name`) are preserved on the principal, so these reads are direct.

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
   `aud`. Required because the console scheme validates `Audience == ClientId`.
3. Define realm (or resource) roles named per the `AdminRole`/`MemberRole`/`ViewerRole`
   mapping and assign them to users.

Pure bearer-token validation needs only the realm's JWKS; a client secret is required only
if the host makes the console client confidential. For local/dev Keycloak served over plain
HTTP, set `RequireHttpsMetadata = false` on `UseKeycloak`.

## Out of scope (YAGNI)

- Proxying Keycloak's Admin API from the console (rejected: full delegation).
- Mirroring users / console-local user data keyed by Keycloak `sub` (rejected: stateless).
- Mixing both providers in one deployment.
- Cookie-bridging the OIDC login server-side (the model is bearer-based; the SPA holds
  the token).
- Using `Winche.KeycloakClient` for the console's auth (it can't register an isolated second
  scheme; the console hand-rolls JWT-bearer instead).

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
  `AdminRole`, `MemberRole`, `ViewerRole` (role names default to `Admin`/`Member`/`Viewer`),
  `Scopes`, `RequireHttpsMetadata` (default `true`).
- `Options/ConsoleAuthProvider.cs` *(new)* — `Identity` | `Keycloak` enum.
- `WincheConsoleExtensions.cs` — a single `AddWincheConsole(IServiceCollection, Action<ConsoleOptions>)`
  (no `IConfiguration` overload); provider branch; provider branch in `MapWincheConsole`;
  map `/api/auth/config`.
- `Identity/ConsoleKeycloak.cs` *(new)* — `AddConsoleKeycloak(options)`: validates required
  options, then registers the dedicated `"WincheConsoleKeycloak"` JWT-bearer scheme + the
  scheme-bound role policies.
- `Identity/KeycloakClaims.cs` *(new)* — `AddRoleClaims(principal, clientId)` realm/resource
  role flattening (replaces the package's claims transformer).
- `Api/AuthConfigEndpoints.cs` *(new)* — `/api/auth/config`; Keycloak `/api/auth/state`.
- `Winche.Console.csproj` — **no** `Winche.KeycloakClient` reference (the console hand-rolls
  JWT-bearer; the package would collide with the consumer's registration).

**SPA**
- `web/package.json` — add `oidc-client-ts`.
- `web/src/auth/keycloak.ts` *(new)*, `web/src/auth/session.tsx`, `web/src/auth/AuthGate.tsx`,
  `web/src/App.tsx` (callback route + capability guard), `web/src/api/client.ts`,
  `web/src/api/types.ts` (provider + capabilities on `AuthState`), `web/src/layout/AppLayout.tsx`.

**Docs**
- README — Keycloak mode setup (realm clients, audience mapper, roles).
