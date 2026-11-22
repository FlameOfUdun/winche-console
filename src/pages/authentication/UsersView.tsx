import { useAuthApi, useAuthScope } from "./authScope";
import { api } from "../../api/client";
import { useEffect, useState } from "react";
import {
  Alert, Avatar, Badge, Button, Code, CopyButton, FileButton, Group, Loader, Modal, Paper, PasswordInput, SegmentedControl, Stack, Switch, Table, Tabs, Text,
  Textarea, TextInput, Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, providerLabel, statusOf, type AppUser, type DirectoryCapabilities, type UserStatus } from "../../api/appAuth";
import { EmptyState } from "../../components/EmptyState";
import { ScrollDialog } from "../../components/ScrollDialog";
import { squareThumbnail } from "../../components/ProjectAvatar";
import { IconSearch, IconUsers } from "@tabler/icons-react";
import { IconDevices } from "@tabler/icons-react";

const PAGE = 50;
const STATUS_COLOR: Record<UserStatus, string> = { Active: "teal", Disabled: "red", "Locked out": "red", "Not verified": "yellow", Guest: "violet" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const when = (at: string | null) =>
  at ? new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";

/** Search the app's users, open one for details and actions. */
export function UsersView() {
  const authApi = useAuthApi();
  const consoleAccounts = useAuthScope().console;
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(0), [q]);

  const list = useQuery({ queryKey: ["app-users", q, page], queryFn: () => authApi.appUsers(q, page * PAGE, PAGE) });
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const users = list.data?.users ?? [];
  const total = list.data?.total ?? 0;

  const none = !list.isLoading && !q && users.length === 0 && page === 0;
  return (
    <Stack gap="sm">
      {!none && (
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput aria-label="Search users" placeholder="Search by email, name or uid" leftSection={<IconSearch size={16} />} w={340}
            value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <div style={{ flex: 1 }} />
          {(config.data?.directory?.capabilities.create ?? true) && <Button onClick={() => setAdding(true)}>Add user</Button>}
        </Group>
      )}

      {list.isError && <Alert color="red">Couldn't load the users: {errorMessage(list.error)}</Alert>}
      <Group align="flex-start" gap="md" wrap="wrap">
        <Paper withBorder style={{ flex: "999 1 520px", minWidth: 0, overflowX: "auto" }}>
          {list.isLoading ? <Loader m="md" size="sm" /> : users.length === 0 ? (q
            ? <EmptyState compact bordered={false} icon={IconSearch} title="No users match" description={<>Nothing for “{q}”. Search by email, name or uid.</>} />
            : <EmptyState bordered={false} icon={IconUsers} title="No users yet"
                description="Your apps' users appear here when they sign up. You can also add one yourself."
                action={(config.data?.directory?.capabilities.create ?? true) && <Button onClick={() => setAdding(true)}>Add user</Button>} />
          ) : (
            <Table highlightOnHover verticalSpacing={8} fz="sm" miw={640}>
              <Table.Thead>
                <Table.Tr><Table.Th>User</Table.Th><Table.Th>Sign-in methods</Table.Th><Table.Th>Created</Table.Th><Table.Th>Last sign-in</Table.Th><Table.Th>Status</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.map((u) => {
                  const status = statusOf(u);
                  return (
                    <Table.Tr key={u.uid} data-testid="app-user" onClick={() => setSelected(u.uid)}
                      style={{ cursor: "pointer", background: selected === u.uid ? "var(--w-accent-soft)" : undefined }}>
                      <Table.Td>
                        <Text size="sm" fw={500}>{u.email ?? "Anonymous user"}</Text>
                        <Text size="xs" c="dimmed" ff="monospace">{u.uid}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {u.providers.map((p) => <Badge key={p} size="sm" variant="light" tt="none">{providerLabel(p, config.data)}</Badge>)}
                          {u.mfaEnabled && <Badge size="sm" variant="light" color="teal" tt="none">Two-step</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td><Text size="xs">{when(u.createdAt)}</Text></Table.Td>
                      <Table.Td><Text size="xs">{when(u.lastSignInAt)}</Text></Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Badge color={STATUS_COLOR[status]} variant="light" tt="none">{status}</Badge>
                          {consoleAccounts && u.customClaims.role === "Admin" && <Badge color="winche" variant="light" tt="none">Server admin</Badge>}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
          {total > PAGE && (
            <Group justify="space-between" p="xs">
              <Text size="xs" c="dimmed">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</Text>
              <Group gap="xs">
                <Button size="xs" variant="subtle" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
                <Button size="xs" variant="subtle" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Older</Button>
              </Group>
            </Group>
          )}
        </Paper>
      </Group>
      <UserDialog uid={selected} onClose={() => setSelected(null)} />

      <AddUserModal opened={adding} onClose={() => setAdding(false)} onAdded={(u) => { setAdding(false); setSelected(u.uid); }} />
    </Stack>
  );
}

type Tab = "profile" | "signin" | "access" | "sessions";

/**
 * A user, in a dialog with tabs: their profile (editable), how they sign in, what they may do, where they're signed in.
 * Deleting them sits apart, at the foot.
 */
function UserDialog({ uid, onClose }: { uid: string | null; onClose: () => void }) {
  const authApi = useAuthApi();
  const consoleAccounts = useAuthScope().console;
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["app-user", uid], queryFn: () => authApi.appUser(uid!), enabled: !!uid });
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const [tab, setTab] = useState<Tab>("profile");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setTab("profile"); setNotice(null); setError(null); setConfirmDelete(false); }, [uid]);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ["app-user", uid] });
      await qc.invalidateQueries({ queryKey: ["app-users"] });
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const u = detail.data?.user;
  const caps = config.data?.directory?.capabilities;
  const can = (c: keyof NonNullable<typeof caps>) => !caps || !!caps[c];
  // Signed in through a provider with Keycloak sync on: the account is Keycloak's, and Winche follows it.
  const fromKeycloak = !!u && u.providers.some((p) => config.data?.identityProviders.some((x) => x.name === p && x.keycloakSync));
  const status = u ? statusOf(u) : null;
  const name = u ? u.displayName ?? (u.isAnonymous ? "Anonymous user" : u.email ?? u.uid) : "";

  return (
    <ScrollDialog opened={!!uid} onClose={onClose} size="xl" ariaLabel={u ? `User: ${name}` : "User"}
      footer={u && detail.data ? (
        <Group justify="space-between" wrap="wrap" gap="xs" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">Their data: <Code fz="xs">users/{u.uid}</Code> and wherever your rules keep it. Created {when(u.createdAt)}.</Text>
          {!fromKeycloak && can("delete") && (confirmDelete ? (
            <Group gap="xs">
              <Text size="xs">Delete {u.email ?? u.uid}? Their sign-in goes; their data stays.</Text>
              <Button size="xs" variant="default" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button size="xs" color="red" loading={busy} onClick={() => run(async () => { await authApi.deleteAppUser(uid!); onClose(); })}>Delete user</Button>
            </Group>
          ) : (
            <Button size="xs" variant="outline" color="red" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete user</Button>
          ))}
        </Group>
      ) : undefined}
      title={u ? (
        <Group gap="sm" wrap="nowrap">
          <Avatar src={u.photoUrl ?? undefined} color="winche" radius="xl">{u.isAnonymous ? "?" : name.slice(0, 1).toUpperCase()}</Avatar>
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={700} truncate>{name}</Text>
              {status && <Badge color={STATUS_COLOR[status]} variant="light" tt="none">{status}</Badge>}
              {fromKeycloak && <Badge color="blue" variant="light" tt="none">From Keycloak</Badge>}
              {consoleAccounts && u.customClaims.role === "Admin" && <Badge color="winche" variant="light" tt="none">Server admin</Badge>}
            </Group>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed" ff="monospace" truncate>{u.uid}</Text>
              <CopyButton value={u.uid}>{({ copied, copy }) => <Button size="compact-xs" variant="subtle" color={copied ? "teal" : "gray"} onClick={copy}>{copied ? "Copied" : "Copy uid"}</Button>}</CopyButton>
            </Group>
          </div>
        </Group>
      ) : "User"}>
      {detail.isLoading && <Loader size="sm" />}
      {u && detail.data && (
        <Stack gap="md">
          {fromKeycloak && (
            <Alert color="blue" p="xs" data-testid="from-keycloak" title="From Keycloak">
              Their account is managed in Keycloak: change, disable or delete them there, and Winche follows within minutes.
            </Alert>
          )}
          <Tabs value={tab} onChange={(t) => { setTab((t as Tab) ?? "profile"); setNotice(null); setError(null); }} keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="profile">Profile</Tabs.Tab>
              <Tabs.Tab value="signin">Sign-in</Tabs.Tab>
              <Tabs.Tab value="access">Access</Tabs.Tab>
              <Tabs.Tab value="sessions">Sessions{detail.data.sessions.length ? ` (${detail.data.sessions.length})` : ""}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="profile" pt="md">
              <ProfileTab user={u} uid={uid!} busy={busy} run={run} readOnly={fromKeycloak} caps={caps} consoleAccounts={consoleAccounts} />
            </Tabs.Panel>
            <Tabs.Panel value="signin" pt="md">
              <SignInTab user={u} uid={uid!} busy={busy} run={run} fromKeycloak={fromKeycloak} mfa={detail.data.mfa} />
            </Tabs.Panel>
            <Tabs.Panel value="access" pt="md">
              <AccessTab user={u} uid={uid!} busy={busy} run={run} fromKeycloak={fromKeycloak} />
            </Tabs.Panel>
            <Tabs.Panel value="sessions" pt="md">
              <Stack gap={6}>
                {detail.data.sessions.length === 0 && <EmptyState compact bordered={false} icon={IconDevices} title="Not signed in anywhere" />}
                {detail.data.sessions.map((s) => (
                  <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs" data-testid="app-session"
                    style={{ border: "1px solid var(--w-border)", borderRadius: 8, padding: "6px 10px" }}>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>{s.userAgent ?? "Unknown device"}</Text>
                      <Text size="xs" c="dimmed">{s.provider} · {s.ipAddress ?? "no address"} · last used {when(s.lastUsedAt)}</Text>
                    </div>
                    <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.revokeAppSession(uid!, s.id))}>Sign out</Button>
                  </Group>
                ))}
                <Button size="xs" variant="default" w="fit-content" disabled={busy || detail.data.sessions.length === 0} onClick={() => run(() => authApi.signOutAppUser(uid!))}>Sign out everywhere</Button>
              </Stack>
            </Tabs.Panel>
          </Tabs>

          {error && <Alert color="red">{error}</Alert>}
          {notice && <Alert color="teal">{notice}</Alert>}
        </Stack>
      )}
    </ScrollDialog>
  );
}

