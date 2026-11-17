import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Code, Group, Loader, Modal, Paper, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { secretTyped } from "../../api/secrets";
import { when } from "../authentication/UsersView";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { EmptyState } from "../../components/EmptyState";
import { SecretInput, sourceTitle, useSecretSources } from "../../components/SecretInput";
import { SecretSources } from "./SecretSources";

/**
 * Secrets: the project's API keys and passwords in one place. Its own (the ones functions read), those the products keep
 * (the SMTP password, a sync's client secret, a bucket's key: changed where they're used), and where secrets can be read
 * from besides being kept here (AWS, with the project's own key).
 */
export function SecretsPage() {
  const { state } = useSession();
  return (
    <>
      <PageBand title="Secrets" description="API keys and passwords: kept here encrypted and never shown again, or read from AWS by reference." />
      <Stack gap="xl" pb={28}>
        {state?.capabilities?.functions && <FunctionSecrets />}
        <ProductSecrets />
        <SecretSources />
      </Stack>
    </>
  );
}

const STATUS = (s: { reference?: string | null }, sources: { name: string; title: string }[] | undefined) =>
  s.reference
    ? <Tooltip label={s.reference}><Badge color="blue" variant="light" tt="none">From {sourceTitle(s.reference, sources)}</Badge></Tooltip>
    : <Badge color="teal" variant="light" tt="none">Set</Badge>;

