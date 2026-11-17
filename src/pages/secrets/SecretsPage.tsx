import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Code, Group, Loader, Menu, Modal, Paper, Stack, Table, Text, TextInput, Tooltip, ActionIcon } from "@mantine/core";
import { IconDots, IconKey } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { secretTyped, type KeptSecret } from "../../api/secrets";
import type { FunctionSecret } from "../../api/functions";
import { when } from "../authentication/UsersView";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { EmptyState } from "../../components/EmptyState";
import { SecretInput, sourceTitle, useSecretSources } from "../../components/SecretInput";
import { SourceKeyDialog } from "./SecretSources";

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** One row: a function secret (managed here) or one a product keeps (changed where it's used). */
type Row = { kind: "function"; s: FunctionSecret } | { kind: "kept"; s: KeptSecret };

/**
 * Secrets: every API key and password of the project in one table — the ones functions read (added, replaced, tested
 * and removed here) and those the products keep (the SMTP password, a sync's client secret, a bucket's key: changed
 * where they're used). Each is a value kept here, encrypted, or read from AWS by reference, with the project's own key.
 */
export function SecretsPage() {
  const { state } = useSession();
  const qc = useQueryClient();
  const functions = !!state?.capabilities?.functions;
  const fn = useQuery({ queryKey: ["function-secrets"], queryFn: api.functionSecrets, enabled: functions });
  const kept = useQuery({ queryKey: ["kept-secrets"], queryFn: api.keptSecrets });
  const sources = useSecretSources();
  const [editing, setEditing] = useState<FunctionSecret | "new" | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<{ name: string; ok: boolean; problem: string | null } | null>(null);
  const key = sources.data?.keys[0];

  const refresh = () => qc.invalidateQueries({ queryKey: ["function-secrets"] });
  const remove = async (name: string) => {
    if (!window.confirm(`Remove the secret ${name}? Functions that read it fail until it's set again.`)) return;
    setError(null);
    try { await api.removeFunctionSecret(name); await refresh(); } catch (e) { setError(errorMessage(e)); }
  };
  const test = async (name: string) => {
    setTested(null);
    try { setTested({ name, ...(await api.testFunctionSecret(name)) }); }
    catch (e) { setTested({ name, ok: false, problem: errorMessage(e) }); }
  };

  const loading = (functions && fn.isLoading) || kept.isLoading;
  const failed = (functions && fn.isError) || kept.isError;
  const rows: Row[] = [
    ...(fn.data?.secrets ?? []).map((s) => ({ kind: "function" as const, s })),
    ...(kept.data?.secrets ?? []).map((s) => ({ kind: "kept" as const, s })),
  ];
  const available = (functions ? fn.data?.available : kept.data?.available) ?? true;

  return (
    <>
      <PageBand title="Secrets" description="API keys and passwords: kept here encrypted and never shown again, or read from AWS by reference."
        actions={<>
          {key && (
            <Button variant="default" leftSection={<IconKey size={15} />} onClick={() => setKeyOpen(true)} data-testid="aws-key-button"
              rightSection={<Badge size="xs" variant="light" color={key.isSet ? "teal" : "gray"} tt="none">{key.isSet ? "set" : "not set"}</Badge>}>
              {key.title}
            </Button>
          )}
          {functions && <Button onClick={() => setEditing("new")} disabled={!available}>Add a secret</Button>}
        </>} />
      <Stack gap="sm" pb={28}>
        {!available && <Alert color="yellow">Secrets need the server's master key.</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        {loading ? <Loader size="sm" /> : failed ? <Alert color="red">Couldn't load the secrets: {errorMessage(fn.error ?? kept.error)}</Alert>
          : rows.length === 0 ? (
            <EmptyState icon={IconKey} title="No secrets yet"
              description={functions ? "Add the API keys and passwords your functions read with ctx.secrets.get(\"NAME\")." : "The products' passwords and keys appear here once they're set."} />
          ) : (
            <Paper withBorder radius="md" style={{ overflowX: "auto" }}>
              <Table fz="sm" verticalSpacing={10} horizontalSpacing="md" miw={720} highlightOnHover>
                <Table.Thead>
                  <Table.Tr><Table.Th>Secret</Table.Th><Table.Th>Used by</Table.Th><Table.Th>Kept as</Table.Th><Table.Th>Updated</Table.Th><Table.Th w={1} /></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => r.kind === "function" ? (
                    <Table.Tr key={r.s.name} data-testid="function-secret">
                      <Table.Td>
                        <Text ff="monospace" fw={600} size="sm">{r.s.name}</Text>
                        {tested?.name === r.s.name && <Text size="xs" c={tested.ok ? "teal" : "red"}>{tested.ok ? "Read just now: it works." : tested.problem}</Text>}
                      </Table.Td>
                      <Table.Td><Text size="sm" c={r.s.usedBy.length ? undefined : "dimmed"} lineClamp={2}>{r.s.usedBy.length ? r.s.usedBy.join(", ") : "no function declares it"}</Text></Table.Td>
                      <Table.Td><Kept s={r.s} isSet={r.s.isSet} /></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{r.s.isSet ? `${when(r.s.setAt!)}${r.s.setBy ? ` · ${r.s.setBy}` : ""}` : "—"}</Text></Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Button size="xs" variant="default" onClick={() => setEditing(r.s)}>{r.s.isSet ? "Replace" : "Set"}</Button>
                          {r.s.isSet && (
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`More for ${r.s.name}`}><IconDots size={16} /></ActionIcon></Menu.Target>
                              <Menu.Dropdown>
                                {r.s.reference && <Menu.Item onClick={() => test(r.s.name)}>Test</Menu.Item>}
                                <Menu.Item color="red" onClick={() => remove(r.s.name)}>Remove</Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    <Table.Tr key={r.s.name} data-testid="kept-secret">
                      <Table.Td><Text size="sm" fw={500}>{r.s.title}</Text></Table.Td>
                      <Table.Td><Text size="sm">{r.s.product}</Text></Table.Td>
                      <Table.Td><Kept s={r.s} isSet /></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{when(r.s.setAt)}{r.s.setBy ? ` · ${r.s.setBy}` : ""}</Text></Table.Td>
                      <Table.Td>
                        <Group justify="flex-end">{r.s.link && <Button size="xs" variant="default" component={Link} to={r.s.link}>Open</Button>}</Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}
        {functions && (
          <Text size="xs" c="dimmed">
            Functions read theirs with <Code>ctx.secrets.get("NAME")</Code>, declaring them in <Code>{'{ secrets: ["NAME"] }'}</Code>. The products' own are
            changed where they're used: Open takes you there.
          </Text>
        )}
      </Stack>
      <SecretDialog opened={editing !== null} name={editing === "new" ? undefined : editing?.name}
        savedReference={editing && editing !== "new" ? editing.reference : null} isSet={editing !== "new" && !!editing?.isSet}
        onDone={async (saved) => { setEditing(null); if (saved) await refresh(); }} />
      {key && <SourceKeyDialog k={key} appCredentials={!!sources.data?.appCredentials} opened={keyOpen} onClose={() => setKeyOpen(false)} />}
    </>
  );
}

/** "Value" (kept here), "AWS Parameter Store" (a reference: hover for it), or "Not set". */
function Kept({ s, isSet }: { s: { reference?: string | null }; isSet: boolean }) {
  const sources = useSecretSources();
  if (!isSet) return <Badge color="red" variant="light" tt="none">Not set</Badge>;
  if (s.reference) return <Tooltip label={s.reference}><Badge color="blue" variant="light" tt="none">From {sourceTitle(s.reference, sources.data?.sources)}</Badge></Tooltip>;
  return <Badge color="gray" variant="light" tt="none">Value</Badge>;
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

