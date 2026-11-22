import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Code, CopyButton, Group, Loader, Modal, Paper, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconCheck, IconCopy, IconPlus, IconRobot } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { ServiceAccount } from "../../api/serviceAccounts";
import { when } from "../authentication/UsersView";
import { EmptyState } from "../../components/EmptyState";

const SCOPE_LABEL: Record<string, string> = { functions: "Deploy functions", rules: "Deploy rules", indexes: "Deploy indexes", assets: "Publish assets" };
const ROLE_LABEL: Record<string, string> = { Viewer: "Viewer: reads", Member: "Member: reads and writes data", Admin: "Admin: everything" };
const DAYS = [{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "1 year" }, { value: "730", label: "2 years" }];

/**
 * Service accounts: what CI and other servers act as. Each has a role or deploy scopes; it signs in with a key (two at
 * most, so one replaces the other with no downtime) or a trusted identity (its CI's own token: nothing stored), and
 * either is exchanged for an hour's access token. The CLI's own sign-in (winche login) is a session of an account.
 */
export function ServiceAccountsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["service-accounts"], queryFn: api.serviceAccounts });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ account: string; value: string } | null>(null);
  const [trusting, setTrusting] = useState<ServiceAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["service-accounts"] });

  if (list.isLoading) return <Loader size="sm" />;
  if (list.isError || !list.data) return <Alert color="red">Couldn't load the service accounts: {errorMessage(list.error)}</Alert>;
  const data = list.data;

  const run = async (what: () => Promise<unknown>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    try { await what(); await refresh(); } catch (e) { setError(errorMessage(e)); }
  };
  const addKey = (a: ServiceAccount, days: number) => run(async () => setSecret({ account: a.name, value: (await api.addServiceAccountKey(a.id, days)).secret }));

  return (
    <Stack gap="lg">
      {!data.available && <Alert color="yellow">This console has nowhere to keep service accounts.</Alert>}
      {error && <Alert color="red">{error}</Alert>}

      <Paper withBorder p="lg">
        <Group justify="space-between" align="flex-start" gap="sm" mb="md" wrap="wrap">
          <Title order={2} fz={16}>Service accounts</Title>
          {data.accounts.length > 0 && <Button leftSection={<IconPlus size={16} />} disabled={!data.available} onClick={() => setCreating(true)}>New service account</Button>}
        </Group>
        {data.accounts.length === 0 ? (
          <EmptyState icon={IconRobot} title="No service accounts"
            description="One for each pipeline or server that uses this project."
            action={<Button leftSection={<IconPlus size={16} />} disabled={!data.available} onClick={() => setCreating(true)}>New service account</Button>} />
        ) : (
          <Stack gap="md">
            {data.accounts.map((a) => (
              <AccountCard key={a.id} account={a} keysAllowed={data.keysAllowed} maxKeys={data.maxKeys} maxKeyDays={data.maxKeyDays}
                onAddKey={(days) => addKey(a, days)}
                onRevokeKey={(k) => run(() => api.revokeServiceAccountKey(a.id, k), `Revoke this key of ${a.name}? Anything still using it stops working once its access token runs out.`)}
                onTrust={() => setTrusting(a)}
                onUntrust={(i) => run(() => api.removeIdentity(a.id, i), `Stop trusting this identity for ${a.name}?`)}
                onToggle={() => run(() => api.updateServiceAccount(a.id, a.role, a.scopes, !a.disabled),
                  a.disabled ? undefined : `Turn off ${a.name}? Nothing can sign in as it until it's turned on again.`)}
                onDelete={() => run(() => api.deleteServiceAccount(a.id), `Delete ${a.name}, its keys and trusted identities? This can't be undone.`)} />
            ))}
          </Stack>
        )}
      </Paper>

      <CreateDialog opened={creating} roles={data.roles} scopes={data.scopes} onClose={() => setCreating(false)} onCreated={refresh} />
      <TrustDialog account={trusting} onClose={() => setTrusting(null)} onTrusted={refresh} />
      <Modal opened={!!secret} onClose={() => setSecret(null)} radius="lg" size="md" title={<Text fw={700} fz={18}>Copy the key</Text>}>
        {secret && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">The key of {secret.account}, shown once.</Text>
            <Group gap={4} wrap="nowrap" style={{ background: "var(--w-subtle)", borderRadius: 8, padding: "8px 8px 8px 12px" }}>
              <Text size="sm" ff="monospace" data-testid="service-account-secret" style={{ flex: 1, wordBreak: "break-all" }}>{secret.value}</Text>
              <CopyButton value={secret.value}>
                {({ copied, copy }) => (
                  <Button size="xs" variant={copied ? "light" : "filled"} color={copied ? "teal" : undefined}
                    leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
                )}
              </CopyButton>
            </Group>
            <Group justify="flex-end"><Button onClick={() => setSecret(null)}>Done</Button></Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function AccountCard({ account: a, keysAllowed, maxKeys, maxKeyDays, onAddKey, onRevokeKey, onTrust, onUntrust, onToggle, onDelete }: {
  account: ServiceAccount; keysAllowed: boolean; maxKeys: number; maxKeyDays: number;
  onAddKey: (days: number) => void; onRevokeKey: (id: string) => void; onTrust: () => void; onUntrust: (id: string) => void;
  onToggle: () => void; onDelete: () => void;
}) {
  const [days, setDays] = useState("90");
  return (
    <Paper withBorder p="md" data-testid="service-account" style={{ opacity: a.disabled ? 0.7 : 1 }}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div>
          <Group gap={6}>
            <Text fw={700}>{a.name}</Text>
            {a.role ? <Badge variant="light" tt="none">{ROLE_LABEL[a.role] ?? a.role}</Badge>
              : a.scopes.map((s) => <Badge key={s} variant="light" tt="none">{SCOPE_LABEL[s] ?? s}</Badge>)}
            {a.disabled && <Badge color="gray" tt="none">Turned off</Badge>}
          </Group>
          <Text size="xs" c="dimmed" mt={2}>Made by {a.createdBy}, {when(a.createdAt)} · last used {when(a.lastUsedAt)}</Text>
          {!a.makerIsAdmin && (
            <Text size="xs" c="orange" mt={2} data-testid="maker-gone">
              {a.createdBy} is no longer an admin here: check it's still needed, and replace its key if they had it.
            </Text>
          )}
        </div>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={onToggle}>{a.disabled ? "Turn on" : "Turn off"}</Button>
          <Button size="xs" variant="subtle" color="red" onClick={onDelete}>Delete</Button>
        </Group>
      </Group>

      <Text size="sm" fw={600} mt="md" mb={4}>Keys</Text>
      {a.keys.length === 0 ? <Text size="xs" c="dimmed">None.</Text> : (
        <div style={{ overflowX: "auto" }}>
          <Table fz="xs" verticalSpacing={4} miw={640}>
            <Table.Thead><Table.Tr><Table.Th>Key</Table.Th><Table.Th>Made</Table.Th><Table.Th>Last used</Table.Th><Table.Th>Expires</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {a.keys.map((k) => (
                <Table.Tr key={k.id}>
                  <Table.Td><Code>{k.id.slice(0, 8)}…</Code>{k.unused && <Badge ml={6} size="xs" color="orange" tt="none">unused 90 days</Badge>}</Table.Td>
                  <Table.Td>{when(k.createdAt)} by {k.createdBy}</Table.Td>
                  <Table.Td>{when(k.lastUsedAt)}{k.lastUsedFrom ? ` from ${k.lastUsedFrom}` : ""}</Table.Td>
                  <Table.Td>{when(k.expiresAt)}</Table.Td>
                  <Table.Td ta="right"><Button size="xs" variant="subtle" color="red" onClick={() => onRevokeKey(k.id)}>Revoke</Button></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}
      {keysAllowed && (
        <Group gap="xs" mt={6}>
          <Select size="xs" w={120} data={DAYS.filter((d) => Number(d.value) <= maxKeyDays)} value={days} onChange={(v) => setDays(v ?? "90")} allowDeselect={false} aria-label="Key expires after" />
          <Button size="xs" variant="light" disabled={a.keys.length >= maxKeys} onClick={() => onAddKey(Number(days))}>Add a key</Button>
          {a.keys.length >= maxKeys && <Text size="xs" c="dimmed">Two at most: revoke the old one once nothing uses it.</Text>}
        </Group>
      )}

      <Text size="sm" fw={600} mt="md" mb={4}>Trusted identities</Text>
      {a.identities.length === 0 ? <Text size="xs" c="dimmed">None.</Text> : (
        <Stack gap={4}>
          {a.identities.map((i) => (
            <Group key={i.id} justify="space-between" wrap="nowrap" gap="xs">
              <Text size="xs" style={{ wordBreak: "break-all" }}>
                <Code>{i.issuer}</Code>, subject <Code>{i.subject}</Code>, audience <Code>{i.audience}</Code> · last used {when(i.lastUsedAt)}
              </Text>
              <Button size="xs" variant="subtle" color="red" onClick={() => onUntrust(i.id)}>Remove</Button>
            </Group>
          ))}
        </Stack>
      )}
      <Button size="xs" variant="light" mt={6} onClick={onTrust}>Trust an identity</Button>
    </Paper>
  );
}

function CreateDialog({ opened, roles, scopes: allScopes, onClose, onCreated }: {
  opened: boolean; roles: string[]; scopes: string[]; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"role" | "deploy">("deploy");
  const [role, setRole] = useState("Member");
  const [scopes, setScopes] = useState<string[]>(["functions", "rules"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setName(""); setKind("deploy"); setRole("Member"); setScopes(["functions", "rules"]); setError(null); onClose(); };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createServiceAccount(name.trim(), kind === "role" ? role : null, kind === "deploy" ? scopes : []);
      onCreated();
      close();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" size="md" title={<Text fw={700} fz={18}>New service account</Text>}>
      <Stack gap="md">
        <TextInput label="Name" placeholder="gitlab-deploy" data-autofocus
          value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <SegmentedControl value={kind} onChange={(v) => setKind(v as "role" | "deploy")}
          data={[{ value: "deploy", label: "Deploys (CI)" }, { value: "role", label: "Uses the data (a server)" }]} />
        {kind === "deploy" ? (
          <Checkbox.Group label="It may" value={scopes} onChange={setScopes}>
            <Stack gap={8} mt={8}>{allScopes.map((s) => <Checkbox key={s} value={s} label={SCOPE_LABEL[s] ?? s} />)}</Stack>
          </Checkbox.Group>
        ) : (
          <Select label="Role" data={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))} value={role} onChange={(v) => setRole(v ?? "Member")} allowDeselect={false} />
        )}
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button loading={busy} disabled={!name.trim() || (kind === "deploy" && scopes.length === 0)} onClick={create}>Create</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TrustDialog({ account, onClose, onTrusted }: { account: ServiceAccount | null; onClose: () => void; onTrusted: () => void }) {
  const [issuer, setIssuer] = useState("");
  const [subject, setSubject] = useState("");
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setIssuer(""); setSubject(""); setAudience(""); setError(null); onClose(); };
  const trust = async () => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try { await api.trustIdentity(account.id, issuer.trim(), subject.trim(), audience.trim()); onTrusted(); close(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={!!account} onClose={close} radius="lg" size="lg" title={<Text fw={700} fz={18}>Trust an identity for {account?.name}</Text>}>
      <Stack gap="md">
        <TextInput label="Issuer" placeholder="https://gitlab.example.com" value={issuer} onChange={(e) => setIssuer(e.currentTarget.value)} />
        <TextInput label="Subject" description="* matches any run of characters" placeholder="project_path:team/app:ref_type:branch:ref:main"
          value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
        <TextInput label="Audience" placeholder="https://winche.example.com/projects/app"
          value={audience} onChange={(e) => setAudience(e.currentTarget.value)} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button loading={busy} disabled={!issuer.trim() || !subject.trim() || !audience.trim()} onClick={trust}>Trust it</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
