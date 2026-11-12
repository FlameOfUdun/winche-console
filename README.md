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

> How to write rules: the **[Rules Language Guide](https://github.com/FlameOfUdun/winche-rules/blob/main/GUIDE.md)**.

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
  latest saved ruleset to the live engine. Set it `false` to keep the app's starting rules (`UseRulesFile`) as the boot
  baseline — console edits still hot-swap and persist at runtime, they just aren't re-applied on restart
  (the UI shows a drift banner with an *Apply saved version* action when live ≠ saved).
- **Editing (3.4.0).** The rules are one text file, Firestore-style:

  ```text
  match users/{uid} {
    allow read: if request.auth.uid == uid;
    allow create: if request.auth.uid == uid
      && request.resource.data has only ['name', 'email'];
    allow update: if request.auth.uid == uid && changes only ['name'];
  }
  ```

  It's a code editor (CodeMirror) with syntax colours and suggestions as you type (or Ctrl+Space):
  keywords and operations, path captures in scope, `request.` / `resource.` members, functions with a
  short description, and **document field names** — sampled from up to 50 documents the enclosing
  `match` covers (`api/rules/database/fields?pattern=…`; storage rules get a file's fields). A **Format**
  button tidies the file. The server parses and formats it (`api/rules/text/parse` / `format`), so the
  editor reads rules exactly as the engine does; they're still stored as rulesJson. An error shows its line and column, a call to an
  unknown function (usually a typo) is flagged, and Save stays disabled while the file has an error or
  hasn't been checked yet. Comments aren't kept (rules are stored as data). Around it: a **Simulate
  request** panel, and **history** like Firebase's — every save is a version (who, when, note); pick one to
  see it as the rules file or its **changes** against the active version, **open it in the editor**, or
  **revert** to it. Saves use optimistic concurrency. Syntax and functions: see Winche.Rules' README.
- **Blast radius.** These rules govern your app's data/file access (what your API consumers may do), not
  the console's own login — a bad ruleset cannot lock you out of the console.

## Authentication (optional)

An **Authentication** tab (Admins) for the app's own users, signed in with [Winche Auth](https://github.com/FlameOfUdun/winche-auth):

```csharp
services.AddWincheAuth(o => { /* … */ });
services.AddAuthentication().AddWincheTokens(t => t.TrustWincheAuth());
services.AddWincheConsole(o => o.AddAuthenticationTab());
```

- **Users:** search by email, name or uid; open one for how they sign in, their sessions (sign one out, or all), their
  custom claims (what rules read as `request.auth.token.*`), unlock after failed sign-ins, disable, delete; add users.
- **Sign-in methods:** what's on (email and password, anonymous, Winche tokens, trusted issuers such as Keycloak), as
  set in code.
- **Settings:** token lifetimes, issuer, signing keys (with *Rotate now*), lockout and hooks.

Sign-ins, failures, lockouts and account changes appear in the Logs Explorer as resource `auth`, with a built-in
*Failed sign-ins* query. The console's own admins are separate: they're in **Access**. Needs Winche.Auth 1.0.0.

## History (optional)

A **History** sub-tab on the Database tab shows who changed which document, when, and how — each field's old and
new value — for one document (the clock button on a document opens it) or everything under a path:

```csharp
services.AddWincheDatabase(cfg => { /* … */ cfg.KeepHistory(TimeSpan.FromDays(30)); });   // records it
services.AddWincheConsole(o => o.AddDatabaseTab(b => b.UseHistory()));
```

Changes are attributed to the app user who made them (their `uid`, else `sub`), to `console:<email>` for edits made
in the console, or to no one for hooks and background jobs. Readable by whoever can read the Database tab
(`api/database/history?path=|under=|actor=&before=`). Needs Winche.Database 11.1.0.

## Logs (optional)

The console can keep the app's log entries and show them to Admins in a **Logs Explorer** — a **Logs** sub-tab on the
Database and Storage tabs for that library's entries, and a top-level **Logs** tab for everything (the app's own code
and the framework too):

- **Structured request entries.** With `LogRequests()` on Winche.Database (11.1.0) / Winche.Storage (9.1.0), every
  app request through the access rules is an entry with its resource, operation, who (principal), path, outcome and
  latency, and a plain sentence: *"u2 was denied reading users/u1: no rule allows it."* Denied and slow requests are
  always kept; successful ones are sampled (10% by default). The console's own browsing isn't logged — its edits are
  in the History sub-tab.
- **The explorer:** search, resource, time range, severity, a histogram of entries over time (info / warning / error),
  live tail, and entries that open to their fields — **Show matching** / **Hide matching** on any of them adds a filter
  (`api/logs/{scope}?f=principal:u2&f=outcome!:ok`). The equivalent query line is shown above the results.
- **Saved queries** (a tab beside the explorer): save the current query for every admin of the console; built-in ones
  for denied requests, errors and each library's requests. Each shows how many entries it matched in the last 24 hours.

```csharp
services.AddWincheConsole(o =>
{
    o.ConnectionString = consoleConn;                          // REQUIRED for logs: entries are kept here
    o.AddDatabaseTab(b => { b.UseRulesEditor(); b.UseLogs(); });   // Winche.Database.* entries
    o.AddStorageTab(b => { b.UseRulesEditor(); b.UseLogs(); });    // Winche.Storage.* entries
    o.AddLogsTab(l =>                                          // everything
    {
        l.MinimumLevel = LogLevel.Warning;                     // default; Information while debugging
        l.Retention = TimeSpan.FromDays(7);                    // default
    });
});
```

- **Collected** by a logging provider the console adds to the host: entries at the minimum level and up (from the
  categories some view shows) are queued and written in batches to a `console_logs` table — created on first start —
  so logging never waits on the database; if the store is unreachable, entries are dropped rather than retried.
- **Every instance** of the app writes to the same table, so the tabs show all of them (each entry names its
  instance). Entries older than `Retention`, or beyond `MaxEntries` (200,000), are pruned hourly.
- **The views** filter by level, source (category prefix) and text — message, exception, user and structured
  values, so the error id from an `Internal error (3f9c…)` report finds its entry — page back, and have a live mode.
  Clicking an entry shows its exception and values. The user column is filled from a `UserId` / `User` value.
- **Levels are adjustable in the console** (the **Levels** button in any logs view): a default level and per-source
  levels — e.g. `SmartAirway.Reports` at Debug for 1 hour while chasing a problem; it ends on its own. Saved levels
  apply on every instance within `LevelSyncInterval` (10 s) without a restart, and *Reset* goes back to the code's
  (`MinimumLevel`, plus `l.SetLevel("Microsoft", LogLevel.Warning)` for starting per-source levels). The console's
  collector receives every level regardless of the host's logging filters, so Debug can reach the Logs tab without
  changing what the app's other outputs (console, CloudWatch) get. Sub-tabs show the levels under their library.
- **Admins only** (`api/logs/{app|database|storage}`, `api/logs/levels`): logs can hold personal data.
- It's for "what just went wrong", next to the data — keep shipping logs to CloudWatch or similar for the long term.

## Deploying rules from the repo: `winche`

Rules can also live in your repo as `.rules` files and be published with the
[Winche CLI](https://github.com/FlameOfUdun/winche-cli) (`dotnet tool install -g Winche.Cli`), like
`firebase deploy`: `winche rules deploy` saves each changed file as a new version here (the git commit as its
note), hot-swapped like an editor save. It needs Keycloak mode, an account with the Admin role, and
`http://127.0.0.1:9005/callback` registered as a redirect URI on the console's client for `winche login`.
In the app, load the same files as starting rules (`UseRulesFile("database.rules")`); a deployed version
replaces them at startup.

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
        => new(new Stat("Users", await analytics.CountAsync(ctx.Inputs["range"], ct), "+12%", Trend.Up));
    public Task<ChartData> Signups(WidgetContext ctx, CancellationToken ct) => /* … */;
}
```

- **Widgets:** `StatRow`, `Table`, `Chart(Line|Bar)`; containers `Column`/`Row`/`Section`; controls `Select`/`DateRange`/`TextInput`. A `Row` sizes children by their `Flex` in a 12-col grid; set `Row.Justify` (`Start`/`Center`/`End`/`SpaceBetween`) to instead pack them tightly — e.g. a button toolbar.
- **Ids** come free from the handler name (a method or a `d => d.Prop` property); **types** are enforced (a `Chart` only accepts a chart-returning handler).
- **Filters:** `new Filter(control, [children])` re-fetches; `new Filter(select, v => branches)` switches. Values reach handlers via `ctx.Inputs`; roles via `ctx.User`.
- **Endpoints:** `GET {prefix}/api/tabs` (nav), `GET …/{id}` (layout), `POST …/{id}/data` (typed data), `POST …/{id}/commands/{commandId}` (writes — see below).

### Interactivity: search, refresh, pagination, commands

The tree also carries a **bounded** set of interactive primitives. Each maps to a *named server capability*, so
tabs feel live without the declarative model turning into a client-side UI framework:

- **Text search** — `new TextInput("q") { Apply = Apply.Manual }` buffers keystrokes and renders an inline
  submit button beside the field (labelled `SubmitLabel`, default `"Search"`; Enter also submits) that applies
  the typed value. `Apply.Reactive` instead re-fetches as you type with no button. Values arrive in `ctx.Inputs["q"]`.
- **Refresh** — `Button.Refresh("Refresh")` re-fetches the tab's widgets.
- **Pagination** — `new Table<T>(d => d.Rows) { Paginate = 20 }`; the handler reads `ctx.Page("rows", 20)` and
  returns `TableData.From(rows).Key(r => r.Id).Column(…).Total(totalCount)`.
- **Commands** — server *write* handlers fired from a toolbar or per-row button. The input **type is the form**:
  DataAnnotations on a record's parameters drive the fields and validation; the console renders the modal,
  validates on both sides, runs the handler under a per-command role, and refetches on success.

```csharp
var create = tab.Command((UsersTab d) => d.CreateUser, c => { c.Label = "Create user"; c.MinRole = ConsoleRole.Admin; });
var delete = tab.Command((UsersTab d) => d.DeleteUser, c => { c.Label = "Delete"; c.MinRole = ConsoleRole.Admin; c.Confirm = "Delete this user?"; });
tab.Layout(new Filter(new TextInput("q") { Placeholder = "Search email…", Apply = Apply.Manual },
[
    new Row([ new Button(create), Button.Refresh("Refresh") ]),
    new Table<UsersTab>(d => d.Rows) { Paginate = 20, RowActions = [ new RowActionRef(delete) ] },
]));
```

```csharp
public sealed record CreateUserInput(
    [property: Display(Name = "Email"), Required, EmailAddress] string Email,
    [property: Required] UserRole Role,                        // enum → Select
    [property: Display(Name = "Active")] bool Active = true);  // bool → switch

public sealed class UsersTab
{
    public WidgetHandler<TableData> Rows => (ctx, ct) => /* filter by ctx.Inputs["q"], slice via ctx.Page("rows", 20) */;
    public CommandHandler<CreateUserInput> CreateUser => (ctx, ct) =>           // typed form input
        Task.FromResult(Exists(ctx.Input.Email)
            ? CommandResult.Invalid(nameof(CreateUserInput.Email), "Already taken")   // inline field error
            : CommandResult.Ok($"Created {ctx.Input.Email}"));
    public CommandHandler DeleteUser => (ctx, ct) =>                            // row key, no form
        Task.FromResult(CommandResult.Ok($"Deleted {ctx.RowKey}"));
}
```

- **Author handlers as properties** (`public CommandHandler<T> X => …`) so `tab.Command(d => d.X)` infers the
  input type; a method form needs explicit `tab.Command<Provider, TInput>(d => d.X)`.
- **Authorization is server-side and layered:** a command's `MinRole` must be ≥ the tab's, the endpoint enforces
  it, and `rowKey` is only an addressing token (the handler must still scope its own write). Buttons the user
  can't run are hidden client-side — cosmetic only.
- **CSRF:** command POSTs require an `X-Winche-Console` header (bearer-token islands are exempt).
- **Result:** `CommandResult.Ok/Fail/Invalid` becomes an `{ ok | error | invalid }` response that raises a toast
  and, for `Ok`, refetches the tab; `Invalid` shows per-field errors inline without closing the form.

### Escape hatch: embed a custom island

When a tab needs interactivity beyond these bounded primitives — arbitrary local state, a bespoke editor, or a
non-C# UI — add an `Embed` node: the console mounts a **consumer-authored document in a same-origin `<iframe>`**
at that spot in the layout. The declarative tree handles the common cases above; the island owns everything else,
rendering its own UI and fetching its own endpoints.

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
- **Sandbox.** The iframe carries `allow-scripts allow-same-origin allow-forms`; opt into more (never navigation)
  via the `[Flags] EmbedSandbox` enum — `new Embed(id, route) { Sandbox = EmbedSandbox.Popups | EmbedSandbox.Downloads }`.

`samples/flutter-demo` is a runnable **Flutter web** island that exercises the whole protocol end to end
(inbound `init`/`token`; outbound `resize`/`refetch`/`notify`, incl. a Flutter button reloading a sibling
declarative widget) — see its README for the one build command.

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
