import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Anchor, Badge, Button, Code, Group, Loader, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Timeline, UnstyledButton } from "@mantine/core";
import type { FunctionsSettings } from "../../api/dataSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { FunctionInfo, FunctionRun, FunctionVersion } from "../../api/functions";
import { when } from "../authentication/UsersView";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { CardsPage, HistoryButton } from "../../components/EditCard";
import { AreaHistory } from "../settings/AreaSettings";
import { surface } from "../../theme";
import { EmptyState } from "../../components/EmptyState";
import { IconArrowBackUp, IconArrowRight, IconCheck, IconHistory, IconLambda } from "@tabler/icons-react";

/**
 * Functions: TypeScript run on the server when data changes, on a schedule, or when apps call them. The code lives in
 * the app's repository and is deployed with the CLI; here: what's live, running a callable, versions and rollback. The
 * secrets functions read are on the Secrets page.
 */
export function FunctionsPage() {
  const [tab, setTab] = useState<"deployed" | "settings">("deployed");
  return (
    <>
      <PageBand title="Functions" tabs={[
        { label: "Dashboard", active: tab === "deployed", onClick: () => setTab("deployed") },
        { label: "Settings", active: tab === "settings", onClick: () => setTab("settings") },
      ]} />
      <div style={{ paddingBottom: 28 }}>
        {tab === "deployed" ? <DeployedTab /> : <SettingsTab />}
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
  http: "HTTP", consolePage: "console page",
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
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {functions.map((f) => (
          <UnstyledButton key={f.name} onClick={() => setOpen(f.name)} data-testid="function" aria-label={f.name}>
            <Paper withBorder p="lg" className="winche-card-link" h="100%" style={{ display: "flex", flexDirection: "column" }}>
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                <Text fw={600} fz={16} ff="monospace" truncate>{f.name}</Text>
                <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                  {f.plugin && <Badge variant="light" color="grape" tt="none" title={`From the plugin installed as ${f.plugin}`}>plugin</Badge>}
                  <Badge variant="light" tt="none">{KIND[f.kind] ?? f.kind}</Badge>
                </Group>
              </Group>
              <Text size="sm" mt={6} c={f.about ? undefined : "dimmed"} lineClamp={2} data-testid={f.about ? "function-about" : undefined}>
                {f.about ?? f.description}
              </Text>
              <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap" style={{ marginTop: "auto", paddingTop: 16 }}>
                <Text size="xs" c="dimmed" lineClamp={1}>{f.about ? f.description : ""}</Text>
                <Group gap={4} c={surface.accent} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Text size="sm" fw={600}>Open</Text>
                  <IconArrowRight size={15} />
                </Group>
              </Group>
            </Paper>
          </UnstyledButton>
        ))}
      </SimpleGrid>
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
            {f.kind !== "before" && <Tabs.Tab value="instances">Instances</Tabs.Tab>}
            <Tabs.Tab value="settings">Settings</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="details"><Details f={f} /></Tabs.Panel>
          <Tabs.Panel value="run"><RunPanel name={f.name} example={f.example} /></Tabs.Panel>
          <Tabs.Panel value="runs"><TriggeredRuns name={f.name} /></Tabs.Panel>
          <Tabs.Panel value="instances"><Instances name={f.name} /></Tabs.Panel>
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
        ? <Group gap={6}>{f.secrets.map((n) => <Badge key={n} size="sm" variant="light" color="gray" tt="none" ff="monospace" fw={500}>{n}</Badge>)}
            <Anchor component={Link} to="/secrets" size="xs">Manage secrets</Anchor></Group>
        : <Text size="sm" c="dimmed">none</Text>)}
      {(f.input != null || f.output != null) && <Shapes f={f} />}
      {triggered(f) && <Text size="xs" c="dimmed">Its runs are queued and retried. Everything functions log is in Logs → Functions.</Text>}
    </Stack>
  );
}

