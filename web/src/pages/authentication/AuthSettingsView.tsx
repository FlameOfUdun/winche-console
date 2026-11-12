import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { when } from "./UsersView";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" style={{ borderTop: "1px solid var(--mantine-color-gray-2)", paddingTop: 6 }}>
      <Text size="sm">{k}</Text>
      <Text size="sm" fw={500} ta="right" style={{ wordBreak: "break-all" }}>{v}</Text>
    </Group>
  );
}

/** Tokens, signing keys, protection and hooks. */
export function AuthSettingsView() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (config.isLoading) return <Loader size="sm" />;
  if (config.isError || !config.data) return <Alert color="red">Couldn't load the settings: {errorMessage(config.error)}</Alert>;
  const c = config.data;
  if (!c.tokens || !c.protection || !c.hooks) return null;
  const tokens = c.tokens, protection = c.protection, hooks = c.hooks;

  const rotate = async () => {
    if (!window.confirm("Make a new signing key now? The current one keeps checking the tokens it signed until they expire.")) return;
    setRotating(true);
    setError(null);
    try {
      await api.rotateAppAuthKeys();
      await qc.invalidateQueries({ queryKey: ["app-auth-config"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRotating(false);
    }
  };

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Paper withBorder p="md">
        <Stack gap={8}>
          <Title order={5}>Tokens</Title>
          <Row k="Access token lifetime" v={`${tokens.accessTokenMinutes} minutes`} />
          <Row k="Session lifetime" v={`${tokens.refreshTokenDays} days from last use`} />
          <Row k="Issuer" v={tokens.issuer} />
          <Row k="Audience" v={tokens.audience} />
          <Row k="Public keys" v="/.well-known/jwks.json" />
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack gap={8}>
          <Group justify="space-between">
            <Title order={5}>Signing keys</Title>
            <Button size="xs" variant="default" loading={rotating} onClick={rotate}>Rotate now</Button>
          </Group>
          {c.keys.map((k) => (
            <Group key={k.kid} justify="space-between" wrap="nowrap" data-testid="signing-key" style={{ borderTop: "1px solid var(--mantine-color-gray-2)", paddingTop: 6 }}>
              <div>
                <Text size="xs" ff="monospace">{k.kid}</Text>
                <Text size="xs" c="dimmed">ES256 · made {when(k.createdAt)}{k.retiredAt ? ` · retired ${when(k.retiredAt)}` : ""}</Text>
              </div>
              <Badge color={k.retiredAt ? "yellow" : "teal"} variant="light" tt="none">{k.retiredAt ? "Retiring" : "Active"}</Badge>
            </Group>
          ))}
          {error && <Alert color="red">{error}</Alert>}
          <Text size="xs" c="dimmed">
            A new key every {tokens.keyRotationDays} days; a retiring key still checks the tokens it signed.
            {tokens.keysEncrypted ? " Stored encrypted." : " Stored unencrypted: set KeyEncryptionSecret to encrypt them."}
          </Text>
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack gap={8}>
          <Title order={5}>Protection</Title>
          <Row k="Lockout" v={`${protection.maxFailedSignIns} failures in a row → ${protection.lockoutMinutes} minutes`} />
          <Row k="Sign-in attempts" v="20 a minute per address" />
          <Row k="New users" v="10 a minute per address" />
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack gap={8}>
          <Title order={5}>Hooks in your code</Title>
          <Row k="BeforeCreate" v={hooks.beforeCreate ? "Set" : "None"} />
          <Row k="AfterCreate" v={hooks.afterCreate ? "Set" : "None"} />
          <Row k="BeforeSignIn" v={hooks.beforeSignIn ? "Set" : "None"} />
        </Stack>
      </Paper>
    </SimpleGrid>
  );
}
