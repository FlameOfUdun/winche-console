# Winche.Console

An **in-process admin console** (superuser data + storage browser) for a .NET app that already uses
**Winche.Database** and **Winche.Storage**. It ships as a NuGet library you drop into your own
ASP.NET Core app — there is no separate service to deploy.

It is the Firebase-console-style view over your app's single datastore: browse, query, and edit JSON
documents through a Firestore-style collapsible field tree (every map and array collapses, edits are
inline and persist on confirm); and upload, download, browse, edit metadata on, and delete stored files — create folders
(kept in memory until you upload the first file) or delete a whole folder and everything under it
(cascading) — with each file's upload status (pending / complete / failed) shown inline. Destructive
deletes (documents, collections, files, folders) always ask for confirmation first. It manages **its own
accounts and roles** (built-in authentication), and — when you opt in — provides a **GUI editor for your
Firestore-style security rules** with live hot-swap and versioned history (see *Rule editor* below).
Indexes and triggers are **not** managed here — those live in your app's C# startup
(`UseIndexes` / `UseHooks`).

## Use it

In the ASP.NET Core app that already registers the Winche cores:

```csharp
builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = conn);
builder.Services.AddWincheStorage(opts => opts.ConnectionString = conn);
builder.Services.AddWincheConsole(o =>
{
    o.ConnectionString = consoleAuthConn;   // the console's own auth database (Identity tables)
    o.SeedAdminEmail = "admin@example.com"; // optional: seeds a first admin on first run
    o.SeedAdminPassword = "…";

    o.AddDatabaseTab();                     // opt in to the document browser (needs AddWincheDatabase)
    o.AddStorageTab();                      // opt in to the file browser (needs AddWincheStorage)
});

var app = builder.Build();
app.MapWincheConsole("/_console");          // JSON API + embedded SPA under this prefix; self-protected
app.Run();
```

Open `/_console`. The console resolves the data source that `AddWincheDatabase` / `AddWincheStorage`
already register (keyed internally), and browses via the **unguarded** cores (`DocumentDatabase` /
`FileStorage`), so rules are bypassed exactly like the Firebase console's superuser view. Choose any
prefix you like (`/_console` is the default); the SPA discovers it at runtime via an injected
`<base href>`.

The **Database** and **Storage** tabs are **opt-in** — call `AddDatabaseTab()` / `AddStorageTab()` for the
ones you want (a Database-only app simply omits `AddStorageTab()` and never shows a Storage tab or maps its
endpoints). Each takes an optional builder for a minimum role and its rules editor —
`o.AddDatabaseTab(b => { b.MinRole = ConsoleRole.Member; b.UseRulesEditor(); })`. `MinRole` is the floor to
see and read the tab (writes still require at least Member); the default is `Viewer`. Calling `AddDatabaseTab()`
without `AddWincheDatabase()` (or `AddStorageTab()` without `AddWincheStorage()`) throws a clear startup error.
The **Access** tab (user management) stays automatic — it's the console's own auth, shown to Admins in
Identity mode.

## Authentication & roles

The console is **its own auth realm** — built on EF Core + ASP.NET Core Identity, stored in a separate
database you point it at (`ConsoleOptions.ConnectionString`). It uses a named cookie scheme scoped to its
own endpoints, so it does **not** touch your host app's auth. You do not call `RequireAuthorization`.

- **Roles:** `Admin` ⊃ `Member` ⊃ `Viewer`. Viewer = read-only; Member = read + write/delete data &
  storage; Admin = that + user/role management.
- **First run:** if no users exist, the console shows a setup screen to create the first Admin (or seed
  one via `SeedAdminEmail`/`SeedAdminPassword`).
- **Accounts:** Admins manage users (create, edit name/email/role, enable/disable, reset password, unlock,
  delete; last-admin protected). Users manage their own name, password, and two-factor.
- **Two-factor (TOTP):** users can enroll an authenticator app; Admins can *require* 2FA per user (a
  forced-setup gate blocks everything but enrollment until they comply).
- **Email (optional):** wire an `IConsoleEmailSender` to enable self-service password reset and invites.
  Admins send an **invite** (email + role, optional name) with per-invite requirements — require the
  invitee to complete their name, require two-factor enrollment — and a chosen link expiry. The invitee
  clicks the emailed link, sets a password, completes their profile, and (if required) enrolls in 2FA on
  first sign-in. Pending invites are listed, copyable, resendable, and revocable under Users → Invites.
  Register the sender in the `AddWincheConsole` callback via `ConsoleOptions.UseEmailSender`:

  ```csharp
  services.AddWincheConsole(o =>
  {
      o.ConnectionString = "...";
      o.UseEmailSender<SmtpEmailSender>();                       // type (resolved from DI)
      // o.UseEmailSender(sp => new SmtpEmailSender(sp.GetRequiredService<IConfiguration>())); // factory
      // o.UseEmailSender(myInstance);                            // instance
  });
  ```
  
  Without an adapter those features are simply off (`AllowSelfServicePasswordReset` further gates
  self-service reset).

