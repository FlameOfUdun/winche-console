import { useState } from "react";
import { Alert, Badge, Button, Code, Group, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { SourceKey } from "../../api/secrets";
import { when } from "../authentication/UsersView";
import { EmptyState } from "../../components/EmptyState";
import { useSecretSources } from "../../components/SecretInput";

/**
 * Settings → Secrets: where the project's secrets can be read from besides being kept here (AWS Secrets Manager,
 * Parameter Store), and the project's own key for those places. Any secret field (function secrets, the SMTP password,
 * a sync's client secret) can then be a reference such as aws-ssm:/app/key.
 */
export function SecretSourcesTab() {
  const sources = useSecretSources();
  if (sources.isLoading) return <Loader size="sm" />;
  if (sources.isError || !sources.data) return <Alert color="red">Couldn't load where secrets come from: {errorMessage(sources.error)}</Alert>;
  const { available, appCredentials, sources: list, keys } = sources.data;
  return (
    <Stack gap="md">
      <div>
        <Title order={4}>Secrets</Title>
        <Text size="sm" c="dimmed">
          Every secret (function secrets, the SMTP password, a sync's client secret) is either a value kept here, encrypted, or a
          reference to where it's really kept, read when it's needed and kept for a few minutes so rotations are picked up.
        </Text>
      </div>
      {!available && <Alert color="yellow">Secrets need the server's master key.</Alert>}
      {list.length === 0 ? (
        <EmptyState icon={IconKey} title="Only values here"
          description="This server reads secrets from no other place: every secret is a value kept here, encrypted." />
      ) : (
        <>
          <Paper withBorder p="md">
            <Stack gap={6}>
              <Text fw={600} size="sm">References</Text>
              {list.map((s) => (
                <Text key={s.name} size="sm"><Code>{s.name}:</Code> {s.title}: {s.hint}</Text>
              ))}
              <Text size="xs" c="dimmed">Add <Code>#field</Code> to take one field of a JSON secret, e.g. <Code>aws-sm:app/ses#secretAccessKey</Code>.</Text>
            </Stack>
          </Paper>
          {keys.map((k) => <KeyCard key={k.name} k={k} appCredentials={appCredentials} />)}
        </>
      )}
    </Stack>
  );
}

function KeyCard({ k, appCredentials }: { k: SourceKey; appCredentials: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["secret-sources"] });
  const save = async () => {
    setBusy(true); setError(null);
    try { await api.setSourceKey(k.name, values); setEditing(false); setValues({}); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove the project's ${k.title}? References read with it stop working${appCredentials ? "" : " until it's set again"}.`)) return;
    setError(null);
    try { await api.removeSourceKey(k.name); await refresh(); } catch (e) { setError(errorMessage(e)); }
  };
  const missing = k.fields.some((f) => f.required && !values[f.name]?.trim());
  return (
    <Paper withBorder p="md" data-testid="source-key">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Group gap="xs">
              <Text fw={600} size="sm">The project's {k.title}</Text>
              {k.isSet ? <Badge color="teal" variant="light" tt="none">Set</Badge> : <Badge color="gray" variant="light" tt="none">Not set</Badge>}
            </Group>
            <Text size="xs" c="dimmed">
              Used for {k.sources.join(" and ")} references. {k.isSet
                ? `Set ${when(k.setAt!)}${k.setBy ? ` by ${k.setBy}` : ""}; never shown again.`
                : appCredentials
                  ? "Without it, references are read with the server's own credentials (its role)."
                  : "Without it, only a server admin can set references (they'd be read with the server's own credentials)."}
            </Text>
          </div>
          {!editing && (
            <Group gap={6} wrap="nowrap">
              <Button size="xs" variant="default" onClick={() => setEditing(true)}>{k.isSet ? "Replace" : "Set"}</Button>
              {k.isSet && <Button size="xs" variant="subtle" color="red" onClick={remove}>Remove</Button>}
            </Group>
          )}
        </Group>
        {editing && (
          <Stack gap="xs">
            {k.fields.map((f) => {
              const props = {
                label: f.title, description: f.hint ?? undefined, required: f.required, value: values[f.name] ?? "", autoComplete: "off",
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [f.name]: e.currentTarget.value }),
              };
              return f.secret ? <PasswordInput key={f.name} {...props} /> : <TextInput key={f.name} {...props} ff="monospace" />;
            })}
            <Group gap="xs">
              <Button loading={busy} disabled={missing} onClick={save}>Save</Button>
              <Button variant="default" onClick={() => { setEditing(false); setValues({}); setError(null); }}>Cancel</Button>
            </Group>
          </Stack>
        )}
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
