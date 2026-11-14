import { useState } from "react";
import { Alert, Badge, Button, Code, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, syncHealth, type KeycloakSync } from "../../api/appAuth";
import { when } from "./UsersView";

const HEALTH_COLOR = { Running: "teal", Behind: "yellow", Failing: "red", "Not run yet": "gray" } as const;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" style={{ borderTop: "1px solid var(--mantine-color-gray-2)", paddingTop: 6 }}>
      <Text size="sm">{k}</Text>
      <Text size="sm" fw={500} ta="right" style={{ wordBreak: "break-all" }}>{v}</Text>
    </Group>
  );
}

const every = (seconds: number) =>
  seconds < 60 ? `${seconds} seconds` : seconds < 3600 ? `${Math.round(seconds / 60)} minutes` : `${Math.round(seconds / 3600)} hours`;

function SyncCard({ s }: { s: KeycloakSync }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = syncHealth(s);
  const attributes = Object.entries(s.attributes).map(([a, c]) => (a === c ? a : `${a} → ${c}`));

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.syncKeycloakNow(s.provider);
      // The sync runs on whichever server holds it; give it a moment, then look again.
      await new Promise((r) => setTimeout(r, 1500));
      await qc.invalidateQueries({ queryKey: ["keycloak-syncs"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p="md" data-testid="keycloak-sync">
      <Stack gap={8}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Title order={5}>{s.displayName}</Title>
            <Badge color={HEALTH_COLOR[health]} variant="light" tt="none">{health}</Badge>
          </Group>
          <Button size="xs" variant="default" loading={busy} onClick={syncNow}>Sync now</Button>
        </Group>
        {s.lastError && <Alert color="red" p="xs"><Text size="sm">{s.lastError}</Text></Alert>}
        {error && <Alert color="red" p="xs"><Text size="sm">{error}</Text></Alert>}
        <Row k="Last run" v={s.lastRunAt ? when(s.lastRunAt) : "not yet"} />
        <Row k="Keycloak events read up to" v={s.eventsAfter ? when(s.eventsAfter) : "—"} />
        <Row k="Last change applied" v={s.lastChangeAt ? when(s.lastChangeAt) : "none yet"} />
        <Row k="Last full comparison" v={s.reconciledAt ? when(s.reconciledAt) : "not yet"} />
        <Row k="Reads events every" v={every(s.pollSeconds)} />
        <Row k="Compares every user every" v={every(s.reconcileHours * 3600)} />
        <Row k="Keycloak" v={s.server} />
        <Row k="Client" v={s.clientId} />
        <Row k="Claims kept in step" v={s.claims.length ? s.claims.join(", ") : "none"} />
        {attributes.length > 0 && <Row k="Attributes" v={attributes.join(", ")} />}
        <Row k="Webhook" v={s.webhookUrl ?? "off (polling only)"} />
      </Stack>
    </Paper>
  );
}

/**
 * The Keycloak syncs (SyncFromKeycloak): users linked to a Keycloak provider follow it one way, Keycloak → Winche.
 * Shown only when a provider is synced.
 */
export function KeycloakSyncView() {
  const syncs = useQuery({ queryKey: ["keycloak-syncs"], queryFn: api.keycloakSyncs, refetchInterval: 10_000 });
  if (syncs.isError) return <Alert color="red">Couldn't load the Keycloak sync: {errorMessage(syncs.error)}</Alert>;
  const list = syncs.data?.syncs ?? [];
  if (list.length === 0) return null;
  return (
    <Stack gap="sm" mt="md">
      <Title order={4}>Keycloak sync</Title>
      <Text size="sm" c="dimmed">
        Users who sign in with these providers follow Keycloak, one way: changes there (profile, roles, claims, disabled,
        deleted) reach Winche; nothing is written to Keycloak. Set in code with <Code>SyncFromKeycloak</Code>.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }}>{list.map((s) => <SyncCard key={s.provider} s={s} />)}</SimpleGrid>
    </Stack>
  );
}
