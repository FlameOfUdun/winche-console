import { useState } from "react";
import { Alert, Badge, Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { SourceKey } from "../../api/secrets";
import { when } from "../authentication/UsersView";

/**
 * The project's own key for a place secrets are read from (its AWS access key): whether it's set, and setting,
 * replacing or removing it. Never shown again once saved.
 */
export function SourceKeyDialog({ k, appCredentials, opened, onClose }: { k: SourceKey; appCredentials: boolean; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setValues({}); setError(null); onClose(); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["secret-sources"] });
  const save = async () => {
    setBusy(true); setError(null);
    try { await api.setSourceKey(k.name, values); await refresh(); close(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove the project's ${k.title}? References read with it stop working${appCredentials ? "" : " until it's set again"}.`)) return;
    setError(null);
    try { await api.removeSourceKey(k.name); await refresh(); close(); } catch (e) { setError(errorMessage(e)); }
  };
  const missing = k.fields.some((f) => f.required && !values[f.name]?.trim());
  return (
    <Modal opened={opened} onClose={close} radius="lg" size="lg"
      title={<Group gap={8}><Text fw={700} fz={18}>The project's {k.title}</Text>
        {k.isSet ? <Badge color="teal" variant="light" tt="none">Set</Badge> : <Badge color="gray" variant="light" tt="none">Not set</Badge>}</Group>}>
      <Stack gap="md" data-testid="source-key">
        <Text size="sm" c="dimmed">
          {k.isSet
            ? `Set ${when(k.setAt!)}${k.setBy ? ` by ${k.setBy}` : ""}.`
            : appCredentials ? "Not set: the server's own credentials are used." : "Not set: only a server admin can set references."}
        </Text>
        {k.fields.map((f) => {
          const props = {
            label: f.title, description: f.hint ?? undefined, required: f.required, value: values[f.name] ?? "", autoComplete: "off",
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [f.name]: e.currentTarget.value }),
          };
          return f.secret ? <PasswordInput key={f.name} {...props} /> : <TextInput key={f.name} {...props} ff="monospace" />;
        })}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="space-between">
          {k.isSet ? <Button variant="subtle" color="red" onClick={remove}>Remove</Button> : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button loading={busy} disabled={missing} onClick={save}>Save</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
