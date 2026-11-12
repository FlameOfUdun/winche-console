import { useEffect, useState } from "react";
import {
  Alert, Avatar, Badge, Button, Code, Group, Loader, Modal, Paper, PasswordInput, Stack, Table, Text, Textarea, TextInput, Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, providerLabel, statusOf, type AppUser, type UserStatus } from "../../api/appAuth";

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
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(0), [q]);

  const list = useQuery({ queryKey: ["app-users", q, page], queryFn: () => api.appUsers(q, page * PAGE, PAGE) });
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  const users = list.data?.users ?? [];
  const total = list.data?.total ?? 0;

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput label="Search users" placeholder="Email, name or uid" w={320} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <div style={{ flex: 1 }} />
        <Button onClick={() => setAdding(true)}>Add user</Button>
      </Group>

      {list.isError && <Alert color="red">Couldn't load the users: {errorMessage(list.error)}</Alert>}
      <Group align="flex-start" gap="md" wrap="wrap">
        <Paper withBorder style={{ flex: "999 1 520px", minWidth: 0, overflowX: "auto" }}>
          {list.isLoading ? <Loader m="md" size="sm" /> : users.length === 0 ? (
            <Text c="dimmed" size="sm" p="md">{q ? "No users match." : "No users yet. They appear here when they sign up."}</Text>
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
                      style={{ cursor: "pointer", background: selected === u.uid ? "var(--mantine-color-blue-0)" : undefined }}>
                      <Table.Td>
                        <Text size="sm" fw={500}>{u.email ?? "Anonymous user"}</Text>
                        <Text size="xs" c="dimmed" ff="monospace">{u.uid}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>{u.providers.map((p) => <Badge key={p} size="sm" variant="light" tt="none">{providerLabel(p, config.data)}</Badge>)}</Group>
                      </Table.Td>
                      <Table.Td><Text size="xs">{when(u.createdAt)}</Text></Table.Td>
                      <Table.Td><Text size="xs">{when(u.lastSignInAt)}</Text></Table.Td>
                      <Table.Td><Badge color={STATUS_COLOR[status]} variant="light" tt="none">{status}</Badge></Table.Td>
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
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["app-user", uid], queryFn: () => api.appUser(uid) });
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
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
  const { user: u, sessions } = detail.data;
  const status = statusOf(u);
  const name = u.displayName ?? (u.isAnonymous ? "Anonymous user" : u.email ?? u.uid);

  const saveClaims = () => run(async () => {
    let parsed: Record<string, unknown> | null = null;
    if (claims.trim()) {
      try { parsed = JSON.parse(claims); } catch { throw new Error("The claims aren't valid JSON."); }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Custom claims must be a JSON object.");
    }
    await api.setAppUserClaims(uid, parsed);
  });

  return (
    <Paper withBorder p="md" style={{ flex: "1 1 340px", minWidth: 0 }} aria-label="Selected user">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <Avatar color="blue" radius="xl">{u.isAnonymous ? "?" : name.slice(0, 1).toUpperCase()}</Avatar>
          <div style={{ minWidth: 0 }}>
            <Text fw={600} truncate>{name}</Text>
            <Text size="sm" c="dimmed" truncate>{u.email ?? "No email · signed in as a guest"}</Text>
          </div>
        </Group>

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

        <Stack gap={6}>
          <Title order={6}>Sign-in methods</Title>
          {u.providers.length === 0 && <Text size="sm" c="dimmed">None yet: send a reset link to set a password.</Text>}
          {u.providers.map((p) => {
            const linked = p !== "password" && p !== "anonymous";
            return (
              <Group key={p} justify="space-between" wrap="nowrap" data-testid="app-user-provider"
                style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: "6px 10px" }}>
                <Text size="sm">{providerLabel(p, config.data)}</Text>
                {linked && u.providers.length > 1 && (
                  <Button size="xs" variant="subtle" disabled={busy}
                    onClick={() => window.confirm(`Unlink ${providerLabel(p, config.data)} from this user?`) && run(() => api.unlinkAppUserProvider(uid, p))}>
                    Unlink
                  </Button>
                )}
              </Group>
            );
          })}
        </Stack>

        <Stack gap={6}>
          <Group justify="space-between"><Title order={6}>Custom claims</Title><Text size="xs" c="dimmed">rules: request.auth.token.*</Text></Group>
          <Textarea autosize minRows={3} ff="monospace" fz="xs" aria-label="Custom claims (JSON)" placeholder='{ "role": "clinician" }'
            value={claims} onChange={(e) => setClaims(e.currentTarget.value)} />
          <Text size="xs" c="dimmed">In the user's next token: when they next refresh or sign in.</Text>
          <Button size="xs" variant="default" w="fit-content" loading={busy} onClick={saveClaims}>Save claims</Button>
        </Stack>

        <Stack gap={6}>
          <Title order={6}>Sessions</Title>
          {sessions.length === 0 && <Text size="sm" c="dimmed">No active sessions.</Text>}
          {sessions.map((s) => (
            <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs" data-testid="app-session"
              style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8, padding: "6px 10px" }}>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" truncate>{s.userAgent ?? "Unknown device"}</Text>
                <Text size="xs" c="dimmed">{s.provider} · {s.ipAddress ?? "no address"} · last used {when(s.lastUsedAt)}</Text>
              </div>
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => api.revokeAppSession(uid, s.id))}>Sign out</Button>
            </Group>
          ))}
        </Stack>

        {error && <Alert color="red">{error}</Alert>}
        {notice && <Alert color="teal">{notice}</Alert>}
        {u.email && (
          <Group gap="xs">
            {config.data?.email && config.data.emailPassword && (
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => api.sendAppUserPasswordReset(uid), `A reset link is on its way to ${u.email}.`)}>Send password reset</Button>
            )}
            {config.data?.email && !u.emailVerified && (
              <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => api.sendAppUserVerification(uid), `A verify link is on its way to ${u.email}.`)}>Send verify email</Button>
            )}
            <Button size="xs" variant="subtle" disabled={busy} onClick={() => run(() => api.setAppUserVerified(uid, !u.emailVerified))}>
              {u.emailVerified ? "Mark not verified" : "Mark verified"}
            </Button>
          </Group>
        )}
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={busy || sessions.length === 0} onClick={() => run(() => api.signOutAppUser(uid))}>Sign out everywhere</Button>
          {status === "Locked out" && <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => api.unlockAppUser(uid))}>Unlock</Button>}
          <Button size="xs" variant="default" disabled={busy} onClick={() => run(() => api.setAppUserDisabled(uid, !u.disabled))}>
            {u.disabled ? "Enable user" : "Disable user"}
          </Button>
          <Button size="xs" variant="outline" color="red" disabled={busy}
            onClick={() => window.confirm(`Delete ${u.email ?? u.uid}? Their sign-in goes; their data in the database stays.`) &&
              run(async () => { await api.deleteAppUser(uid); onGone(); })}>
            Delete user
          </Button>
        </Group>
        <Text size="xs" c="dimmed">Their data: <Code fz="xs">users/{u.uid}</Code> and wherever your rules keep it.</Text>
      </Stack>
    </Paper>
  );
}

function AddUserModal({ opened, onClose, onAdded }: { opened: boolean; onClose: () => void; onAdded: (u: AppUser) => void }) {
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
      const u = await api.createAppUser({ email: email.trim() || undefined, password: password || undefined, displayName: displayName.trim() || undefined });
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