const EVENT: Record<string, { label: string; color: string }> = {
  memory: { label: "Over its memory", color: "orange" }, timeout: { label: "Out of time", color: "yellow" }, crash: { label: "Crashed", color: "red" },
  "out-of-memory": { label: "Process out of memory", color: "red" }, stopped: { label: "Process stopped", color: "red" },
};
const ago = (seconds: number) => seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`;

/**
 * A function's instances now on the server that answered (busy, idle, loading; each one's heap after its last run),
 * its process, and what happened to them lately: replaced for memory, time or a crash, its process out of memory.
 */
function Instances({ name }: { name: string }) {
  const q = useQuery({ queryKey: ["function-instances", name], queryFn: () => api.functionInstances(name), refetchInterval: 3000 });
  if (q.isLoading) return <Loader size="sm" />;
  if (q.isError || !q.data) return <Alert color="red">Couldn't load its instances: {errorMessage(q.error)}</Alert>;
  const d = q.data;
  const l = d.limits;
  const count = (state: string) => d.instances.filter((i) => i.state === state).length;
  const others = d.otherServers ?? [];
  return (
    <Stack gap="md">
      {others.length > 0 && (
        <Alert color="blue" data-testid="other-servers">
          This is server {d.server}'s view. {others.length === 1 ? "1 other server runs" : `${others.length} other servers run`} this
          project ({others.join(", ")}), each with its own instances: they aren't counted here. Limits apply on each server;
          replacements on any of them are in the server logs.
        </Alert>
      )}
      <Group gap="xl" data-testid="instances-summary">
        <div><Text size="xs" c="dimmed">Busy</Text><Text fw={600}>{count("busy")}{l && <Text span c="dimmed" fw={400}> of {l.maxInstances} at most</Text>}</Text></div>
        <div><Text size="xs" c="dimmed">Idle</Text><Text fw={600}>{count("idle") + count("loading")}{l && l.minInstances > 0 && <Text span c="dimmed" fw={400}> ({l.minInstances} kept loaded)</Text>}</Text></div>
        {l && <div><Text size="xs" c="dimmed">Memory each</Text><Text fw={600}>{l.memoryMb} MB</Text></div>}
        {d.process && (
          <div>
            <Text size="xs" c="dimmed">Process</Text>
            <Text fw={600}>{d.process.own ? "Its own" : "Shared"}
              <Text span c="dimmed" fw={400}> · {d.process.running ? `up ${d.process.startedAt ? ago(Math.max(0, Math.round((Date.now() - Date.parse(d.process.startedAt)) / 1000))) : ""}` : "not running"}
                {d.process.restarts > 0 && ` · started again ${d.process.restarts}×`}</Text>
            </Text>
          </div>
        )}
      </Group>
      {d.refused && (
        <Alert color="yellow">
          It asks for a process of its own but runs in the shared one: this server's functions memory ({d.budget.usedMb} of {d.budget.totalMb} MB
          in use) or its processes per project are taken. Ask a server admin, or give it less memory.
        </Alert>
      )}
      {d.instances.length === 0
        ? <Text size="sm" c="dimmed">No instances now: the next run loads one.</Text>
        : (
          <Table data-testid="instances" verticalSpacing={4}>
            <Table.Thead><Table.Tr><Table.Th>State</Table.Th><Table.Th>Heap after its last run</Table.Th><Table.Th>Runs</Table.Th><Table.Th>Up</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {d.instances.map((i, n) => (
                <Table.Tr key={n}>
                  <Table.Td><Badge variant="light" color={i.state === "busy" ? "blue" : "gray"}>{i.state === "busy" && i.busySeconds !== null ? `busy ${ago(i.busySeconds)}` : i.state}</Badge></Table.Td>
                  <Table.Td>{i.heapMb === null ? "—" : <Text size="sm" c={l && i.heapMb > l.memoryMb * 0.8 ? "orange" : undefined}>{i.heapMb} MB</Text>}</Table.Td>
                  <Table.Td>{i.runs}</Table.Td>
                  <Table.Td>{ago(i.ageSeconds)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      <div>
        <Text fw={600} size="sm" mb={4}>Lately</Text>
        {d.events.length === 0
          ? <Text size="sm" c="dimmed">Nothing replaced or stopped since this server started.</Text>
          : (
            <Stack gap={6} data-testid="instance-events">
              {d.events.map((e, n) => (
                <Group key={n} gap="sm" wrap="nowrap" align="flex-start">
                  <Badge variant="light" color={EVENT[e.kind]?.color ?? "gray"} style={{ flexShrink: 0 }}>{EVENT[e.kind]?.label ?? e.kind}</Badge>
                  <Text size="sm" style={{ flex: 1 }}>{e.message}</Text>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{new Date(e.at).toLocaleString()}</Text>
                </Group>
              ))}
            </Stack>
          )}
      </div>
      <Text size="xs" c="dimmed">On server {d.server}. Updated every few seconds.</Text>
    </Stack>
  );
}

type LimitKey = "memoryMb" | "minInstances" | "maxInstances" | "reservedInstances";
const LIMITS: { key: LimitKey; label: string; suffix?: string; hint: string }[] = [
  { key: "memoryMb", label: "Memory", suffix: " MB", hint: "The most an instance may hold after a run: past it, the instance is replaced." },
  { key: "minInstances", label: "Kept loaded", hint: "Instances kept ready even when idle, so a call never waits." },
  { key: "maxInstances", label: "Most at once", hint: "Runs of it at the same time; more wait their turn." },
  { key: "reservedInstances", label: "Reserved", hint: "Runs of the project's limit kept for it, so busy functions can't take them all." },
];
const FROM: Record<string, string> = { setting: "its setting", code: "its code", default: "the default" };

/**
 * The function's own settings, over its code's and the project's defaults: its run time and its instances (memory,
 * how many kept loaded, at most at once, reserved, its own process). Saved together with a reason, as a settings version.
 */
function OwnTime({ f }: { f: FunctionInfo }) {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const saved = useQuery({ queryKey: ["data-settings", "functions"], queryFn: () => api.dataSettings<FunctionsSettings>("functions") });
  type Draft = { time?: number | null; isolate?: boolean | null } & Partial<Record<LimitKey, number | null>>;
  const [draft, setDraft] = useState<Draft>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (saved.isLoading) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;
  const s = saved.data.settings;
  const editable = saved.data.editable;
  const max = page.data?.maxTimeoutSeconds ?? 540;
  const own = s.limits?.[f.name] ?? {};
  const savedOf = (k: keyof Draft): number | boolean | null => (k === "time" ? s.timeouts[f.name] : own[k as LimitKey | "isolate"]) ?? null;
  const valueOf = (k: keyof Draft) => (k in draft ? draft[k] ?? null : savedOf(k));
  const set = (k: keyof Draft, v: number | boolean | null) => { setDone(false); setDraft({ ...draft, [k]: v }); };
  const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== savedOf(k));
  const time = valueOf("time") as number | null;
  const timeInForce = Math.min(time ?? f.codeTimeoutSeconds ?? s.defaultTimeoutSeconds, max);
  const save = async () => {
    setBusy(true); setError(null);
    const timeouts = { ...s.timeouts };
    if ("time" in draft) { if (draft.time == null) delete timeouts[f.name]; else timeouts[f.name] = draft.time; }
    const mine: Record<string, number | boolean> = { ...own };
    for (const k of [...LIMITS.map((l) => l.key), "isolate"] as (keyof Draft)[]) {
      if (!(k in draft)) continue;
      const v = draft[k];
      if (v == null) delete mine[k]; else mine[k] = v;
    }
    const limits = { ...(s.limits ?? {}) };
    if (Object.keys(mine).length) limits[f.name] = mine; else delete limits[f.name];
    try {
      await api.saveDataSettings("functions", { ...s, timeouts, limits }, reason.trim(), saved.data.version?.number ?? 0);
      for (const key of ["data-settings", "functions"]) await qc.invalidateQueries({ queryKey: [key] });
      setDraft({}); setReason(""); setDone(true);
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  const l = f.limits;
  const number = (v: string | number) => (typeof v === "number" && v >= 0 ? Math.round(v) : null);
  return (
    <Stack gap="md">
      {!editable && <Alert color="gray">{saved.data.whyReadOnly}</Alert>}
      <NumberInput label="Run time" w={260} min={1} max={max} suffix=" s" placeholder={`${timeInForce} (${f.codeTimeoutSeconds ? "its code" : "the default"})`} data-testid="own-time"
        description={`In force: ${timeTextOf(timeInForce)}${time ? " (its setting)" : f.codeTimeoutSeconds ? " (its code's)" : " (the default)"} · this server's longest: ${timeTextOf(max)}`}
        disabled={!editable} value={time ?? ""} onChange={(v) => set("time", typeof v === "number" && v > 0 ? Math.round(v) : null)} />
      {l && (
        <>
          <Text fw={600} size="sm" mt={4}>Instances</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {LIMITS.map((x) => {
              const v = valueOf(x.key) as number | null;
              return (
                <NumberInput key={x.key} label={x.label} suffix={x.suffix} min={x.key === "memoryMb" ? 64 : 0}
                  max={x.key === "memoryMb" ? page.data?.maxMemoryMb : page.data?.maxConcurrency} disabled={!editable} value={v ?? ""}
                  placeholder={`${l[x.key]}${x.suffix ?? ""} (${FROM[l.from[x.key]] ?? l.from[x.key]})`} data-testid={`limit-${x.key}`}
                  description={x.hint} onChange={(n) => set(x.key, number(n))} />
              );
            })}
          </SimpleGrid>
          <Select label="Process" w={320} disabled={!editable} data-testid="limit-isolate"
            description={`In force: ${l.isolate ? "its own" : "shared"} (${FROM[l.from.isolate] ?? l.from.isolate}). Its own: nothing it does can stop other functions' runs.`}
            data={[{ value: "", label: "As its code says" }, { value: "own", label: "Its own process" }, { value: "shared", label: "The shared process" }]}
            value={valueOf("isolate") === true ? "own" : valueOf("isolate") === false ? "shared" : ""}
            onChange={(v) => set("isolate", v === "own" ? true : v === "shared" ? false : null)} />
        </>
      )}
      {changed && (
        <Group align="flex-end">
          <TextInput label="Reason for the change" style={{ flex: "1 1 260px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save</Button>
          <Button variant="default" onClick={() => { setDraft({}); setReason(""); }}>Cancel</Button>
        </Group>
      )}
      {done && !changed && <Text size="xs" c="teal">Saved: it applies from the next run.</Text>}
      {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
      <Text size="xs" c="dimmed">Empty: as its code says, else the project's default. A long run still ends if the server restarts: long work should save its progress as it goes.</Text>
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
/** The Functions page's Change history: deploys (with roll back), then changes to the run-time settings. */
function FunctionsHistory() {
  return (
    <Stack gap="xl">
      <Stack gap="sm"><Text fw={600}>Deploys</Text><VersionsTimeline /></Stack>
      <Stack gap="sm"><Text fw={600}>Run-time settings</Text><AreaHistory area="functions" editable /></Stack>
    </Stack>
  );
}

function VersionsTimeline() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["function-versions"], queryFn: api.functionVersions });
  const [rolling, setRolling] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  const versions = list.data?.versions ?? [];
  if (versions.length === 0) return <Text size="sm" c="dimmed">No deploys yet: each one becomes a version here, and you can roll back to any of them.</Text>;
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
    <>
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
    </>
  );
}

