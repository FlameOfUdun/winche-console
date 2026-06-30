# Winche.Console sample

A minimal ASP.NET Core app that embeds **Winche.Console** so you can run the real thing locally.
It demonstrates the entire integration — `AddWincheDatabase` + `AddWincheStorage` + `AddWincheConsole`,
then `MapWincheConsole` — and seeds a few documents and file records so there's something to browse.

This sample is wired for the **Keycloak** auth provider: it delegates all login and user/role management
to a Keycloak realm (bundled in `docker compose`), and the console keeps no auth database of its own.

## Run it

From this `samples/` folder:

```sh
# 1. Start PostgreSQL + MinIO + Keycloak (the identity provider)
docker compose up -d

# 2. Run the sample app
dotnet run --project Winche.Console.Sample

# 3. Open the console
#    http://localhost:5080/   (redirects to /_console)
#    Click "Sign in with Keycloak" and log in as  admin / admin.
```

On startup the app creates the schema, seeds demo data (`users/alice`, `users/bob`, `posts/welcome`,
plus two file records), and serves the console at **`/_console`**. Authentication is delegated to
Keycloak: clicking **Sign in with Keycloak** runs the OIDC (Authorization Code + PKCE) redirect, and the
console reads your identity and roles from the issued token. There is no "create the first admin" screen
and no in-console user management — that all lives in Keycloak.

**Seeded Keycloak users** (imported from `keycloak/winche-realm.json`):

| Username | Password | Role   | Sees |
| -------- | -------- | ------ | ---- |
| `admin`  | `admin`  | Admin  | Full access to data & files |
| `viewer` | `viewer` | Viewer | Read-only view of data & files |

Manage users/roles at the **Keycloak admin console**: http://localhost:8080 (master admin `admin`/`admin`),
realm **winche**.

Try it:

- **Data** — query the `users` or `posts` collection, open a document, edit a field, create or delete one.
- **Storage** — browse `docs/` and `images/`, upload a file (drag & drop + metadata JSON), download, edit
  metadata, delete. Sign in as **`admin`** for full access, or **`viewer`** to see the read-only view.

## What to notice

- The app registers `AddWincheDatabase`, `AddWincheStorage` (with `UseS3Archive` → MinIO), and
  `AddWincheConsole(builder.Configuration, o => o.UseKeycloak(…))`. The console resolves the unguarded
  cores and keyed data source from what the Winche cores already registered, and **delegates auth to
  Keycloak** (no host auth wiring; you don't call `RequireAuthorization`). Keycloak settings come from
  the `Keycloak` section in `appsettings.json` (`Server`/`Realm`/`Resource`); the role names default to
  the realm's `Admin`/`Member`/`Viewer` roles. To use the built-in Identity provider instead, swap the
  call for `AddWincheConsole(o => o.ConnectionString = …)` — see the commented block in `Program.cs`.
- **Keycloak runs over plain HTTP** on `localhost:8080` for the demo, so `Program.cs` sets
  `RequireHttpsMetadata = false`. In production, serve Keycloak over HTTPS and drop that line.
- **Object storage uses MinIO over TLS** (`Program.cs` → `UseS3Archive`, `Storage:ServiceUrl =
  https://localhost:9100`). The console issues **presigned URLs** so the browser uploads/downloads
  directly to the object store.

> **Why TLS locally:** the S3 archive always presigns **`https://`** URLs (correct for AWS S3). So the
> bundled MinIO is served over TLS using the **.NET dev cert** (`samples/minio-certs/`, CN=`localhost`,
> already trusted by your browser) — and uploads/downloads work end to end out of the box. If the certs
> are missing, regenerate them with the commands in `docker-compose.yml`, and ensure the dev cert is
> trusted: `dotnet dev-certs https --trust`. For production, just point `Storage:ServiceUrl` at your real
> S3 bucket.

## Reset

```sh
docker compose down -v   # drops Postgres + MinIO + Keycloak; next run re-seeds + re-imports the realm
```
