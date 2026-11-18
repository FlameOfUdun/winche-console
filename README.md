# Winche Console

The web app of the Winche console: the screens for projects, authentication, database, storage, functions, assets,
secrets, logs, a project's own pages, project settings and server settings. It's a React + Mantine app (TanStack Query for data), built with Vite. It works on
phones too: the sidebar becomes a menu, and the data browser shows one column at a time.

Its API is Winche Server's (`/console/v1/…`, in the
[winche-server](https://github.com/FlameOfUdun/winche-server) repository, `src/Winche.Console`). Winche Server serves a
build of this app: after changing it, run `scripts/update-console-web.sh` there, which builds this repository and
copies the files in, noting the commit they came from.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173, API calls go to a Winche Server on http://localhost:5000
npm test           # vitest
npm run build      # dist/
```

The dev server sends `/console/v1` to `http://localhost:5000` (`vite.config.ts`). Run a Winche Server there, from the
winche-server repository:

```sh
Winche__ConnectionString="Host=localhost;Port=5433;Database=winche;Username=winche;Password=winche" \
Winche__MasterKey="$(openssl rand -base64 48)" Winche__PublicUrl=http://localhost:5000 \
dotnet run --project src/Winche.Server --urls http://localhost:5000
```

(its `samples/docker-compose.yml` has the PostgreSQL), or point the proxy at a server you already run.

The page code is in `src/pages` (one folder per area), the frame in `src/layout`, the API calls in `src/api/client.ts`.
Tests sit beside what they test (`__tests__`, `*.test.tsx`).
