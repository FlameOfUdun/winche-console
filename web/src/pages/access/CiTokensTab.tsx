import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Code, CopyButton, Group, Loader, Modal, Paper, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconCheck, IconCopy, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { ConsoleToken } from "../../api/tokens";
import { when } from "../authentication/UsersView";

const SCOPE_LABEL: Record<string, string> = { functions: "Deploy functions", rules: "Deploy rules" };
const DAYS = [{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "1 year" }, { value: "730", label: "2 years" }];

/**
 * CI tokens (for WINCHE_TOKEN in CI: named, limited to deploying, expiring, revocable) and everyone's CLI sign-ins
 * (winche login), which admins can end.
 */
export function CiTokensTab() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ["console-tokens"], queryFn: api.consoleTokens });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tokens.isLoading) return <Loader size="sm" />;
  if (tokens.isError || !tokens.data) return <Alert color="red">Couldn't load the tokens: {errorMessage(tokens.error)}</Alert>;
  const { available, tokens: list } = tokens.data;
  const ci = list.filter((t) => t.kind === "ci");
  const cli = list.filter((t) => t.kind === "cli");

  const revoke = async (t: ConsoleToken) => {
    const what = t.kind === "ci" ? `the CI token "${t.name}"` : `${t.user}'s CLI sign-in (${t.name})`;
    if (!window.confirm(`Revoke ${what}? Anything using it stops working at once.`)) return;
    setError(null);
    try {
      await api.revokeConsoleToken(t.id);
      await qc.invalidateQueries({ queryKey: ["console-tokens"] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Stack gap="lg" maw={980}>
      {!available && <Alert color="yellow">Tokens need <Code>AddWincheConfig(…)</Code> in the app: that's where they're kept.</Alert>}
      {error && <Alert color="red">{error}</Alert>}

      <Paper withBorder p="lg">
        <Group justify="space-between" align="flex-start" gap="sm" mb="md" wrap="wrap">
          <div style={{ maxWidth: 640 }}>
            <Title order={2} fz={16}>CI tokens</Title>
            <Text size="sm" c="dimmed" mt={2}>
              For deploying from CI: set <Code>WINCHE_TOKEN</Code> to one, then run <Code>winche functions deploy</Code> or{" "}
              <Code>winche rules deploy</Code>. A token can only deploy what it's allowed to, is named in the version history, and
              stops working if its maker is no longer an admin.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} disabled={!available} onClick={() => setCreating(true)}>Create token</Button>
        </Group>
        <TokenTable tokens={ci} onRevoke={revoke} empty="No CI tokens yet." ci />
      </Paper>

      <Paper withBorder p="lg">
        <Title order={2} fz={16}>CLI sign-ins</Title>
        <Text size="sm" c="dimmed" mt={2} mb="md">Made when someone runs <Code>winche login</Code> and allows it in the browser. They last 90 days; <Code>winche logout</Code> ends one too.</Text>
        <TokenTable tokens={cli} onRevoke={revoke} empty="Nobody has signed in with the CLI." />
      </Paper>

      <CreateTokenDialog opened={creating} scopes={tokens.data.scopes} onClose={() => setCreating(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ["console-tokens"] })} />
    </Stack>
  );
}

/** Name, scopes and expiry; then the token, shown once, to copy. */
function CreateTokenDialog({ opened, scopes: allScopes, onClose, onCreated }: {
  opened: boolean; scopes: string[]; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["functions", "rules"]);
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => { setName(""); setScopes(["functions", "rules"]); setDays("90"); setSecret(null); setError(null); onClose(); };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.createCiToken(name.trim(), scopes, Number(days));
      setSecret(made.secret);
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} radius="lg" size="md"
      title={<Text fw={700} fz={18}>{secret ? "Copy your token" : "Create a CI token"}</Text>}>
      {secret ? (
        <Stack gap="md">
          <Text size="sm" c="dimmed">Copy it now and put it in your CI's secrets as <Code>WINCHE_TOKEN</Code>. It won't be shown again.</Text>
          <Group gap={4} wrap="nowrap" style={{ background: "#F2F4F7", borderRadius: 8, padding: "8px 8px 8px 12px" }}>
            <Text size="sm" ff="monospace" data-testid="ci-token-secret" style={{ flex: 1, wordBreak: "break-all" }}>{secret}</Text>
            <CopyButton value={secret}>
              {({ copied, copy }) => (
                <Button size="xs" variant={copied ? "light" : "filled"} color={copied ? "teal" : undefined}
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
              )}
            </CopyButton>
          </Group>
          <Group justify="flex-end"><Button onClick={close}>Done</Button></Group>
        </Stack>
      ) : (
        <Stack gap="md">
          <TextInput label="Name" description="Where it's used, e.g. gitlab-main" placeholder="gitlab-main" data-autofocus
            value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Checkbox.Group label="It may" value={scopes} onChange={setScopes}>
            <Stack gap={8} mt={8}>{allScopes.map((s) => <Checkbox key={s} value={s} label={SCOPE_LABEL[s] ?? s} />)}</Stack>
          </Checkbox.Group>
          <Select label="Expires after" data={DAYS} value={days} onChange={(v) => setDays(v ?? "90")} allowDeselect={false} />
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button loading={busy} disabled={!name.trim() || scopes.length === 0} onClick={create}>Create token</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function TokenTable({ tokens, onRevoke, empty, ci }: { tokens: ConsoleToken[]; onRevoke: (t: ConsoleToken) => void; empty: string; ci?: boolean }) {
  if (tokens.length === 0) return <Text size="sm" c="dimmed">{empty}</Text>;
  return (
    <Paper withBorder style={{ overflowX: "auto" }}>
      <Table fz="sm" verticalSpacing={6} miw={720}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{ci ? "Name" : "Who"}</Table.Th>
            <Table.Th>{ci ? "May" : "Where"}</Table.Th>
            <Table.Th>{ci ? "Made by" : "Signed in"}</Table.Th>
            <Table.Th>Last used</Table.Th>
            <Table.Th>Expires</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tokens.map((t) => (
            <Table.Tr key={t.id} data-testid={ci ? "ci-token" : "cli-token"}>
              <Table.Td><Text fw={600} size="sm">{ci ? t.name : t.user}</Text></Table.Td>
              <Table.Td>{ci
                ? <Group gap={4}>{t.scopes.map((s) => <Badge key={s} variant="light" tt="none">{s}</Badge>)}</Group>
                : <Text size="xs">{t.name}</Text>}</Table.Td>
              <Table.Td><Text size="xs">{ci ? `${t.user}, ${when(t.createdAt)}` : when(t.createdAt)}</Text></Table.Td>
              <Table.Td><Text size="xs">{when(t.lastUsedAt)}</Text></Table.Td>
              <Table.Td><Text size="xs">{when(t.expiresAt)}</Text></Table.Td>
              <Table.Td ta="right"><Button size="xs" variant="subtle" color="red" onClick={() => onRevoke(t)}>Revoke</Button></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