/** The secrets the products keep, each changed where it's used (they need the rest of their settings). */
function ProductSecrets() {
  const list = useQuery({ queryKey: ["kept-secrets"], queryFn: api.keptSecrets });
  const sources = useSecretSources();
  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>Kept by the products</Title>
        <Text size="sm" c="dimmed">The SMTP password, a sign-in provider's sync secret, a bucket's key: each is changed where it's used.</Text>
      </div>
      {list.isLoading ? <Loader size="sm" /> : list.isError || !list.data ? <Alert color="red">Couldn't load them: {errorMessage(list.error)}</Alert>
        : list.data.secrets.length === 0 ? <Text size="sm" c="dimmed">None set.</Text> : (
        <Paper withBorder style={{ overflowX: "auto" }}>
          <Table fz="sm" verticalSpacing={8} miw={640}>
            <Table.Tbody>
              {list.data.secrets.map((s) => (
                <Table.Tr key={s.name} data-testid="kept-secret">
                  <Table.Td w={130}><Text size="sm" c="dimmed">{s.product}</Text></Table.Td>
                  <Table.Td><Text size="sm">{s.title}</Text></Table.Td>
                  <Table.Td>{STATUS(s, sources.data?.sources)}</Table.Td>
                  <Table.Td><Text size="xs">{when(s.setAt)}{s.setBy ? ` by ${s.setBy}` : ""}</Text></Table.Td>
                  <Table.Td ta="right">{s.link && <Button size="xs" variant="default" component={Link} to={s.link}>Open</Button>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Secrets functions read with ctx.secrets.get: added, set or replaced in a dialog (or with `winche functions secrets:set`),
 * never shown again. Lists the saved ones and those the live code declares but nobody has set.
 */
function FunctionSecrets() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["function-secrets"], queryFn: api.functionSecrets });
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = useSecretSources();
  const [testing, setTesting] = useState<string | null>(null);
  const [tested, setTested] = useState<{ name: string; ok: boolean; problem: string | null } | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  if (list.isError || !list.data) return <Alert color="red">Couldn't load the secrets: {errorMessage(list.error)}</Alert>;
  const test = async (name: string) => {
    setTesting(name); setTested(null);
    try { setTested({ name, ...(await api.testFunctionSecret(name)) }); }
    catch (e) { setTested({ name, ok: false, problem: errorMessage(e) }); }
    finally { setTesting(null); }
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["function-secrets"] });
  const remove = async (name: string) => {
    if (!window.confirm(`Remove the secret ${name}? Functions that read it fail until it's set again.`)) return;
    setError(null);
    try { await api.removeFunctionSecret(name); await refresh(); } catch (e) { setError(errorMessage(e)); }
  };
  const secrets = list.data.secrets;
  return (
    <Stack gap="sm">
      {!list.data.available && <Alert color="yellow">Secrets need the server's master key.</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Title order={4}>Your secrets</Title>
          <Text size="sm" c="dimmed">API keys and passwords your functions read with <Code>ctx.secrets.get("NAME")</Code>. A function declares the ones it uses: <Code>{'{ secrets: ["NAME"] }'}</Code>.</Text>
        </div>
        <Button size="xs" onClick={() => setAdding(true)} disabled={!list.data.available} style={{ flexShrink: 0 }}>Add a secret</Button>
      </Group>
      <SecretDialog opened={adding || editing !== null} name={editing ?? undefined}
        savedReference={secrets.find((s) => s.name === editing)?.reference} isSet={!!secrets.find((s) => s.name === editing)?.isSet}
        onDone={async (saved) => { setAdding(false); setEditing(null); if (saved) await refresh(); }} />
      {secrets.length === 0 ? (
        <EmptyState icon={IconKey} title="No secrets yet"
          description="Add one here or with `winche functions secrets set NAME`. Values are kept encrypted and never shown again; or read from AWS Secrets Manager or Parameter Store by reference." />
      ) : secrets.length > 0 && (
        <Paper withBorder style={{ overflowX: "auto" }}>
          <Table fz="sm" verticalSpacing={6} miw={640}>
            <Table.Tbody>
              {secrets.map((s) => (
                <Table.Tr key={s.name} data-testid="function-secret">
                  <Table.Td><Text ff="monospace" fw={600}>{s.name}</Text></Table.Td>
                  <Table.Td>
                    {!s.isSet ? <Badge color="red" variant="light" tt="none">Not set</Badge> : STATUS(s, sources.data?.sources)}
                  </Table.Td>
                  <Table.Td><Text size="xs">{s.isSet ? `${when(s.setAt!)}${s.setBy ? ` by ${s.setBy}` : ""}` : "—"}</Text></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{s.usedBy.length ? `used by ${s.usedBy.join(", ")}` : "no function declares it"}</Text></Table.Td>
                  <Table.Td ta="right">
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      {s.reference && <Button size="xs" variant="subtle" loading={testing === s.name} onClick={() => test(s.name)}>Test</Button>}
                      <Button size="xs" variant="default" onClick={() => setEditing(s.name)}>{s.isSet ? "Replace" : "Set"}</Button>
                      {s.isSet && <Button size="xs" variant="subtle" color="red" onClick={() => remove(s.name)}>Remove</Button>}
                    </Group>
                    {tested?.name === s.name && <Text size="xs" ta="left" c={tested.ok ? "teal" : "red"} mt={4}>{tested.ok ? "Read just now: it works." : tested.problem}</Text>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

/** Adding a secret (its name and value), or setting or replacing one (its value): a value, or where it's read from. */
function SecretDialog({ opened, name: fixed, isSet, savedReference, onDone }: {
  opened: boolean; name?: string; isSet: boolean; savedReference?: string | null; onDone: (saved: boolean) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = fixed ?? name;
  const badName = !fixed && name !== "" && !SECRET_NAME.test(name);
  const finish = async (saved: boolean) => { setName(""); setValue(""); setError(null); await onDone(saved); };
  const save = async () => {
    setError(null);
    setBusy(true);
    try { await api.setFunctionSecret(target, value); await finish(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={() => finish(false)} radius="lg" size="lg"
      title={<Text fw={700} fz={18}>{!fixed ? "Add a secret" : isSet ? `Replace ${fixed}` : `Set ${fixed}`}</Text>}>
      <Stack gap="md" data-testid="secret-dialog">
        {!fixed && (
          <TextInput label="Name" placeholder="MAIL_API_KEY" ff="monospace" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value.toUpperCase())}
            description={<>Functions read it with <Code>ctx.secrets.get("{name || "NAME"}")</Code>.</>}
            error={badName ? "Capitals, digits and underscores, starting with a letter" : undefined} />
        )}
        <SecretInput label={fixed ? `New value of ${fixed}` : "Value"} value={value} onChange={setValue} autoComplete="off" savedReference={savedReference}
          description="Kept encrypted and never shown again." />
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => finish(false)}>Cancel</Button>
          <Button loading={busy} disabled={!target || badName || !secretTyped(value)} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

