import { useState } from "react";
import { Alert, Badge, Button, Code, Group, Loader, Modal, NumberInput, Paper, Stack, Table, Tabs, Text, Textarea, TextInput, Timeline, Tooltip, UnstyledButton } from "@mantine/core";
import type { FunctionsSettings } from "../../api/dataSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { FunctionInfo, FunctionRun, FunctionVersion } from "../../api/functions";
import { when } from "../authentication/UsersView";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { SecretInput, sourceTitle, useSecretSources } from "../../components/SecretInput";
import { secretTyped } from "../../api/secrets";
import { EmptyState } from "../../components/EmptyState";
import { IconArrowBackUp, IconCheck, IconHistory, IconKey, IconLambda } from "@tabler/icons-react";

/**
 * Functions: TypeScript run on the server when data changes, on a schedule, or when apps call them. The code lives in
 * the app's repository and is deployed with the CLI; here: what's live, running a callable, versions and rollback, and
 * the secrets functions read.
 */
export function FunctionsPage() {
  const [tab, setTab] = useState<"deployed" | "versions" | "secrets" | "settings">("deployed");
  return (
    <>
      <PageBand title="Functions" tabs={[
        { label: "Dashboard", active: tab === "deployed", onClick: () => setTab("deployed") },
        { label: "Versions", active: tab === "versions", onClick: () => setTab("versions") },
        { label: "Secrets", active: tab === "secrets", onClick: () => setTab("secrets") },
        { label: "Settings", active: tab === "settings", onClick: () => setTab("settings") },
      ]} />
      <div style={{ paddingBottom: 28 }}>
        {tab === "deployed" ? <DeployedTab /> : tab === "versions" ? <VersionsTab /> : tab === "secrets" ? <SecretsTab /> : <SettingsTab />}
      </div>
    </>
  );
}

function DeployedTab() {
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  if (page.isLoading) return <Loader size="sm" />;
  if (page.isError || !page.data) return <Alert color="red">Couldn't load the functions: {errorMessage(page.error)}</Alert>;
  const d = page.data;
  return (
    <Stack gap="md">
      {d.runtimeProblem && <Alert color="red" title="Functions can't run on this server">{d.runtimeProblem}</Alert>}
      <Deployed functions={d.current?.functions ?? []} version={d.current?.version ?? null} />
    </Stack>
  );
}

/** Functions run by a trigger (documents, files, users, a schedule), whose runs are queued and retried. */
const triggered = (f: FunctionInfo) => f.kind !== "callable";

const KIND: Record<FunctionInfo["kind"], string> = {
  callable: "callable", documents: "documents", files: "files", users: "users", schedule: "schedule", before: "before write",
  http: "HTTP", consolePage: "console page", consoleAction: "console action",
};

