# Winche.Console sample

A minimal ASP.NET Core app that embeds **Winche.Console** so you can run the real thing locally.
It demonstrates the entire integration — `AddWincheDatabase` + `AddWincheStorage` + `AddWincheConsole`,
then `MapWincheConsole` — and seeds a few documents and file records so there's something to browse.

## Run it

From this `samples/` folder:

```sh
# 1. Start PostgreSQL + MinIO (object store for file upload/download)
docker compose up -d

# 2. Run the sample app
dotnet run --project Winche.Console.Sample

# 3. Open the console
#    http://localhost:5080/   (redirects to /_console)
#    On first run it asks you to create the first admin account.
```

On startup the app creates the schema, seeds demo data (`users/alice`, `users/bob`, `posts/welcome`,
plus two file records), and serves the console at **`/_console`**. The console manages its own accounts
in a separate auth database (`winche_sample_auth`). On first run you'll see a **"Create the first admin"**
screen (the `POST /api/auth/setup` flow). To seed an admin instead and skip that screen, set
`SeedAdminEmail`/`SeedAdminPassword` in `AddWincheConsole` (see `Program.cs`).

Try it:

- **Data** — query the `users` or `posts` collection, open a document, edit a field, create or delete one.
- **Storage** — browse `docs/` and `images/`, upload a file (drag & drop + metadata JSON), download, edit
  metadata, delete. As an **Admin** you get full access; create a **Viewer** account (Users tab) to see
  the read-only view.

## What to notice

- The app registers `AddWincheDatabase`, `AddWincheStorage` (with `UseS3Archive` → MinIO), and
  `AddWincheConsole(o => o.ConnectionString = …)`. The console resolves the unguarded cores and keyed
  data source from what the Winche cores already registered, and **manages its own accounts** (no host
  auth wiring; you don't call `RequireAuthorization`).
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
docker compose down -v   # drops Postgres + MinIO; next run re-seeds from scratch
```
