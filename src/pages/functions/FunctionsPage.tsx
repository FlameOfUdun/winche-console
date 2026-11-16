import { useState } from "react";
import { Alert, Badge, Button, Code, Group, Loader, NumberInput, Paper, Stack, Table, Text, Textarea, TextInput, Tooltip } from "@mantine/core";
import type { FunctionsSettings } from "../../api/dataSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { FunctionInfo, FunctionRun } from "../../api/functions";
import { when } from "../authentication/UsersView";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { SecretInput, sourceTitle, useSecretSources } from "../../components/SecretInput";
import { secretTyped } from "../../api/secrets";
import { EmptyState } from "../../components/EmptyState";
import { IconHistory, IconKey, IconLambda } from "@tabler/icons-react";

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
      <HowToDeploy />
    </Stack>
  );
}

/** Functions are written in the app's repository and deployed from the terminal or CI. */
function HowToDeploy() {
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Text fw={600}>Write and deploy them from your editor</Text>
        <Code block>{`winche functions init        # a functions/ folder: index.ts, deno.json, types for VS Code
winche emulators start       # run them locally; saving reloads them
winche login                 # once: sign in to this console in your browser
winche functions deploy -m "what changed"`}</Code>
        <Text size="xs" c="dimmed">
          In CI, set <Code>WINCHE_TOKEN</Code> to a CI token with the functions scope (Project settings → CI tokens). Each deploy is a
          new version, named after who deployed it.
        </Text>
      </Stack>
    </Paper>
  );
}

/** Functions run by a trigger (documents, files, users, a schedule), whose runs are queued and retried. */
const triggered = (f: FunctionInfo) => f.kind !== "callable";

function Deployed({ functions, version }: { functions: FunctionInfo[]; version: number | null }) {
  const { state } = useSession();
  const [running, setRunning] = useState<string | null>(null);
  const [runs, setRuns] = useState<string | null>(null);
  const [shapes, setShapes] = useState<string | null>(null);
  const canSeeRuns = !!state?.capabilities?.hooks;
  if (version === null) return (
    <EmptyState icon={IconLambda} title="No functions yet"
      description="Write them in your editor and deploy them from your terminal or CI: they appear here, with Run for callables." />
  );
  return (
    <Stack gap="xs">
      <Text fw={600}>Live: version {version}</Text>
      {functions.length === 0 && <Text size="sm" c="dimmed">No functions exported.</Text>}
      {functions.map((f) => (
        <Paper key={f.name} withBorder p="sm" data-testid="function">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Group gap={6}><Text fw={600} ff="monospace">{f.name}</Text><Badge variant="light" tt="none">{f.kind}</Badge></Group>
              {f.about && <Text size="sm" mt={2} data-testid="function-about">{f.about}</Text>}
              <Text size="xs" c="dimmed">{f.description} · up to {f.timeoutSeconds} s{f.secrets?.length ? ` · secrets ${f.secrets.join(", ")}` : ""}</Text>
            </div>
            <Group gap={6} wrap="nowrap">
              {(f.input != null || f.output != null) && (
                <Button size="xs" variant="subtle" px={8} onClick={() => setShapes(shapes === f.name ? null : f.name)}>{shapes === f.name ? "Hide shapes" : "Shapes"}</Button>
              )}
              {f.kind === "callable" && <Button size="xs" variant="default" onClick={() => setRunning(running === f.name ? null : f.name)}>Run</Button>}
            {triggered(f) && canSeeRuns && (
              <Button size="xs" variant="default" onClick={() => setRuns(runs === f.name ? null : f.name)}>{runs === f.name ? "Hide runs" : "Runs"}</Button>
            )}
            </Group>
          </Group>
          {shapes === f.name && <Shapes f={f} />}
          {running === f.name && <RunPanel name={f.name} example={f.example} />}
          {runs === f.name && <TriggeredRuns name={f.name} />}
        </Paper>
      ))}
      <Text size="xs" c="dimmed">A triggered function's runs are queued and retried: open Runs on it. Everything functions log is in Logs → Functions.</Text>
    </Stack>
  );
}