## Using Keycloak instead of built-in Identity

Instead of the built-in Identity database, the console can delegate all authentication to an
existing Keycloak realm. In this mode it holds no user database — Keycloak owns login, MFA,
password reset, and user/role management.

Configure it explicitly in code via `UseKeycloak` — `Server`, `Realm`, and `ClientId` are
required (the console reads no `IConfiguration` section of its own):

```csharp
builder.Services.AddWincheConsole(o => o.UseKeycloak(k =>
{
    k.Server   = "https://id.example.com"; // required
    k.Realm    = "myrealm";                 // required
    k.ClientId = "winche-console";          // required — the console's dedicated Keycloak client
    k.AdminRole  = "Admin";                 // Keycloak role names → console roles (defaults shown)
    k.MemberRole = "Member";
    k.ViewerRole = "Viewer";
    // k.ClientSecret = "...";              // only if the console client is confidential
    // k.RequireHttpsMetadata = false;      // only for a local/dev Keycloak served over http
    // k.AuthPolicyScheme = "WincheConsoleKeycloak"; // name of the console's bearer scheme (default shown)
}));
```

If your app keeps these in configuration, read them yourself and pass them in (see the sample's
`Program.cs`). The console uses its **own** dedicated Keycloak client and an isolated bearer
scheme — it never touches or depends on a `Winche.KeycloakClient` registration your app may
already have.

In your realm:

1. Create **one dedicated client** for the console (separate from your app's own client) with the
   console callback URL (e.g. `https://yourapp/_console/auth/callback`) in **Valid Redirect URIs**
   and the origin in **Web Origins**. A public client (PKCE) is sufficient; set `ClientSecret` only
   if you make it confidential.
2. Add an **Audience** protocol mapper on that client so access tokens include it in `aud` — the
   console validates that incoming JWTs are audienced for its own `ClientId` (see below) and rejects
   tokens that aren't.
3. Define realm roles `Admin` / `Member` / `Viewer` (or your mapped names) and assign them to users.
   Keep each user's realm **default roles** (e.g. `default-roles-<realm>`) so they retain the
   `account` permissions needed for the in-console "Manage account" link.

**Token validation.** Each request is validated by the console's own isolated bearer scheme:
`aud` must contain `ClientId`, the issuer must match `{Server}/realms/{Realm}`, and the signature is
checked against the realm JWKS. This is independent of any `Winche.KeycloakClient` registration your
app already has — a token minted for your app's client will not pass the console's scheme, and
vice-versa.

**Scheme name (`AuthPolicyScheme`).** The console registers its bearer scheme under the name
`WincheConsoleKeycloak` by default; set `AuthPolicyScheme` to change it. Because your host's own
`UseAuthentication` runs its *default* scheme on every request, a console-audience token reaching the
host's `Bearer` handler fails audience validation and logs noise (`IDX10214`). The clean fix is a
path-based forwarder on the host so console requests authenticate with the console's scheme — and
`AuthPolicyScheme` gives you a stable name to target:

```csharp
builder.Services.AddAuthentication()
    .AddPolicyScheme("Smart", "Smart", o => o.ForwardDefaultSelector = ctx =>
        ctx.Request.Path.StartsWithSegments("/_console")
            ? "WincheConsoleKeycloak"                   // == AuthPolicyScheme
            : JwtBearerDefaults.AuthenticationScheme);  // your host's "Bearer"
builder.Services.PostConfigure<AuthenticationOptions>(o => o.DefaultScheme = "Smart");
```

**Account management.** In Keycloak mode the profile menu (bottom of the nav) shows **Manage account**,
which opens Keycloak's account console for the signed-in user. Login, password, MFA, and profile are
all owned by Keycloak. `ConnectionString`, `SeedAdmin*`, invites, 2FA, and the in-console
user-management screens do not apply in Keycloak mode.

## Rule editor (optional)

Call `b.UseRulesEditor()` on a built-in tab and the console adds a **Rules** sub-tab to that screen for
editing the Firestore-style security rules that guard `Winche.Database` and `Winche.Storage` (the
`Winche.Rules` engine). Edits **hot-swap** into the live engine immediately — no restart — and every save is
a durable, versioned entry you can review and revert to.

```csharp
services.AddWincheConsole(o =>
{
    o.ConnectionString = consoleConn;                       // REQUIRED once any rule editor is enabled
    o.AddDatabaseTab(b => b.UseRulesEditor());              // Database tab + its Rules sub-tab
    o.AddStorageTab(b => b.UseRulesEditor(r => r.ApplyPersistedRulesOnStartup = false)); // Storage tab + Rules
});
```

- **Per subsystem, independent.** Call `b.UseRulesEditor()` inside `AddDatabaseTab` and/or `AddStorageTab`;
  omit one and its Rules tab never appears. Each is gated to **Admins** and only shows when its rule
  engine is actually registered in the host.
- **Storage.** The versioned history lives in a dedicated `console_rule_versions` table on
  `ConsoleOptions.ConnectionString` — **required whenever any rule editor is enabled** (including
  Keycloak mode, where it is otherwise unused). It never touches the identity tables.
- **Startup apply (`ApplyPersistedRulesOnStartup`, default `true`).** On boot the console re-applies the
  latest saved ruleset to the live engine. Set it `false` to keep your code-seeded rules as the boot
  baseline — console edits still hot-swap and persist at runtime, they just aren't re-applied on restart
  (the UI shows a drift banner with an *Apply saved version* action when live ≠ saved).
- **Editing.** A GUI builder (match-block tree + a full expression builder over the rule AST) with a raw
  **JSON** toggle and file **import/export**; a **Simulate request** panel to check allow/deny before
  saving; and a **version history** drawer with one-click **revert** and optimistic-concurrency safety.
- **Blast radius.** These rules govern your app's data/file access (what your API consumers may do), not
  the console's own login — a bad ruleset cannot lock you out of the console.

## Custom tabs (server-driven dashboards)

Register a tab as a declarative **layout tree** in C#; the console renders it. Widget data comes from
typed handler methods on DI-resolved provider classes, bound by selector. Filters are nodes that scope
a value to their subtree and either re-fetch it or switch which widgets show.

```csharp
o.AddTab("analytics", "Analytics", tab =>
{
    tab.Icon = "chart-bar";
    tab.MinRole = ConsoleRole.Member;
    tab.Layout(new Filter(new Select("range", ["7 days", "30 days"]),
    [
        new StatRow<AnalyticsData>(d => d.Kpis),
        new Row([ new Chart<AnalyticsData>(d => d.Signups, ChartKind.Line) { Flex = 2 },
                  new Table<BillingData>(d => d.Invoices) { Flex = 1 } ]),   // mix providers in one tab
    ]));
});
```

```csharp
public sealed class AnalyticsData(IAnalytics analytics)   // constructor-injected, resolved per request
{
    public async Task<StatRowData> Kpis(WidgetContext ctx, CancellationToken ct)
        => new(new Stat("Users", await analytics.CountAsync(ctx.Filters["range"], ct), "+12%", Trend.Up));
    public Task<ChartData> Signups(WidgetContext ctx, CancellationToken ct) => /* … */;
}
```

- **Widgets:** `StatRow`, `Table`, `Chart(Line|Bar)`; containers `Column`/`Row`(with `Flex`)/`Section`; controls `Select`/`DateRange`.
- **Ids** come free from the handler method name; **types** are enforced (a `Chart` only accepts a chart-returning handler).
- **Filters:** `new Filter(control, [children])` re-fetches; `new Filter(select, v => branches)` switches. Values reach handlers via `ctx.Filters`; roles via `ctx.User`.
- **Endpoints:** `GET {prefix}/api/tabs` (nav), `GET …/{id}` (layout), `POST …/{id}/data` (typed data).

### Escape hatch: embed a custom island

When a tab needs genuine interactivity (forms, buttons, mutations) beyond the read-mostly widget catalog, add
an `Embed` node: the console mounts a **consumer-authored document in a same-origin `<iframe>`** at that spot in
the layout. The declarative tree stays read-only; the island owns its own UI and fetches its own endpoints.

```csharp
new Column([
    new StatRow<AnalyticsData>(d => d.Kpis),
    new Embed("collections-editor", "/plugins/collections-editor") { Flex = 1, MinHeight = 320 },
])
```

The console bridges a **closed `postMessage` protocol**: on load it sends `winche:init` (current user + theme,
and in Keycloak mode a bearer token) and, on silent renewal, `winche:token`; the island may send back exactly
`winche:resize`, `winche:refetch` (reload the sibling declarative widgets), and `winche:notify` (raise a console
toast). Messages are origin- and source-pinned both ways.

- **Same-origin only.** `route` must be a root-relative path your host serves (`/plugins/…`); cross-origin
  routes are rejected at registration. Same origin means the auth cookie (Identity mode) rides along on the
  island's own calls; in Keycloak mode the console hands the island its **same-audience** bearer token via
  `winche:init`/`winche:token`.
- **The island authorizes itself.** The tab's `MinRole` gates who *sees* the tab (and thus the embed); it does
  **not** protect the island's route or API calls — those bypass the console. Authorize the island's data
  endpoints yourself (cookie `[Authorize]` in Identity mode, the handed-over bearer in Keycloak mode) and set a
  restrictive CSP (`connect-src`/`form-action 'self'`) on the island document so the token can't be exfiltrated.
  The `role` in `winche:init` is display data, never an authorization decision.

## API (under the chosen prefix)

- **Auth** — `GET api/auth/state`, `POST api/auth/{setup,login,login/2fa,login/recovery,logout,password,profile,forgot-password,reset-password}`, `POST api/auth/2fa/{setup,enable,disable,recovery-codes}`
- **Users** (Admin) — `GET/POST api/users`, `PUT/DELETE api/users/{id}`, `POST api/users/{id}/{reset-password,unlock}`
- **Invites** (Admin) — `GET/POST api/invites`, `GET api/invites/{id}/link`, `POST api/invites/{id}/resend`, `DELETE api/invites/{id}`; **acceptance** (anonymous) — `GET/POST api/invites/accept`
- **Database** (Viewer reads, Member writes) — `GET api/database/collections`, `POST api/database/query`,
  `GET/PUT/PATCH/DELETE api/database/documents/{base64Path}`, `DELETE api/database/collections/{base64Path}`
- **Storage** (Viewer reads/downloads, Member writes) —
  `GET api/storage/browse?path=`, `GET/DELETE api/storage/files/{base64Path}`,
  `DELETE api/storage/directories/{base64Path}` (cascading folder delete),
  `POST api/storage/{upload-url,confirm,metadata}`, `GET api/storage/download-url?path=`
- **Rules** (Admin; only for enabled subsystems, `{sys}` = `database` | `storage`) —
  `GET api/rules/subsystems`, `GET api/rules/{sys}/{live,versions}`, `GET api/rules/{sys}/versions/{version}`,
  `POST api/rules/{sys}` (save + hot-swap), `POST api/rules/{sys}/{revert/{version},apply-head,validate,simulate}`

Document/file paths are standard-base64 of the UTF-8 path (those that travel in a route segment);
the storage write endpoints take the path in the body/query instead. Malformed base64 returns `400`.

> **File upload/download use presigned URLs.** `upload-url` creates the record and returns a short-lived
> URL the browser PUTs the bytes to; `confirm` then finalizes it. `download-url` returns a short-lived GET
> URL. This needs an object store (S3/MinIO) configured on `Winche.Storage` — with a metadata-only archive
> the records exist but byte transfer is unavailable.
> **Known limitation:** the console uses ASP.NET Core Identity's standard cookie scheme names. If your
> *host app* also uses ASP.NET Core Identity, the scheme names would collide. Winche consumers typically
> use their own auth (or BYO-JWT), so this is fine in practice.
> Collection and storage-folder listing use the library's own listers — `ListCollectionIdsAsync`
> (Winche.Database 8.3) and `ListDirectoryIdsAsync` (Winche.Storage 6.3).

## What it is not

- **Not** a multi-tenant control plane. It attaches to exactly one app's datastore; there is no
  project management, provisioning, or per-tenant routing.
- **Not** an indexes/triggers editor — those are compile-time configuration owned by your app.
  (Security *rules* can optionally be edited live; see *Rule editor* above.)
- **Not** its own deployable. No Dockerfile, no host — it's a library inside your process.

## Develop

The SPA lives in `web/` (React + Vite + TypeScript + Mantine) and builds into
`src/Winche.Console/wwwroot`, where it is embedded into the NuGet package.

- `cd web && npm install`
- `npm run dev` — Vite dev server; proxies `/_console` to a host app running the console on `:5198`
- `npm test` — Vitest component tests
- `npm run build` — emits the production SPA into `src/Winche.Console/wwwroot` (embedded at pack time)

## Tests

`dotnet test` boots `tests/SampleHost` (a minimal app that calls `AddWincheConsole`) via
`WebApplicationFactory` and exercises auth (setup/login/roles), user management, two-factor (real TOTP),
the optional email flows, and the data/storage/SPA behavior. It spins an ephemeral **PostgreSQL**
container with **Testcontainers** (a separate database for the console's auth tables), so a running
Docker daemon is required; no local services or fixed ports are needed.