const time = (seconds: number) => seconds % 60 === 0 ? `${seconds / 60} min` : seconds > 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
const timeTextOf = time;

/**
 * How long functions may run: the project's default, and each function's own time over what its code says, up to the
 * server's longest. Applied from the next run; each save is a version with its reason.
 */
function SettingsTab() {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const saved = useQuery({ queryKey: ["data-settings", "functions"], queryFn: () => api.dataSettings<FunctionsSettings>("functions") });
  const [draft, setDraft] = useState<{ time?: number; memory?: number; most?: number }>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (page.isLoading || saved.isLoading) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the settings: {errorMessage(saved.error)}</Alert>;
  const s = saved.data.settings;
  const max = page.data?.maxTimeoutSeconds ?? 540;
  const own = Object.entries(s.timeouts);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.saveDataSettings("functions", {
        ...s, defaultTimeoutSeconds: draft.time ?? s.defaultTimeoutSeconds, defaultMemoryMb: draft.memory ?? s.defaultMemoryMb ?? 256,
        defaultMaxInstances: draft.most ?? s.defaultMaxInstances ?? 10,
      }, reason.trim(), saved.data.version?.number ?? 0);
      setDraft({});
      setReason("");
      for (const key of ["data-settings", "functions"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <CardsPage intro="Saved changes apply from each function's next run." history={
      <HistoryButton subtitle="Functions: each deploy, and changes to their run times"><FunctionsHistory /></HistoryButton>
    }>
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
          value={draft.time ?? s.defaultTimeoutSeconds} onChange={(v) => setDraft({ ...draft, time: typeof v === "number" && v > 0 ? Math.round(v) : 60 })} />
        <div>
          <Text fw={600}>Instances</Text>
          <Text size="sm" c="dimmed">
            A function's instances (workers with its code loaded) unless it sets its own: the memory each may hold, and how
            many may run at once. This server allows {page.data?.maxMemoryMb ?? 1024} MB and {page.data?.maxConcurrency ?? 16} runs at once at most.
          </Text>
        </div>
        <Group gap="md" align="flex-start">
          <NumberInput label="Default memory" w={200} min={64} max={page.data?.maxMemoryMb} suffix=" MB" disabled={!saved.data.editable}
            value={draft.memory ?? s.defaultMemoryMb ?? 256} onChange={(v) => setDraft({ ...draft, memory: typeof v === "number" && v > 0 ? Math.round(v) : 256 })} />
          <NumberInput label="Default most at once" w={200} min={1} max={page.data?.maxConcurrency} disabled={!saved.data.editable}
            value={draft.most ?? s.defaultMaxInstances ?? 10} onChange={(v) => setDraft({ ...draft, most: typeof v === "number" && v > 0 ? Math.round(v) : 10 })} />
        </Group>
        {own.length > 0 && (
          <Text size="sm" c="dimmed" data-testid="own-times">
            With their own time: {own.map(([n, t], i) => <span key={n}>{i > 0 && ", "}<Code>{n}</Code> {time(t)}</span>)}
          </Text>
        )}
        {((draft.time !== undefined && draft.time !== s.defaultTimeoutSeconds) || (draft.memory !== undefined && draft.memory !== (s.defaultMemoryMb ?? 256))
          || (draft.most !== undefined && draft.most !== (s.defaultMaxInstances ?? 10))) && (
          <Group align="flex-end">
            <TextInput label="Reason for the change" style={{ flex: "1 1 300px" }} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save</Button>
            <Button variant="default" onClick={() => { setDraft({}); setReason(""); }}>Cancel</Button>
          </Group>
        )}
        {error && <Alert color="red" style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
      </Stack>
    </Paper>
    </CardsPage>
  );
}