type TabProps = { user: AppUser; uid: string; busy: boolean; run: (f: () => Promise<unknown>, done?: string) => Promise<boolean> };

/** Where the photo came from, in words. */
export function photoSourceLabel(source: string | null | undefined, url: string | null, config?: Parameters<typeof providerLabel>[1]): string {
  if (!url) return "No photo";
  if (source === "upload") return "Uploaded";
  if (source === "link") return "A link";
  if (source?.startsWith("provider:")) return `From ${providerLabel(source.slice("provider:".length), config)}`;
  return "A link";
}

/** Name and photo, email (at once, or by a link to the new address), password; for console accounts, the server admin role. */
function ProfileTab({ user: u, uid, busy, run, readOnly, caps, consoleAccounts }: TabProps & {
  readOnly: boolean; caps: DirectoryCapabilities | undefined; consoleAccounts: boolean;
}) {
  const authApi = useAuthApi();
  const [displayName, setDisplayName] = useState(u.displayName ?? "");
  const [photoUrl, setPhotoUrl] = useState(u.photoUrl ?? "");
  const [email, setEmail] = useState(u.email ?? "");
  const [emailMode, setEmailMode] = useState<"now" | "confirm">("now");
  const [verified, setVerified] = useState(false);
  const [sendVerification, setSendVerification] = useState(true);
  const [password, setPassword] = useState("");
  useEffect(() => { setDisplayName(u.displayName ?? ""); setPhotoUrl(u.photoUrl ?? ""); setEmail(u.email ?? ""); }, [u.displayName, u.photoUrl, u.email]);
  const canProfile = !readOnly && !!caps?.profile;
  // Keycloak keeps no photos, so its users' photos are set here too.
  const canPhoto = !consoleAccounts && !!caps?.photo && !u.isAnonymous;
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const canEmail = !readOnly && (consoleAccounts || !!caps?.email);
  const canPassword = !readOnly && (consoleAccounts || !!caps?.password);
  const profileChanged = displayName.trim() !== (u.displayName ?? "") || photoUrl.trim() !== (u.photoUrl ?? "");
  const emailChanged = email.trim() !== (u.email ?? "") && email.includes("@");
  // The address a confirm link last went to: not sent again until the address is changed.
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const linkSent = emailMode === "confirm" && !consoleAccounts && linkSentTo === email.trim();

  const saveEmail = () => consoleAccounts
    ? run(() => api.updateUser(uid, { email: email.trim() }), "Email changed; their sign-ins ended.")
    : emailMode === "confirm"
      ? run(() => authApi.setAppUserEmail(uid, email.trim(), { confirm: true }), `A link is on its way to ${email.trim()}: the email changes when they open it (their old address is told, with an undo link).`)
          .then((ok) => { if (ok) setLinkSentTo(email.trim()); })
      : run(() => authApi.setAppUserEmail(uid, email.trim(), { confirm: false, verified, sendVerification: !verified && sendVerification }),
          `Email changed; their sign-ins ended${!verified && sendVerification ? `, and a verify link is on its way to ${email.trim()}` : ""}.`);

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={6}>Name and photo</Title>
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Stack gap={6} align="center" w={96}>
            <Avatar src={photoUrl.trim() || undefined} size={64} radius="xl" color="winche">{(displayName || u.email || "?").slice(0, 1).toUpperCase()}</Avatar>
            <Text size="xs" c="dimmed" ta="center" data-testid="photo-source">{photoSourceLabel(u.photoSource, u.photoUrl, config.data)}</Text>
            {canPhoto && (
              <>
                <FileButton accept="image/png,image/jpeg,image/webp" onChange={(f) => f && run(async () => {
                  // Shrunk here to 256 × 256 (the server keeps at most 100 KB); the server checks it's an image.
                  await authApi.setAppUserPhoto(uid, await squareThumbnail(f));
                }, "Photo uploaded.")}>
                  {(props) => <Button {...props} size="compact-xs" variant="default" loading={busy}>{u.photoSource === "upload" ? "Replace" : "Upload"}</Button>}
                </FileButton>
                {u.photoSource === "upload" && (
                  <Button size="compact-xs" variant="subtle" color="gray" disabled={busy}
                    onClick={() => run(() => authApi.removeAppUserPhoto(uid), "Photo removed.")}>Remove</Button>
                )}
              </>
            )}
          </Stack>
          <Stack gap="xs" style={{ flex: 1 }}>
            <TextInput label="Display name" disabled={!canProfile} value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} maxLength={100} />
            <TextInput label="Photo URL" placeholder="https://…" disabled={!canProfile} value={photoUrl} onChange={(e) => setPhotoUrl(e.currentTarget.value)}
              description="Or a link to a photo elsewhere (replaces an uploaded one)" />
          </Stack>
        </Group>
        {canProfile && (
          <Button size="xs" w="fit-content" loading={busy} disabled={!profileChanged}
            onClick={() => run(() => authApi.updateAppUserProfile(uid, displayName.trim() || null, photoUrl.trim() || null), "Profile saved.")}>Save name and photo</Button>
        )}
      </Stack>

      {!u.isAnonymous && (
        <Stack gap="xs" data-testid="profile-email">
          <Title order={6}>Email</Title>
          <TextInput label="Email" disabled={!canEmail} value={email} onChange={(e) => setEmail(e.currentTarget.value)}
            description={u.email ? (u.emailVerified ? "Verified" : "Not verified") : "None yet"} />
          {canEmail && emailChanged && !consoleAccounts && (
            <Stack gap={6}>
              <SegmentedControl size="xs" value={emailMode} onChange={(v) => setEmailMode(v as "now" | "confirm")} w="fit-content"
                data={[{ value: "now", label: "Change it now" }, { value: "confirm", label: "Send a link to confirm" }]} />
              {emailMode === "now" ? (
                <>
                  <Text size="xs" c="dimmed">Changed at once; their sign-ins end and they sign in with the new address.</Text>
                  <Switch size="sm" label="It's verified (I know it's theirs)" checked={verified} onChange={(e) => setVerified(e.currentTarget.checked)} />
                  {!verified && <Switch size="sm" label="Send a verify link to the new address" checked={sendVerification} onChange={(e) => setSendVerification(e.currentTarget.checked)} />}
                </>
              ) : (
                <Text size="xs" c="dimmed">The new address gets a link; the email changes only when they open it, and the old address is told (with an undo link).</Text>
              )}
            </Stack>
          )}
          {canEmail && emailChanged && (
            <Group gap="xs">
              <Button size="xs" loading={busy} disabled={linkSent} onClick={saveEmail}>{linkSent ? "Link sent" : emailMode === "confirm" && !consoleAccounts ? "Send the link" : "Save email"}</Button>
              <Button size="xs" variant="subtle" onClick={() => setEmail(u.email ?? "")}>Cancel</Button>
            </Group>
          )}
        </Stack>
      )}

      {!u.isAnonymous && canPassword && (
        <Stack gap="xs">
          <Title order={6}>Password</Title>
          <Text size="xs" c="dimmed">{u.providers.includes("password") ? "Has a password." : "No password yet: they sign in another way."} A new one ends their sign-ins everywhere; tell them yourself.</Text>
          <Group align="flex-end" gap="xs">
            <PasswordInput label="New password" autoComplete="new-password" w={280} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <Button size="xs" mb={4} loading={busy} disabled={password.length < 8}
              onClick={async () => {
                if (await run(() => consoleAccounts ? api.resetUserPassword(uid, password) : authApi.setAppUserPassword(uid, password), "Password set; their sign-ins ended.")) setPassword("");
              }}>Set password</Button>
          </Group>
        </Stack>
      )}

      {consoleAccounts && (
        <Stack gap={8} data-testid="console-account">
          <Title order={6}>Console account</Title>
          <Switch label="Server admin" checked={u.customClaims.role === "Admin"} disabled={busy}
            description="Admin of every project and of Server settings. Others reach a project as its members."
            onChange={(e) => {
              const admin = e.currentTarget.checked;
              void run(() => api.updateUser(uid, { role: admin ? "Admin" : "Member" }), admin ? "Now a server admin." : "No longer a server admin.");
            }} />
        </Stack>
      )}
    </Stack>
  );
}

