# Console Invite Links — Design

**Date:** 2026-06-29
**Status:** Approved
**Component:** `Winche.Console` (.NET) + `web` (React SPA)

## Problem

Today the only way to invite a console user is the inline path in `POST /api/users`:
an admin creates a user with no password and the console emails them a set-password
link via `IConsoleEmailSender.SendInviteAsync`. That flow has three gaps:

1. The account is created immediately, so unaccepted/expired invites leave dangling
   accounts and collide on email uniqueness when re-inviting.
2. There is no per-invite control — no expiry, no "must complete profile", no "must
   set up two-factor".
3. There is no way to list, revoke, resend, or copy a pending invite.

We want a first-class **invite** feature: an admin creates an invite (email + role,
optional names) with per-invite requirements and expiry; the console emails the link;
the invitee clicks it, sets a password, completes their profile, and (if required)
enrolls in two-factor on first sign-in.

## Decisions (from brainstorming)

- **Per-invite configuration.** Expiry, require-name, and require-TOTP are chosen by
  the admin for each invite — not global defaults. This requires a stored invite record.
- **Account created on accept.** Sending an invite stores only an invite record; no
  `ConsoleUser` exists until the invitee accepts. Pending invites never pollute the
  user list, and re-inviting is trivial.
- **Admin management:** list, revoke, resend/regenerate, and copy-link.
- **UI placement:** the Users page gains two sub-tabs — **Users** (existing) and
  **Invites** (pending/expired/revoked invites).
- **Token mechanism:** ASP.NET Core Data Protection `ITimeLimitedDataProtector` — the
  same primitive Identity's token providers are built on — mints a tamper-proof,
  self-expiring token. The invite row holds metadata and accepted/revoked status.
- **Email sender required** to create an invite (matches today's behavior and the
  "must send to email" requirement); the API also returns the link for the copy feature.
- **`POST /api/users` drops its no-password branch** — direct creation always requires a
  password now; all email invites go through `/api/invites`.

### Why not Identity's user token providers

`UserManager.GenerateUserTokenAsync` / the `DataProtectorTokenProvider` (password-reset)
path binds the token to an existing user's security stamp. We create the account only on
accept, so there is no user to bind to. Those tokens also have a single global lifespan
(`TokenOptions.TokenLifespan`) and carry no metadata, so they cannot express per-invite
expiry or requirements. We use EF Core (the same `ConsoleIdentityDbContext`) for storage
and Data Protection directly for the token.

## Data Model

New entity `Identity/ConsoleInvite.cs`, registered as `DbSet<ConsoleInvite>` on
`ConsoleIdentityDbContext`. New EF migration `AddConsoleInvites`.

| Field | Type | Purpose |
|---|---|---|
| `Id` | `Guid` (PK) | Invite id; encoded into the token payload |
| `Email` | `string` | Target address (normalized lower-case) |
| `Role` | `string` | Role granted on accept |
| `FirstName` | `string?` | Admin-prefilled given name |
| `LastName` | `string?` | Admin-prefilled family name |
| `RequireName` | `bool` | Invitee must supply first + last name |
| `RequireTwoFactor` | `bool` | Sets `ConsoleUser.TwoFactorRequired` on accept |
| `ExpiresAt` | `DateTimeOffset` | Display source of truth; matches token lifetime |
| `CreatedAt` | `DateTimeOffset` | Audit |
| `CreatedByUserId` | `Guid?` | Admin who created it (audit) |
| `AcceptedAt` | `DateTimeOffset?` | Set on accept; non-null ⇒ off the Invites list |
| `RevokedAt` | `DateTimeOffset?` | Set on revoke |

**Derived status** (computed, never stored), evaluated in order:
`Accepted` (AcceptedAt set) → `Revoked` (RevokedAt set) → `Expired` (now > ExpiresAt) →
`Pending`.

Index on `Email` to find an existing pending invite quickly.

## Token

`ConsoleInviteTokens` service (registered in DI), wrapping
`IDataProtectionProvider.CreateProtector("Winche.Console.Invite").ToTimeLimitedDataProtector()`:

- `string Protect(Guid inviteId, TimeSpan lifetime)` — opaque, self-expiring token.
- `bool TryUnprotect(string token, out Guid inviteId)` — false on tamper or expiry.

The token encodes **only** the invite id; expiry is enforced cryptographically by the
protector and mirrored in `ExpiresAt` for display. Revocation/accepted state is read from
the row (a self-contained token cannot be un-issued).

`ConsoleLinks.InviteLink(http, prefix, token)` →
`{scheme}://{host}{prefix}/invite?token={escaped}`.

**Caveat:** invite tokens are bound to the app's Data Protection key ring. An environment
with ephemeral/unpersisted keys (e.g. a fresh container) invalidates outstanding links.
This matches existing reset-link behavior and is acceptable.

## API — `Api/InviteEndpoints.cs`

### Admin — group `/api/invites`, `ConsoleRoles.AdminPolicy`

- **`GET /`** — list invites where `AcceptedAt is null` (pending/expired/revoked), newest
  first. Each: `id, email, role, firstName, lastName, requireName, requireTwoFactor,
  createdAt, expiresAt, status`.
- **`POST /`** — body `{ email, role, firstName?, lastName?, requireName,
  requireTwoFactor, expiresInHours }`.
  - Validate: email present; role in `ConsoleRoles.All`; `expiresInHours` in `[1, 720]`.
  - Reject (400) if no `IConsoleEmailSender` registered.
  - Reject (409) if a `ConsoleUser` already has that email, or a **pending** invite
    exists for it.
  - Mint token with `lifetime = expiresInHours`, set `ExpiresAt`, save row, email via
    `SendInviteAsync(recipient, link)`. Return the invite **plus `link`** (for copy).
