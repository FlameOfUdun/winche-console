import { useState } from "react";
import { Alert, Badge, Button, Code, Group, Loader, Paper, Stack, Table, Tabs, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { FunctionInfo, FunctionRun } from "../../api/functions";
import { when } from "../authentication/UsersView";

/**
 * Functions: TypeScript run on the server when data changes, on a schedule, or when apps call them. The code lives in
 * the app's repository and is deployed with the CLI; here: what's live, running a callable, versions and rollback.
 */
export function FunctionsPage() {
  const [tab, setTab] = useState<string | null>("deployed");
  return (
    <Stack gap="sm">
      <div>
        <Title order={3}>Functions</Title>
        <Text size="sm" c="dimmed">Your own TypeScript, run on this server: when documents, files or users change, on a schedule, or called by apps.</Text>
      </div>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="deployed">Deployed</Tabs.Tab>
          <Tabs.Tab value="versions">Versions</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="deployed"><DeployedTab /></Tabs.Panel>
        <Tabs.Panel value="versions"><VersionsTab /></Tabs.Panel>
      </Tabs>
    </Stack>
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

/** Functions are written in the app's repository and deployed from the terminal or CI, like Firebase's. */
function HowToDeploy() {
  return (
    <Paper withBorder p="sm" maw={820}>
      <Stack gap="xs">
        <Text fw={600}>Write and deploy them from your editor</Text>
        <Code block>{`winche functions init        # a functions/ folder: index.ts, deno.json, types for VS Code
winche emulators start       # run them locally; saving reloads them
winche login                 # once: sign in to this console in your browser
winche functions deploy -m "what changed"`}</Code>
        <Text size="xs" c="dimmed">
          In CI, set <Code>WINCHE_TOKEN</Code> to a CI token with the functions scope (Access → CI tokens). Each deploy is a
          new version, named after who deployed it.
        </Text>
      </Stack>
    </Paper>
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