/** How they sign in: methods (unlink), two-step sign-in, a locked account, emails for reset and verification. */
function SignInTab({ user: u, uid, busy, run, fromKeycloak, mfa }: TabProps & { fromKeycloak: boolean; mfa?: { recoveryCodesLeft: number } | null }) {
  const authApi = useAuthApi();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const caps = config.data?.directory?.capabilities;
  const can = (c: keyof NonNullable<typeof caps>) => !caps || !!caps[c];
  const status = statusOf(u);
  return (
    <Stack gap="lg">
      <Table fz="sm" withRowBorders={false} verticalSpacing={2}>
        <Table.Tbody>
          <Table.Tr><Table.Td c="dimmed" w={140}>Last sign-in</Table.Td><Table.Td>{when(u.lastSignInAt)}</Table.Td></Table.Tr>
          <Table.Tr><Table.Td c="dimmed">Email verified</Table.Td><Table.Td>{u.email ? (u.emailVerified ? "Yes" : "No") : "No email"}</Table.Td></Table.Tr>
          {status === "Locked out" && (
            <Table.Tr><Table.Td c="dimmed">Locked out</Table.Td><Table.Td>
              <Group gap="xs">{u.lockedOutUntil && <Text size="sm">until {when(u.lockedOutUntil)}</Text>}
                {can("unlock") && <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.unlockAppUser(uid))}>Unlock</Button>}</Group>
            </Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Stack gap={6}>
        <Title order={6}>Sign-in methods</Title>
        {u.providers.length === 0 && <Text size="sm" c="dimmed">None yet: set a password, or send a reset link.</Text>}
        {u.providers.map((p) => {
          const linked = p !== "password" && p !== "anonymous";
          return (
            <Group key={p} justify="space-between" wrap="nowrap" data-testid="app-user-provider"
              style={{ border: "1px solid var(--w-border)", borderRadius: 8, padding: "6px 10px" }}>
              <Text size="sm">{providerLabel(p, config.data)}</Text>
              {linked && can("unlinkProviders") && u.providers.length > 1 && (
                <Button size="xs" variant="subtle" disabled={busy}
                  onClick={() => window.confirm(`Unlink ${providerLabel(p, config.data)} from this user?`) && run(() => authApi.unlinkAppUserProvider(uid, p))}>
                  Unlink
                </Button>
              )}
            </Group>
          );
        })}
      </Stack>

      {(u.mfaEnabled || config.data?.mfa) && (
        <Stack gap={6}>
          <Title order={6}>Two-step sign-in</Title>
          {u.mfaEnabled ? (
            <Group justify="space-between" wrap="nowrap" gap="xs" data-testid="app-user-mfa">
              <Text size="sm">On: authenticator app{mfa?.recoveryCodesLeft != null ? ` · ${mfa.recoveryCodesLeft} recovery code${mfa.recoveryCodesLeft === 1 ? "" : "s"} left` : ""}</Text>
              <Button size="xs" variant="subtle" color="red" disabled={busy}
                onClick={() => window.confirm("Turn off two-step sign-in for this user? Do this only if you've confirmed who they are (a lost phone).") &&
                  run(() => authApi.resetAppUserMfa(uid), "Two-step sign-in is off: they sign in with just their first step until they add an app again.")}>
                Turn off
              </Button>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">Off. The user turns it on from the app.</Text>
          )}
        </Stack>
      )}

      {u.email && !fromKeycloak && (
        <Stack gap={6}>
          <Title order={6}>Emails</Title>
          <Group gap="xs">
            {can("passwordReset") && config.data?.email && config.data.emailPassword && (
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.sendAppUserPasswordReset(uid), `A reset link is on its way to ${u.email}.`)}>Send password reset</Button>
            )}
            {can("verify") && config.data?.email && !u.emailVerified && (
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.sendAppUserVerification(uid), `A verify link is on its way to ${u.email}.`)}>Send verify email</Button>
            )}
            <Button size="xs" variant="subtle" disabled={busy} onClick={() => run(() => authApi.setAppUserVerified(uid, !u.emailVerified))}>
              {u.emailVerified ? "Mark not verified" : "Mark verified"}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}

