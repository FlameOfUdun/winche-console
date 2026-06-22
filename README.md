# Winche.Console

An **in-process admin console** (superuser data + storage browser) for a .NET app that already uses
**Winche.Database** and **Winche.Storage**. It ships as a NuGet library you drop into your own
ASP.NET Core app — there is no separate service to deploy.

It is the Firebase-console-style view over your app's single datastore: browse, query, and edit JSON
documents through a Firestore-style collapsible field tree (every map and array collapses, edits are
inline and persist on confirm); and upload, download, browse, edit metadata on, and delete stored files. It manages **its own
accounts and roles** (built-in authentication). Rules, indexes, and triggers are **not** managed here —
those live in your app's C# startup (`UseRules` / `UseIndexes` / `UseHooks`).

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
- **Email (optional):** wire an `IConsoleEmailSender` to enable self-service password reset and email
  invites (create a user with no password → they receive a set-password link). Register it right in the
  `AddWincheConsole` callback via `ConsoleOptions.UseEmailSender`:

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

## API (under the chosen prefix)

- **Auth** — `GET api/auth/state`, `POST api/auth/{setup,login,login/2fa,login/recovery,logout,password,profile,forgot-password,reset-password}`, `POST api/auth/2fa/{setup,enable,disable,recovery-codes}`
- **Users** (Admin) — `GET/POST api/users`, `PUT/DELETE api/users/{id}`, `POST api/users/{id}/{reset-password,unlock}`
- **Data** (Viewer reads, Member writes) — `GET api/data/collections`, `POST api/data/query`,
  `GET/PUT/PATCH/DELETE api/data/documents/{base64Path}`, `DELETE api/data/collections/{base64Path}`
- **Storage** (Viewer reads/downloads, Member writes) — `POST api/storage/list`,
  `GET api/storage/browse?path=`, `GET/DELETE api/storage/files/{base64Path}`,
  `POST api/storage/{upload-url,confirm,metadata}`, `GET api/storage/download-url?path=`

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
- **Not** a rules/indexes/triggers editor. Those are compile-time configuration owned by your app.
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