/** A triggered function's latest runs (its deliveries), with how each went; a failed one can be run again. */
function TriggeredRuns({ name }: { name: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["function-runs", name], queryFn: () => api.hookDeliveries(`fn.${name}`), refetchInterval: 5000 });
  if (list.isLoading) return <Loader size="sm" mt="sm" />;
  if (list.isError) return <Alert color="red" mt="sm">Couldn't load its runs: {errorMessage(list.error)}</Alert>;
  const rows = list.data?.deliveries ?? [];
  if (rows.length === 0) return <Text size="sm" c="dimmed" mt="sm">No runs yet: it runs when its trigger fires.</Text>;
  const color = { delivered: "teal", pending: "yellow", failed: "red" } as const;
  return (
    <Table fz="xs" mt="sm" verticalSpacing={4} data-testid="function-runs">
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
    <Group align="flex-start" gap="sm" mt="sm" grow data-testid="function-shapes">
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
    <Stack gap="xs" mt="sm">
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

function VersionsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["function-versions"], queryFn: api.functionVersions });
  const [error, setError] = useState<string | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  const versions = list.data?.versions ?? [];
  if (versions.length === 0) return <EmptyState icon={IconHistory} title="No versions yet" description="Each deploy becomes a version here, and you can roll back to any of them." />;
  const rollBack = async (v: number) => {
    if (!window.confirm(`Deploy version ${v}'s code again, as a new version?`)) return;
    setError(null);
    try {
      await api.rollBackFunctions(v, null);
      for (const key of ["functions", "function-versions"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) { setError(errorWithList(e)); }
  };
  return (
    <Stack gap="sm">
      {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
      <Paper withBorder style={{ overflowX: "auto" }}>
        <Table fz="sm" verticalSpacing={6} miw={640}>
          <Table.Tbody>
            {versions.map((v, i) => (
              <Table.Tr key={v.version} data-testid="function-version">
                <Table.Td><Text fw={600}>v{v.version}</Text></Table.Td>
                <Table.Td><Text size="xs">{when(v.at)}</Text></Table.Td>
                <Table.Td><Text size="xs">{v.by ?? "—"}</Text></Table.Td>
                <Table.Td><Text size="xs">{v.note ?? "—"}{v.rolledBackFrom ? ` (from v${v.rolledBackFrom})` : ""}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{v.functions.map((f) => f.name).join(", ") || "no functions"}</Text></Table.Td>
                <Table.Td ta="right">
                  {i === 0 ? <Badge color="teal" variant="light" tt="none">Live</Badge> : <Button size="xs" variant="default" onClick={() => rollBack(v.version)}>Roll back</Button>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
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
        {!adding && <Button size="xs" onClick={() => setAdding(true)} disabled={!list.data.available}>Add a secret</Button>}
      </Group>
      {adding && <SecretForm onDone={async (saved) => { setAdding(false); if (saved) await refresh(); }} />}
      {secrets.length === 0 && !adding ? (
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
                      <Button size="xs" variant="default" onClick={() => setEditing(editing === s.name ? null : s.name)}>{s.isSet ? "Replace" : "Set"}</Button>
                      {s.isSet && <Button size="xs" variant="subtle" color="red" onClick={() => remove(s.name)}>Remove</Button>}
                    </Group>
                    {tested?.name === s.name && <Text size="xs" ta="left" c={tested.ok ? "teal" : "red"} mt={4}>{tested.ok ? "Read just now: it works." : tested.problem}</Text>}
                    {editing === s.name && <SecretForm name={s.name} savedReference={s.reference} onDone={async (saved) => { setEditing(null); if (saved) await refresh(); }} />}
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

function SecretForm({ name: fixed, savedReference, onDone }: { name?: string; savedReference?: string | null; onDone: (saved: boolean) => void | Promise<void> }) {
  const [name, setName] = useState(fixed ?? "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badName = name !== "" && !SECRET_NAME.test(name);
  const save = async () => {
    setError(null);
    setBusy(true);
    try { await api.setFunctionSecret(name, value); await onDone(true); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="xs" mt="xs" ta="left">
      <Group align="flex-end" wrap="wrap">
        {!fixed && (
          <TextInput label="Name" placeholder="MAIL_API_KEY" ff="monospace" value={name} onChange={(e) => setName(e.currentTarget.value.toUpperCase())}
            error={badName ? "Capitals, digits and underscores, starting with a letter" : undefined} />
        )}
        <SecretInput label={fixed ? `New value of ${fixed}` : "Value"} style={{ flex: "1 1 320px" }} value={value} onChange={setValue} autoComplete="off" savedReference={savedReference} />
        <Button loading={busy} disabled={!name || badName || !secretTyped(value)} onClick={save}>Save</Button>
        <Button variant="default" onClick={() => onDone(false)}>Cancel</Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
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
  const [draft, setDraft] = useState<FunctionsSettings | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (page.isLoading || saved.isLoading) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;
  const s = draft ?? saved.data.settings;
  const max = page.data?.maxTimeoutSeconds ?? 540;
  const functions = (page.data?.current?.functions ?? []).filter((f) => f.kind !== "consolePage" && f.kind !== "before");
  const edit = (patch: Partial<FunctionsSettings>) => setDraft({ ...s, ...patch });
  const own = (name: string, seconds: number | null) => {
    const timeouts = { ...s.timeouts };
    if (seconds === null) delete timeouts[name]; else timeouts[name] = seconds;
    edit({ timeouts });
  };
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.saveDataSettings("functions", s, reason.trim(), saved.data.version?.number ?? 0);
      setDraft(null);
      setReason("");
      for (const key of ["data-settings", "functions"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  const seconds = (v: string | number) => (typeof v === "number" && v > 0 ? Math.round(v) : null);
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        A function's time is its own here, else the one its code sets (<Code>timeoutSeconds</Code>), else the default. This server allows {time(max)} at most.
        A run that long still ends if the server restarts: long work should save its progress as it goes.
      </Text>
      {!saved.data.editable && <Alert color="gray">{saved.data.whyReadOnly}</Alert>}
      <Paper withBorder p="sm">
        <Group align="flex-end">
          <NumberInput label="Default run time" description="For functions with no time of their own or in their code" w={260} min={1} max={max} suffix=" s"
            disabled={!saved.data.editable} value={s.defaultTimeoutSeconds} onChange={(v) => edit({ defaultTimeoutSeconds: seconds(v) ?? 60 })} />
        </Group>
      </Paper>
      {functions.length > 0 && (
        <Paper withBorder style={{ overflowX: "auto" }}>
          <Table fz="sm" verticalSpacing={6} miw={640}>
            <Table.Thead>
              <Table.Tr><Table.Th>Function</Table.Th><Table.Th>In its code</Table.Th><Table.Th>Its own time</Table.Th><Table.Th>In force</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {functions.map((f) => {
                const mine = s.timeouts[f.name];
                const inForce = Math.min(mine ?? f.codeTimeoutSeconds ?? s.defaultTimeoutSeconds, max);
                return (
                  <Table.Tr key={f.name} data-testid="function-time">
                    <Table.Td><Group gap={6}><Text ff="monospace" fw={600}>{f.name}</Text><Badge variant="light" tt="none">{f.kind}</Badge></Group></Table.Td>
                    <Table.Td><Text size="xs">{f.codeTimeoutSeconds ? time(f.codeTimeoutSeconds) : "—"}</Text></Table.Td>
                    <Table.Td>
                      <NumberInput aria-label={`Own time of ${f.name}`} w={150} min={1} max={max} suffix=" s" placeholder="not set" size="xs"
                        disabled={!saved.data.editable} value={mine ?? ""} onChange={(v) => own(f.name, seconds(v))} />
                    </Table.Td>
                    <Table.Td><Text size="xs">{time(inForce)}</Text></Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      {draft && (
        <Group align="flex-end">
          <TextInput label="Reason for the change" style={{ flex: "1 1 300px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save</Button>
          <Button variant="default" onClick={() => { setDraft(null); setReason(""); }}>Cancel</Button>
        </Group>
      )}
      {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
    </Stack>
  );
}