function Deployed({ functions, version }: { functions: FunctionInfo[]; version: number | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (version === null) return (
    <EmptyState icon={IconLambda} title="No functions yet"
      description="Write them in your editor and deploy them from your terminal or CI: they appear here." />
  );
  const shown = functions.find((f) => f.name === open) ?? null;
  return (
    <Stack gap="sm">
      <Group gap={8}><Text fw={600}>Live</Text><Badge variant="light" color="teal" tt="none">version {version}</Badge>
        <Text size="sm" c="dimmed">{functions.length} {functions.length === 1 ? "function" : "functions"}</Text></Group>
      {functions.length === 0 && <Text size="sm" c="dimmed">No functions exported.</Text>}
      <Stack gap="xs">
        {functions.map((f) => (
          <UnstyledButton key={f.name} onClick={() => setOpen(f.name)} data-testid="function" aria-label={f.name}>
            <Paper withBorder radius="md" p="md" className="winche-card-link">
              <Group wrap="nowrap" gap={8}>
                <Text fw={600} ff="monospace" truncate>{f.name}</Text>
                <Badge variant="light" tt="none" style={{ flexShrink: 0 }}>{KIND[f.kind] ?? f.kind}</Badge>
              </Group>
              <Text size="sm" mt={4} c={f.about ? undefined : "dimmed"} lineClamp={2} data-testid={f.about ? "function-about" : undefined}>
                {f.about ?? f.description}
              </Text>
              {f.about && <Text size="xs" c="dimmed" mt={4} lineClamp={1}>{f.description}</Text>}
            </Paper>
          </UnstyledButton>
        ))}
      </Stack>
      <FunctionDialog f={shown} onClose={() => setOpen(null)} />
    </Stack>
  );
}

/** One function: what it is, running it (callables) or its runs (triggered), and its own run time. */
function FunctionDialog({ f, onClose }: { f: FunctionInfo | null; onClose: () => void }) {
  const { state } = useSession();
  const [tab, setTab] = useState<string | null>("details");
  const canSeeRuns = !!state?.capabilities?.hooks;
  const close = () => { setTab("details"); onClose(); };
  return (
    <Modal opened={!!f} onClose={close} radius="lg" size="xl"
      title={f && <Group gap={8}><Text fw={700} fz={18} ff="monospace">{f.name}</Text><Badge variant="light" tt="none">{KIND[f.kind] ?? f.kind}</Badge></Group>}>
      {f && (
        <Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="details">Details</Tabs.Tab>
            {f.kind === "callable" && <Tabs.Tab value="run">Run</Tabs.Tab>}
            {triggered(f) && canSeeRuns && <Tabs.Tab value="runs">Runs</Tabs.Tab>}
            <Tabs.Tab value="settings">Settings</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="details"><Details f={f} /></Tabs.Panel>
          <Tabs.Panel value="run"><RunPanel name={f.name} example={f.example} /></Tabs.Panel>
          <Tabs.Panel value="runs"><TriggeredRuns name={f.name} /></Tabs.Panel>
          <Tabs.Panel value="settings"><OwnTime f={f} /></Tabs.Panel>
        </Tabs>
      )}
    </Modal>
  );
}

function Details({ f }: { f: FunctionInfo }) {
  const row = (label: string, value: React.ReactNode) => (
    <Group gap="md" wrap="nowrap" align="flex-start"><Text size="sm" c="dimmed" w={110} style={{ flexShrink: 0 }}>{label}</Text><div style={{ minWidth: 0 }}>{value}</div></Group>
  );
  return (
    <Stack gap="sm">
      {f.about && <Text size="sm">{f.about}</Text>}
      {row("Runs", <Text size="sm">{f.description}</Text>)}
      {row("Run time", <Text size="sm">up to {time(f.timeoutSeconds)}</Text>)}
      {row("Secrets", f.secrets?.length
        ? <Group gap={4}>{f.secrets.map((n) => <Badge key={n} size="sm" variant="light" color="gray" tt="none" ff="monospace" fw={500}>{n}</Badge>)}</Group>
        : <Text size="sm" c="dimmed">none</Text>)}
      {(f.input != null || f.output != null) && <Shapes f={f} />}
      {triggered(f) && <Text size="xs" c="dimmed">Its runs are queued and retried. Everything functions log is in Logs → Functions.</Text>}
    </Stack>
  );
}

/** The function's own run time, over its code's and the project's default; saved with a reason, as a settings version. */
function OwnTime({ f }: { f: FunctionInfo }) {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const saved = useQuery({ queryKey: ["data-settings", "functions"], queryFn: () => api.dataSettings<FunctionsSettings>("functions") });
  const [mine, setMine] = useState<number | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (saved.isLoading) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;
  const s = saved.data.settings;
  const max = page.data?.maxTimeoutSeconds ?? 540;
  const current = s.timeouts[f.name] ?? null;
  const value = mine === undefined ? current : mine;
  const inForce = Math.min(value ?? f.codeTimeoutSeconds ?? s.defaultTimeoutSeconds, max);
  const changed = value !== current;
  const save = async () => {
    setBusy(true); setError(null);
    const timeouts = { ...s.timeouts };
    if (value === null) delete timeouts[f.name]; else timeouts[f.name] = value;
    try {
      await api.saveDataSettings("functions", { ...s, timeouts }, reason.trim(), saved.data.version?.number ?? 0);
      for (const key of ["data-settings", "functions"]) await qc.invalidateQueries({ queryKey: [key] });
      setMine(undefined); setReason(""); setDone(true);
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="sm">
      {!saved.data.editable && <Alert color="gray">{saved.data.whyReadOnly}</Alert>}
      <NumberInput label="Its own run time" w={260} min={1} max={max} suffix=" s" placeholder="not set" data-testid="own-time"
        description={`In its code: ${f.codeTimeoutSeconds ? time(f.codeTimeoutSeconds) : "not set"} · the default: ${time(s.defaultTimeoutSeconds)} · this server's longest: ${time(max)}`}
        disabled={!saved.data.editable} value={value ?? ""}
        onChange={(v) => { setDone(false); setMine(typeof v === "number" && v > 0 ? Math.round(v) : null); }} />
      <Text size="sm">In force: <b>{time(inForce)}</b>{value ? "" : f.codeTimeoutSeconds ? " (its code's)" : " (the default)"}</Text>
      {changed && (
        <Group align="flex-end">
          <TextInput label="Reason for the change" style={{ flex: "1 1 260px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save</Button>
          <Button variant="default" onClick={() => { setMine(undefined); setReason(""); }}>Cancel</Button>
        </Group>
      )}
      {done && !changed && <Text size="xs" c="teal">Saved: it applies from the next run.</Text>}
      {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
      <Text size="xs" c="dimmed">A run that long still ends if the server restarts: long work should save its progress as it goes.</Text>
    </Stack>
  );
}

/** A triggered function's latest runs (its deliveries), with how each went; a failed one can be run again. */
function TriggeredRuns({ name }: { name: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["function-runs", name], queryFn: () => api.hookDeliveries(`fn.${name}`), refetchInterval: 5000 });
  if (list.isLoading) return <Loader size="sm" />;
  if (list.isError) return <Alert color="red">Couldn't load its runs: {errorMessage(list.error)}</Alert>;
  const rows = list.data?.deliveries ?? [];
  if (rows.length === 0) return <Text size="sm" c="dimmed">No runs yet: it runs when its trigger fires.</Text>;
  const color = { delivered: "teal", pending: "yellow", failed: "red" } as const;
  return (
    <Table fz="xs" verticalSpacing={4} data-testid="function-runs">
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.id}>
            <Table.Td><Badge size="xs" variant="light" color={color[r.status]} tt="none">{r.status === "delivered" ? "ran" : r.status}</Badge></Table.Td>
            <Table.Td>{when(r.createdAt)}</Table.Td>
            <Table.Td><Text size="xs" ff="monospace">{r.type}{r.path ? ` ${r.path}` : ""}</Text></Table.Td>
            <Table.Td><Text size="xs" c="dimmed" lineClamp={2}>{r.lastResult ?? ""}{r.attempts > 1 ? ` (${r.attempts} tries)` : ""}</Text></Table.Td>
            <Table.Td>
              {r.status === "failed" && (
                <Button size="compact-xs" variant="subtle" onClick={async () => { await api.retryHookDelivery(r.id); await qc.invalidateQueries({ queryKey: ["function-runs", name] }); }}>
                  Run again
                </Button>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** What a function takes and returns (its input and output JSON Schemas), as written in its options. */
function Shapes({ f }: { f: FunctionInfo }) {
  return (
    <Group align="flex-start" gap="sm" grow data-testid="function-shapes">
      {f.input != null && <Stack gap={4}><Text size="xs" fw={600}>Input</Text><Code block>{JSON.stringify(f.input, null, 2)}</Code></Stack>}
      {f.output != null && <Stack gap={4}><Text size="xs" fw={600}>Output</Text><Code block>{JSON.stringify(f.output, null, 2)}</Code></Stack>}
    </Group>
  );
}

function RunPanel({ name, example }: { name: string; example?: unknown }) {
  const [data, setData] = useState(example === undefined || example === null ? "{}" : JSON.stringify(example, null, 2));
  const [uid, setUid] = useState("");
  const [result, setResult] = useState<FunctionRun | "running" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    let parsed: unknown;
    try { parsed = data.trim() ? JSON.parse(data) : null; } catch { setError("The data isn't JSON."); return; }
    setResult("running");
    try { setResult(await api.runFunction(name, parsed, uid.trim() || null)); }
    catch (e) { setResult(null); setError(errorMessage(e)); }
  };
  return (
    <Stack gap="xs">
      <Group align="flex-end" wrap="wrap">
        <Textarea label="Data (JSON)" autosize minRows={2} ff="monospace" style={{ flex: "1 1 300px" }} value={data} onChange={(e) => setData(e.currentTarget.value)} />
        <TextInput label="As user (optional)" placeholder="a uid" value={uid} onChange={(e) => setUid(e.currentTarget.value)} />
        <Button loading={result === "running"} onClick={run}>Run</Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {result && result !== "running" && (
        <Stack gap={4} data-testid="run-result">
          <Text size="sm" c={result.ok ? "teal" : "red"}>{result.ok ? `Returned in ${result.durationMs} ms:` : `Failed (${result.error?.code}): ${result.error?.message}`}</Text>
          {result.ok && <Code block>{JSON.stringify(result.result, null, 2)}</Code>}
          {result.logs.length > 0 && <Code block>{result.logs.map((l) => `${l.level === "log" ? "" : `[${l.level}] `}${l.message}`).join("\n")}</Code>}
        </Stack>
      )}
    </Stack>
  );
}

/** What changed from the version before: functions added and removed (by name). */
function changes(v: FunctionVersion, before: FunctionVersion | undefined) {
  const now = v.functions.map((f) => f.name);
  if (!before) return { added: now, removed: [] as string[], first: true };
  const was = new Set(before.functions.map((f) => f.name));
  return { added: now.filter((n) => !was.has(n)), removed: [...was].filter((n) => !now.includes(n)), first: false };
}

function Names({ names, color }: { names: string[]; color: string }) {
  return (
    <Group gap={4}>
      {names.map((n) => <Badge key={n} size="sm" variant="light" color={color} tt="none" ff="monospace" fw={500}>{n}</Badge>)}
    </Group>
  );
}

/**
 * Every deploy, newest first, as a timeline: who deployed it and why, how many functions it had and which were added or
 * removed since the one before. Rolling back deploys an older version's code again, as a new version.
 */
function VersionsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["function-versions"], queryFn: api.functionVersions });
  const [rolling, setRolling] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  const versions = list.data?.versions ?? [];
  if (versions.length === 0) return <EmptyState icon={IconHistory} title="No versions yet" description="Each deploy becomes a version here, and you can roll back to any of them." />;
  const close = () => { setRolling(null); setNote(""); setError(null); };
  const rollBack = async () => {
    if (rolling === null) return;
    setBusy(true); setError(null);
    try {
      await api.rollBackFunctions(rolling, note.trim() || null);
      for (const key of ["functions", "function-versions"]) await qc.invalidateQueries({ queryKey: [key] });
      close();
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Paper withBorder radius="md" p="lg">
      <Timeline active={0} color="teal" bulletSize={26} lineWidth={2}>
        {versions.map((v, i) => {
          const live = i === 0;
          const c = changes(v, versions[i + 1]);
          return (
            <Timeline.Item key={v.version} data-testid="function-version" color={live ? "teal" : "gray"}
              bullet={live ? <IconCheck size={14} /> : v.rolledBackFrom ? <IconArrowBackUp size={14} /> : <IconHistory size={14} />}
              title={
                <Group gap={8} justify="space-between" wrap="nowrap">
                  <Group gap={8}>
                    <Text fw={600} size="sm">Version {v.version}</Text>
                    {v.rolledBackFrom && <Badge size="xs" variant="light" color="gray" tt="none">version {v.rolledBackFrom} again</Badge>}
                    {live && <Badge size="xs" variant="light" color="teal" tt="none">Live</Badge>}
                  </Group>
                  {!live && <Button size="compact-xs" variant="subtle" onClick={() => setRolling(v.version)}>Roll back</Button>}
                </Group>
              }>
              <Text size="xs" c="dimmed">{when(v.at)}{v.by ? ` · ${v.by}` : ""} · {v.functions.length} {v.functions.length === 1 ? "function" : "functions"}</Text>
              {v.note && <Text size="sm" mt={4} style={{ fontStyle: "italic" }}>“{v.note}”</Text>}
              {c.first ? null : c.added.length + c.removed.length === 0 ? (
                <Text size="xs" c="dimmed" mt={4}>Same functions as before: code changes only.</Text>
              ) : (
                <Stack gap={4} mt={6}>
                  {c.added.length > 0 && <Group gap={6} wrap="nowrap" align="flex-start"><Text size="xs" c="dimmed" w={60}>Added</Text><Names names={c.added} color="teal" /></Group>}
                  {c.removed.length > 0 && <Group gap={6} wrap="nowrap" align="flex-start"><Text size="xs" c="dimmed" w={60}>Removed</Text><Names names={c.removed} color="red" /></Group>}
                </Stack>
              )}
            </Timeline.Item>
          );
        })}
      </Timeline>
      <Modal opened={rolling !== null} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Roll back to version {rolling}?</Text>}>
        <Stack gap="md">
          <Text size="sm">Its code is deployed again, as a new version. Functions it doesn't have stop running.</Text>
          <TextInput label="Note (optional)" placeholder="Why" data-autofocus value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button loading={busy} onClick={rollBack}>Roll back</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Secrets functions read with ctx.secrets.get: set or replaced here (or with `winche functions secrets set`), never
 * shown again. Lists the saved ones and those the live code declares but nobody has set.
 */
function SecretsTab() {
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
      <Group justify="space-between">
        <Text size="sm" c="dimmed">API keys and passwords your functions read with <Code>ctx.secrets.get("NAME")</Code>. A function declares the ones it uses: <Code>{'{ secrets: ["NAME"] }'}</Code>.</Text>
        <Button size="xs" onClick={() => setAdding(true)} disabled={!list.data.available}>Add a secret</Button>
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
                    {!s.isSet ? <Badge color="red" variant="light" tt="none">Not set</Badge>
                      : s.reference ? <Tooltip label={s.reference}><Badge color="blue" variant="light" tt="none">From {sourceTitle(s.reference, sources.data?.sources)}</Badge></Tooltip>
                      : <Badge color="teal" variant="light" tt="none">Set</Badge>}
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

const time = (seconds: number) => seconds % 60 === 0 ? `${seconds / 60} min` : seconds > 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;

/**
 * How long functions may run: the project's default, and each function's own time over what its code says, up to the
 * server's longest. Applied from the next run; each save is a version with its reason.
 */
function SettingsTab() {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const saved = useQuery({ queryKey: ["data-settings", "functions"], queryFn: () => api.dataSettings<FunctionsSettings>("functions") });
  const [draft, setDraft] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (page.isLoading || saved.isLoading) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;
  const s = saved.data.settings;
  const max = page.data?.maxTimeoutSeconds ?? 540;
  const own = Object.entries(s.timeouts);
  const save = async () => {
    if (draft === null) return;
    setError(null);
    setBusy(true);
    try {
      await api.saveDataSettings("functions", { ...s, defaultTimeoutSeconds: draft }, reason.trim(), saved.data.version?.number ?? 0);
      setDraft(null);
      setReason("");
      for (const key of ["data-settings", "functions"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Paper withBorder radius="md" p="lg">
      <Stack gap="md">
        <div>
          <Text fw={600}>Run time</Text>
          <Text size="sm" c="dimmed">
            How long a function may run: its own time (open it on the Dashboard), else the one its code sets (<Code>timeoutSeconds</Code>),
            else this default. This server allows {time(max)} at most.
          </Text>
        </div>
        {!saved.data.editable && <Alert color="gray">{saved.data.whyReadOnly}</Alert>}
        <NumberInput label="Default run time" w={260} min={1} max={max} suffix=" s" disabled={!saved.data.editable}
          value={draft ?? s.defaultTimeoutSeconds} onChange={(v) => setDraft(typeof v === "number" && v > 0 ? Math.round(v) : 60)} />
        {own.length > 0 && (
          <Text size="sm" c="dimmed" data-testid="own-times">
            With their own time: {own.map(([n, t], i) => <span key={n}>{i > 0 && ", "}<Code>{n}</Code> {time(t)}</span>)}
          </Text>
        )}
        {draft !== null && draft !== s.defaultTimeoutSeconds && (
          <Group align="flex-end">
            <TextInput label="Reason for the change" style={{ flex: "1 1 300px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save</Button>
            <Button variant="default" onClick={() => { setDraft(null); setReason(""); }}>Cancel</Button>
          </Group>
        )}
        {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
      </Stack>
    </Paper>
  );
}
