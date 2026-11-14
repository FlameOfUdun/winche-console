import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Code, Group, Loader, Paper, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
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
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["functions", "rules"]);
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (tokens.isLoading) return <Loader size="sm" />;
  if (tokens.isError || !tokens.data) return <Alert color="red">Couldn't load the tokens: {errorMessage(tokens.error)}</Alert>;
  const { available, tokens: list } = tokens.data;
  const ci = list.filter((t) => t.kind === "ci");
  const cli = list.filter((t) => t.kind === "cli");

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.createCiToken(name.trim(), scopes, Number(days));
      setSecret(made.secret);
      setName("");
      await qc.invalidateQueries({ queryKey: ["console-tokens"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
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
    <Stack gap="md" maw={980}>
      {!available && <Alert color="yellow">Tokens need <Code>AddWincheConfig(…)</Code> in the app: that's where they're kept.</Alert>}
      {error && <Alert color="red">{error}</Alert>}

      <Stack gap="xs">
        <Title order={5}>CI tokens</Title>
        <Text size="sm" c="dimmed">
          For deploying from CI: set <Code>WINCHE_TOKEN</Code> to one, then run <Code>winche functions deploy</Code> or{" "}
          <Code>winche rules deploy</Code>. A token can only deploy what it's allowed to, is named in the version history, and
          stops working if you're no longer an admin.
        </Text>
        <Paper withBorder p="sm">
          <Group align="flex-end" wrap="wrap">
            <TextInput label="Name" placeholder="gitlab-main" w={220} value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Checkbox.Group label="May" value={scopes} onChange={setScopes}>
              <Group gap="md" mt={8}>{tokens.data.scopes.map((s) => <Checkbox key={s} value={s} label={SCOPE_LABEL[s] ?? s} />)}</Group>
            </Checkbox.Group>
            <Select label="Expires after" w={140} data={DAYS} value={days} onChange={(v) => setDays(v ?? "90")} allowDeselect={false} />
            <Button loading={busy} disabled={!available || !name.trim() || scopes.length === 0} onClick={create}>Make token</Button>
          </Group>
        </Paper>
        {secret && (
          <Alert color="teal" title="Copy it now: it won't be shown again" withCloseButton onClose={() => setSecret(null)}>
            <Code data-testid="ci-token-secret" style={{ wordBreak: "break-all" }}>{secret}</Code>
          </Alert>
        )}
        <TokenTable tokens={ci} onRevoke={revoke} empty="No CI tokens yet." ci />
      </Stack>

      <Stack gap="xs">
        <Title order={5}>CLI sign-ins</Title>
        <Text size="sm" c="dimmed">Made when someone runs <Code>winche login</Code> and allows it in the browser. They last 90 days; <Code>winche logout</Code> ends one too.</Text>
        <TokenTable tokens={cli} onRevoke={revoke} empty="Nobody has signed in with the CLI." />
      </Stack>
    </Stack>
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
