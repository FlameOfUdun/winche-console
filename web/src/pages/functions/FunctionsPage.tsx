import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Code, Group, Loader, NavLink, Paper, Stack, Table, Tabs, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import { STARTER, type FunctionInfo, type FunctionRun } from "../../api/functions";
import { when } from "../authentication/UsersView";
import { CodeEditor } from "./CodeEditor";

/** Functions: JavaScript/TypeScript run on the server when data changes, on a schedule, or when apps call them. */
export function FunctionsPage() {
  const [tab, setTab] = useState<string | null>("code");
  return (
    <Stack gap="sm">
      <div>
        <Title order={3}>Functions</Title>
        <Text size="sm" c="dimmed">Your own TypeScript, run on this server: when documents, files or users change, on a schedule, or called by apps.</Text>
      </div>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="code">Code</Tabs.Tab>
          <Tabs.Tab value="versions">Versions</Tabs.Tab>
          <Tabs.Tab value="vscode">VS Code</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="code"><CodeTab /></Tabs.Panel>
        <Tabs.Panel value="versions"><VersionsTab /></Tabs.Panel>
        <Tabs.Panel value="vscode"><VsCodeTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function CodeTab() {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [open, setOpen] = useState("index.ts");
  const [newFile, setNewFile] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deployed = page.data?.current ? page.data.files : null;

  useEffect(() => {
    if (page.data) setFiles({ ...(page.data.current ? page.data.files : STARTER) });
  }, [page.data]);
  const dirty = useMemo(() => !!files && JSON.stringify(files) !== JSON.stringify(deployed ?? {}), [files, deployed]);

  if (page.isLoading || (page.data && !files)) return <Loader size="sm" />;
  if (page.isError || !page.data || !files) return <Alert color="red">Couldn't load the functions: {errorMessage(page.error)}</Alert>;
  const d = page.data;
  const names = Object.keys(files).sort((a, b) => (a === "index.ts" ? -1 : b === "index.ts" ? 1 : a.localeCompare(b)));

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.deployFunctions(files, note.trim());
      setNote("");
      setNotice(`Version ${v.version} is live: ${v.functions.length ? v.functions.map((f) => f.name).join(", ") : "no functions exported"}.`);
      await qc.invalidateQueries({ queryKey: ["functions"] });
      await qc.invalidateQueries({ queryKey: ["function-versions"] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md">
      {d.runtimeProblem && <Alert color="red" title="Functions can't run on this server">{d.runtimeProblem}</Alert>}
      <Group align="flex-start" gap="md" wrap="nowrap">
        <Stack gap={2} w={200} style={{ flexShrink: 0 }}>
          {names.map((n) => (
            <NavLink key={n} label={<Text size="sm" ff="monospace">{n}</Text>} active={n === open} onClick={() => setOpen(n)}
              rightSection={n !== "index.ts" && (
                <Text size="xs" c="red" style={{ cursor: "pointer" }} aria-label={`Remove ${n}`}
                  onClick={(e) => { e.stopPropagation(); const { [n]: _, ...rest } = files; setFiles(rest); if (open === n) setOpen("index.ts"); }}>✕</Text>
              )} />
          ))}
          <Group gap={4} mt={6} wrap="nowrap">
            <TextInput size="xs" placeholder="lib/helpers.ts" aria-label="New file" value={newFile} onChange={(e) => setNewFile(e.currentTarget.value.trim())} />
            <Button size="xs" variant="default" disabled={!newFile || newFile in files || !/^[\w.\-/]+\.(ts|js|json)$/.test(newFile)}
              onClick={() => { setFiles({ ...files, [newFile]: "" }); setOpen(newFile); setNewFile(""); }}>Add</Button>
          </Group>
        </Stack>
        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <CodeEditor label={`Code of ${open}`} value={files[open] ?? ""} onChange={(v) => setFiles((f) => ({ ...(f ?? {}), [open]: v }))} />
          <Text size="xs" c="dimmed">Import with <Code>@winche/functions</Code>, relative files, <Code>npm:</Code> or <Code>jsr:</Code>. Functions are the exports made with its helpers.</Text>
        </Stack>
      </Group>
      {(dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="deploy-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-wrap", fontFamily: error.includes("\n") ? "var(--mantine-font-family-monospace)" : undefined }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="What changed?" aria-label="What changed" style={{ flex: "1 1 280px" }} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
                <Button loading={busy} disabled={!note.trim() || !!d.runtimeProblem} onClick={deploy}>Deploy</Button>
                <Button variant="subtle" disabled={busy} onClick={() => { setFiles({ ...(deployed ?? STARTER) }); setError(null); }}>Discard</Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}
      <Deployed functions={d.current?.functions ?? []} version={d.current?.version ?? null} />
    </Stack>
  );
}

function Deployed({ functions, version }: { functions: FunctionInfo[]; version: number | null }) {
  const [running, setRunning] = useState<string | null>(null);
  if (version === null) return <Text size="sm" c="dimmed">Nothing deployed yet.</Text>;
  return (
    <Stack gap="xs">
      <Text fw={600}>Live: version {version}</Text>
      {functions.length === 0 && <Text size="sm" c="dimmed">No functions exported.</Text>}
      {functions.map((f) => (
        <Paper key={f.name} withBorder p="sm" data-testid="function">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Group gap={6}><Text fw={600} ff="monospace">{f.name}</Text><Badge variant="light" tt="none">{f.kind}</Badge></Group>
              <Text size="xs" c="dimmed">{f.description} · up to {f.timeoutSeconds} s</Text>
            </div>
            {f.kind === "callable" && <Button size="xs" variant="default" onClick={() => setRunning(running === f.name ? null : f.name)}>Run</Button>}
          </Group>
          {running === f.name && <RunPanel name={f.name} />}
        </Paper>
      ))}
      <Text size="xs" c="dimmed">Triggered runs show under Hooks → Deliveries (hook fn.name); everything they log is in Logs → Functions.</Text>
    </Stack>
  );
}

function RunPanel({ name }: { name: string }) {
  const [data, setData] = useState("{}");
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
  const [viewing, setViewing] = useState<number | null>(null);
  const version = useQuery({ queryKey: ["function-version", viewing], queryFn: () => api.functionVersion(viewing!), enabled: viewing !== null });
  const [error, setError] = useState<string | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  const versions = list.data?.versions ?? [];
  if (versions.length === 0) return <Text size="sm" c="dimmed">Nothing deployed yet.</Text>;
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
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    {i === 0 ? <Badge color="teal" variant="light" tt="none">Live</Badge> : <Button size="xs" variant="default" onClick={() => rollBack(v.version)}>Roll back</Button>}
                    <Button size="xs" variant="subtle" onClick={() => setViewing(viewing === v.version ? null : v.version)}>Code</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      {viewing !== null && version.data && Object.entries(version.data.files).map(([name, text]) => (
        <Stack key={name} gap={2}>
          <Text size="sm" ff="monospace">{name}</Text>
          <CodeEditor label={`v${viewing} ${name}`} value={text} readOnly />
        </Stack>
      ))}
    </Stack>
  );
}

function VsCodeTab() {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    if (page.data?.deployKey && !window.confirm("Make a new deploy key? The old one stops working.")) return;
    setError(null);
    try { setKey((await api.newDeployKey()).key); await qc.invalidateQueries({ queryKey: ["functions"] }); }
    catch (e) { setError(errorMessage(e)); }
  };
  const server = window.location.origin;
  return (
    <Stack gap="sm" maw={820}>
      <Text size="sm">Write functions in VS Code with types and completion, try them on the emulator, and deploy from the terminal:</Text>
      <Code block>{`winche functions init            # a functions/ folder: index.ts, deno.json, types
winche emulators start           # runs them locally; saving redeploys
winche functions deploy --url ${server} --key <deploy key>`}</Code>
      <Paper withBorder p="sm">
        <Stack gap="xs">
          <Text fw={600}>Deploy key</Text>
          <Text size="sm" c="dimmed">
            {page.data?.deployKey ? `Made ${when(page.data.deployKey.setAt)}${page.data.deployKey.setBy ? ` by ${page.data.deployKey.setBy}` : ""}. It's shown only once.` : "None yet."}
          </Text>
          {key && <Alert color="teal" title="Copy it now: it won't be shown again"><Code data-testid="deploy-key">{key}</Code></Alert>}
          {error && <Alert color="red">{error}</Alert>}
          <Button size="xs" variant="default" w="fit-content" disabled={!page.data?.secretsAvailable} onClick={make}>{page.data?.deployKey ? "Make a new key" : "Make a deploy key"}</Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
