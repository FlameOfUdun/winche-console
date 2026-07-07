# Winche Console — Flutter island demo

A Flutter **web** app embedded as a Winche Console tab through the console's `Embed` escape hatch. It
demonstrates the full cross-iframe `postMessage` protocol the console speaks.

## What it shows

- **Inbound** (console → island): `winche:init` `{ user, theme, token }` and `winche:token` `{ token }` — the
  app displays the signed-in email, the theme, and whether a bearer token was handed over (Keycloak mode).
- **Outbound** (island → console): `winche:ready` on load; `winche:resize` (the Grow/Shrink button);
  `winche:refetch` (bumps the sibling KPI in the tab — a React/Mantine widget reloaded by a Flutter button,
  cross-framework); `winche:notify` (raises a native console toast).

Interop uses `package:web` + `dart:js_interop` — see `lib/main.dart`. Messages are origin-pinned both ways.

## Build

The .NET sample (`samples/Winche.Console.Sample`) serves this app's build output at `/plugins/flutter` and only
registers the **Flutter** tab when the build exists (`build/` is gitignored). Build it with:

```sh
flutter build web --csp --base-href=/plugins/flutter/ --no-web-resources-cdn
```

- `--csp` — CSP-compatible output (no `eval`).
- `--base-href=/plugins/flutter/` — matches the route the sample frames it under.
- `--no-web-resources-cdn` — self-host CanvasKit so the island's CSP can stay tight. (The sample's CSP still
  allows `fonts.gstatic.com` for CanvasKit's default Roboto font; a token-bearing island would bundle a font
  instead to keep `connect-src 'self'`.)

Then run the .NET sample and open the **Flutter** tab.
