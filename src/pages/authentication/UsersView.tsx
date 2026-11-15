import { useAuthApi, useAuthScope } from "./authScope";
import { api } from "../../api/client";
import { useEffect, useState } from "react";
import {
  Alert, Avatar, Badge, Button, Code, Group, Loader, Modal, Paper, PasswordInput, Stack, Switch, Table, Text, Textarea, TextInput, Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, providerLabel, statusOf, type AppUser, type UserStatus } from "../../api/appAuth";
import { EmptyState } from "../../components/EmptyState";
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
        {selected && <UserPanel uid={selected} onGone={() => setSelected(null)} />}
      </Group>

      <AddUserModal opened={adding} onClose={() => setAdding(false)} onAdded={(u) => { setAdding(false); setSelected(u.uid); }} />
    </Stack>
  );
}

function UserPanel({ uid, onGone }: { uid: string; onGone: () => void }) {
  const authApi = useAuthApi();
  const consoleAccounts = useAuthScope().console;
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["app-user", uid], queryFn: () => authApi.appUser(uid) });
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: authApi.appAuthConfig });
  const [notice, setNotice] = useState<string | null>(null);
  const [claims, setClaims] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (detail.data) setClaims(Object.keys(detail.data.user.customClaims).length ? JSON.stringify(detail.data.user.customClaims, null, 2) : "");
  }, [detail.data]);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ["app-user", uid] });
      await qc.invalidateQueries({ queryKey: ["app-users"] });
      if (done) setNotice(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (detail.isLoading) return <Paper withBorder p="md" style={{ flex: "1 1 340px" }}><Loader size="sm" /></Paper>;
  if (!detail.data) return null;
  const { user: u, sessions, mfa } = detail.data;
  const caps = config.data?.directory?.capabilities;
  // Signed in through a provider with Keycloak sync on: the account is Keycloak's, and Winche follows it.
  const fromKeycloak = u.providers.some((p) => config.data?.identityProviders.some((x) => x.name === p && x.keycloakSync));
  const can = (c: keyof NonNullable<typeof caps>) => !caps || !!caps[c];
  const status = statusOf(u);
  const name = u.displayName ?? (u.isAnonymous ? "Anonymous user" : u.email ?? u.uid);

  const saveClaims = () => run(async () => {
    let parsed: Record<string, unknown> | null = null;
    if (claims.trim()) {
      try { parsed = JSON.parse(claims); } catch { throw new Error("The claims aren't valid JSON."); }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Custom claims must be a JSON object.");
    }
    await authApi.setAppUserClaims(uid, parsed);
  });

  return (
    <Paper withBorder p="md" style={{ flex: "1 1 340px", minWidth: 0 }} aria-label="Selected user">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <Avatar color="winche" radius="xl">{u.isAnonymous ? "?" : name.slice(0, 1).toUpperCase()}</Avatar>
          <div style={{ minWidth: 0 }}>
            <Text fw={600} truncate>{name}</Text>
            <Text size="sm" c="dimmed" truncate>{u.email ?? "No email · signed in as a guest"}</Text>
          </div>
        </Group>

        {fromKeycloak && (
          <Alert color="blue" p="xs" data-testid="from-keycloak" title="From Keycloak">
            Their account is managed in Keycloak: disable, delete or change them there, and Winche follows within minutes.
          </Alert>
        )}
        <Table fz="sm" withRowBorders={false} verticalSpacing={2}>
          <Table.Tbody>
            <Table.Tr><Table.Td c="dimmed" w={120}>uid</Table.Td><Table.Td><Text size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>{u.uid}</Text></Table.Td></Table.Tr>
            <Table.Tr><Table.Td c="dimmed">Email verified</Table.Td><Table.Td>{u.email ? (u.emailVerified ? "Yes" : "No") : "No email"}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td c="dimmed">Created</Table.Td><Table.Td>{when(u.createdAt)}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td c="dimmed">Last sign-in</Table.Td><Table.Td>{when(u.lastSignInAt)}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td c="dimmed">Status</Table.Td><Table.Td>
              <Badge color={STATUS_COLOR[status]} variant="light" tt="none">{status}</Badge>
              {u.lockedOutUntil && status === "Locked out" && <Text span size="xs" c="dimmed"> until {when(u.lockedOutUntil)}</Text>}
            </Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>

        {consoleAccounts && (
          <Stack gap={8} data-testid="console-account">
            <Title order={6}>Console account</Title>
            <Switch label="Server admin" checked={u.customClaims.role === "Admin"} disabled={busy}
              description="Admin of every project and of Server settings. Others reach a project as its members."
              onChange={(e) => {
                const admin = e.currentTarget.checked;
                void run(() => api.updateUser(uid, { role: admin ? "Admin" : "Member" }), admin ? "Now a server admin." : "No longer a server admin.");
              }} />
            {newPassword === null ? (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">{u.providers.includes("password") ? "Has a password" : "No password: signs in through a provider"}</Text>
                <Button size="xs" variant="default" onClick={() => setNewPassword("")}>Set a new password</Button>
              </Group>
            ) : (
              <Stack gap={6}>
                <PasswordInput label="New password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)}
                  description="Tell them yourself; their sign-ins elsewhere end." />
                <Group justify="flex-end" gap="xs">
                  <Button size="xs" variant="default" onClick={() => setNewPassword(null)}>Cancel</Button>
                  <Button size="xs" loading={busy} disabled={newPassword.length < 8}
                    onClick={() => run(async () => { await api.resetUserPassword(uid, newPassword); setNewPassword(null); }, "Password set.")}>
                    Save password
                  </Button>
                </Group>
              </Stack>
            )}
            {newEmail === null ? (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">{u.email}</Text>
                <Button size="xs" variant="default" onClick={() => setNewEmail(u.email ?? "")}>Change email</Button>
              </Group>
            ) : (
              <Stack gap={6}>
                <TextInput label="New email" value={newEmail} onChange={(e) => setNewEmail(e.currentTarget.value)}
                  description="Changed at once; they sign in again with it." />
                <Group justify="flex-end" gap="xs">
                  <Button size="xs" variant="default" onClick={() => setNewEmail(null)}>Cancel</Button>
                  <Button size="xs" loading={busy} disabled={!newEmail.includes("@") || newEmail.trim() === u.email}
                    onClick={() => run(async () => { await api.updateUser(uid, { email: newEmail.trim() }); setNewEmail(null); }, "Email changed; their sign-ins ended.")}>
                    Save email
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        )}

        <Stack gap={6}>
          <Title order={6}>Sign-in methods</Title>
          {u.providers.length === 0 && <Text size="sm" c="dimmed">None yet: send a reset link to set a password.</Text>}
          {u.providers.map((p) => {
            const linked = p !== "password" && p !== "anonymous";
            return (
              <Group key={p} justify="space-between" wrap="nowrap" data-testid="app-user-provider"
                style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: "6px 10px" }}>
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

        <Stack gap={6}>
          <Group justify="space-between"><Title order={6}>{caps?.claimsLabel ?? "Custom claims"}</Title>
            <Text size="xs" c="dimmed">rules: request.auth.token.*</Text></Group>
          <Textarea autosize minRows={3} ff="monospace" fz="xs" aria-label="Custom claims (JSON)" placeholder='{ "role": "clinician" }'
            value={claims} onChange={(e) => setClaims(e.currentTarget.value)} />
          <Text size="xs" c="dimmed">In the user's next token: when they next refresh or sign in.</Text>
          <Button size="xs" variant="default" w="fit-content" loading={busy} onClick={saveClaims}>Save claims</Button>
        </Stack>

        <Stack gap={6}>
          <Title order={6}>Sessions</Title>
          {sessions.length === 0 && <EmptyState compact bordered={false} icon={IconDevices} title="Not signed in anywhere" />}
          {sessions.map((s) => (
            <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs" data-testid="app-session"
              style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: "6px 10px" }}>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" truncate>{s.userAgent ?? "Unknown device"}</Text>
                <Text size="xs" c="dimmed">{s.provider} · {s.ipAddress ?? "no address"} · last used {when(s.lastUsedAt)}</Text>
              </div>
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.revokeAppSession(uid, s.id))}>Sign out</Button>
            </Group>
          ))}
        </Stack>

        {error && <Alert color="red">{error}</Alert>}
        {notice && <Alert color="teal">{notice}</Alert>}
        {u.email && !fromKeycloak && (
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
        )}
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={busy || sessions.length === 0} onClick={() => run(() => authApi.signOutAppUser(uid))}>Sign out everywhere</Button>
          {status === "Locked out" && can("unlock") && <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.unlockAppUser(uid))}>Unlock</Button>}
          {!fromKeycloak && (
            <>
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => authApi.setAppUserDisabled(uid, !u.disabled))}>
                {u.disabled ? "Enable user" : "Disable user"}
              </Button>
              <Button size="xs" variant="outline" color="red" disabled={busy}
                onClick={() => window.confirm(`Delete ${u.email ?? u.uid}? Their sign-in goes; their data in the database stays.`) &&
                  run(async () => { await authApi.deleteAppUser(uid); onGone(); })}>
                Delete user
              </Button>
            </>
          )}
        </Group>
        <Text size="xs" c="dimmed">Their data: <Code fz="xs">users/{u.uid}</Code> and wherever your rules keep it.</Text>
      </Stack>
    </Paper>
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