/** What they may do: custom claims (in their next token), and turning the account off. */
function AccessTab({ user: u, uid, busy, run, fromKeycloak }: TabProps & { fromKeycloak: boolean }) {
  const authApi = useAuthApi();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const caps = config.data?.directory?.capabilities;
  const [claims, setClaims] = useState(Object.keys(u.customClaims).length ? JSON.stringify(u.customClaims, null, 2) : "");
  const [claimsError, setClaimsError] = useState<string | null>(null);
  useEffect(() => setClaims(Object.keys(u.customClaims).length ? JSON.stringify(u.customClaims, null, 2) : ""), [u.customClaims]);
  const parsed = (): Record<string, unknown> | null => {
    if (!claims.trim()) return null;
    let p: unknown;
    try { p = JSON.parse(claims); } catch { throw new Error("The claims aren't valid JSON."); }
    if (typeof p !== "object" || p === null || Array.isArray(p)) throw new Error("Custom claims must be a JSON object.");
    return p as Record<string, unknown>;
  };
  return (
    <Stack gap="lg">
      <Stack gap={6}>
        <Group justify="space-between"><Title order={6}>{caps?.claimsLabel ?? "Custom claims"}</Title>
          <Text size="xs" c="dimmed">rules: request.auth.token.*</Text></Group>
        <Textarea autosize minRows={4} ff="monospace" fz="xs" aria-label="Custom claims (JSON)" placeholder='{ "role": "editor" }'
          value={claims} onChange={(e) => { setClaims(e.currentTarget.value); setClaimsError(null); }} error={claimsError} />
        <Text size="xs" c="dimmed">In the user's next token: when they next refresh or sign in.</Text>
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={busy || !claims.trim()} onClick={() => {
            try { setClaims(JSON.stringify(parsed(), null, 2)); setClaimsError(null); } catch (e) { setClaimsError((e as Error).message); }
          }}>Format</Button>
          <Button size="xs" loading={busy} onClick={() => {
            try { const p = parsed(); void run(() => authApi.setAppUserClaims(uid, p), "Claims saved."); } catch (e) { setClaimsError((e as Error).message); }
          }}>Save claims</Button>
        </Group>
      </Stack>
      {!fromKeycloak && (!caps || caps.disable) && (
        <Stack gap={6}>
          <Title order={6}>Account</Title>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{u.disabled ? "Disabled: they can't sign in, and their sign-ins have ended." : "Enabled: they can sign in."}</Text>
            <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.setAppUserDisabled(uid, !u.disabled))}>
              {u.disabled ? "Enable user" : "Disable user"}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}

function AddUserModal({ opened, onClose, onAdded }: { opened: boolean; onClose: () => void; onAdded: (u: AppUser) => void }) {
  const authApi = useAuthApi();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const u = await authApi.createAppUser({ email: email.trim() || undefined, password: password || undefined, displayName: displayName.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ["app-users"] });
      setEmail(""); setPassword(""); setDisplayName("");
      onAdded(u);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Add user">
      <Stack gap="sm">
        <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <PasswordInput label="Password" description="Optional: without one, they can't sign in with a password yet." value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <TextInput label="Display name" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={add} loading={busy} disabled={!email.trim()}>Add user</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