- **`GET /{id}/link`** — mint a fresh token valid until the row's existing `ExpiresAt`;
  return `{ link }`. No email, no expiry change. Backs "Copy link". 410 if not pending.
- **`POST /{id}/resend`** — new token + new expiry (same `expiresInHours` as original),
  clear `RevokedAt`, re-email. Return `{ link }`. 409 if already accepted.
- **`DELETE /{id}`** — revoke (set `RevokedAt = now`). 204. No-op-safe if already revoked.

### Anonymous — `/api/invites/accept` (mapped off the app, no `RequireAuthorization`)

- **`GET ?token=…`** — preview. `TryUnprotect` → id → load row → must be `Pending`.
  Return `{ email, firstName, lastName, requireName, requireTwoFactor }`. 410 (Gone) on
  invalid/expired/revoked/accepted. Role is not exposed.
- **`POST`** — body `{ token, password, firstName?, lastName? }`.
  - `TryUnprotect` → id → load row → must be `Pending` (else 410).
  - If `requireName` and effective first/last (body ?? invite) is blank → 400.
  - Reject if a user with that email already exists (race) → 409.
  - Create `ConsoleUser { UserName = Email, Email, EmailConfirmed = true, Active = true,
    FirstName, LastName, TwoFactorRequired = requireTwoFactor }`; `CreateAsync(user,
    password)` (400 with Identity errors on failure); `AddToRoleAsync(role)`.
  - Stamp `AcceptedAt`; re-check it was null before stamping to block double-accept.
  - Return 200.

### Changed — `Api/UserEndpoints.cs`

`POST /api/users` loses the `!hasPassword` invite branch and the `invited` flag. Password
is now always required (`400` if missing), independent of email configuration.
`IConsoleEmailSender.SendInviteAsync` is unchanged and is now called only from
`InviteEndpoints`.

### Wiring — `WincheConsoleExtensions`

Ensure Data Protection is available (`AddDataProtection()` if not already), register
`ConsoleInviteTokens`, and call `MapInviteEndpoints()` where `MapUserEndpoints()` /
`MapAuthEndpoints()` are mapped.

## Frontend

### Routing — `App.tsx`
Add anonymous route `invite` → `AcceptInvitePage`, alongside `forgot-password` /
`reset-password` (outside the auth gate).

### `pages/UsersPage.tsx`
Wrap content in Mantine `Tabs`:
- **Users** tab — the existing table + New user / Edit / Reset / Delete, unchanged.
- **Invites** tab — new `InvitesTab`:
  - **Invite** button → `CreateInviteModal`: email, first/last name, role `Select`,
    expiry `Select` (24h / 3 days / 7 days → hours), switches *Require name* and
    *Require two-factor*. On success, show the returned `link` with a Mantine
    `CopyButton` and a "Email sent to <email>" note.
  - Table: email, role badge, requirement badges (Name / 2FA), status badge
    (Pending/Expired/Revoked) with expiry date. Row menu: **Copy link**
    (`GET /{id}/link` → clipboard), **Resend email**, **Revoke**.

`api/types.ts`: add `ConsoleInvite` (`id, email, role, firstName, lastName, requireName,
requireTwoFactor, createdAt, expiresAt, status`) and `InvitePreview`
(`email, firstName, lastName, requireName, requireTwoFactor`).

`api/client.ts`: add `listInvites`, `createInvite`, `inviteLink(id)`, `resendInvite(id)`,
`revokeInvite(id)`, `invitePreview(token)`, `acceptInvite(body)`.

### `pages/AcceptInvitePage.tsx` (new — mirrors `ResetPasswordPage`)
Reads `token` from query; calls `invitePreview` on mount. On invalid/expired → error card.
Otherwise renders read-only email, first/last name inputs (prefilled; required when
`requireName`), and a password field. Submit → `acceptInvite` → success card linking to
sign-in. When `requireTwoFactor`, note "You'll set up two-factor authentication after
signing in." (the existing `mustSetupTwoFactor` gate in `AuthGate.tsx` handles enrollment —
no new 2FA UI).

## Testing

### Backend — `tests/Winche.Console.Tests/InviteFlowTests.cs`
Mirror `EmailFlowTests` (email-app fixture + `FakeEmailSender` capturing `LastInviteLink`):
- Admin creates invite → email sent, link returned.
- Accept sets password + profile + role; the new user logs in.
- `requireName`: accept with blank names → 400; with names → 200.
- `requireTwoFactor`: after accept, `auth/state` for the user shows `mustSetupTwoFactor`.
- Revoke → preview and accept return 410.
- Resend → returns a working link; accept succeeds.
- Non-admin → 403 on create/list.
- No `IConsoleEmailSender` configured → create returns 400.
- Duplicate: existing user email / existing pending invite → 409.

### Backend — unit
`ConsoleInviteTokens`: round-trip `Protect`/`TryUnprotect`; a near-zero lifetime token
fails `TryUnprotect` (expiry path).

### Backend — update `EmailFlowTests.cs`
Rewrite `Invite_creates_user_who_sets_password_via_link` to drive the new
`/api/invites` flow. Keep the "no-password `POST /api/users` is rejected" assertion (now
true regardless of email configuration); adjust its comment.

### Frontend
- `AcceptInvitePage` test: renders from a mocked preview and submits.
- Minimal `UsersPage` test: the Users/Invites tabs render.

## Versioning
Feature bump → **1.3.0** (csproj version + README note under the email/invite section).

## Out of scope
- Generic reusable/multi-use signup links (not tied to one email).
- Bulk invites.
- Invite-acceptance auto-login (invitee is sent to the sign-in page after accepting).
