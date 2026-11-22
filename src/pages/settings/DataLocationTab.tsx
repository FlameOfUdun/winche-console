import { useEffect, useState } from "react";
import { FieldRow } from "../../components/FieldRow";
import {
  Alert, Badge, Button, Group, Loader, Modal, NumberInput, Paper, PasswordInput, Progress, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title,
} from "@mantine/core";
import { IconArrowsExchange, IconDatabase, IconServer } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { DataLocationInfo, DataMoveCheck, MoveProgress } from "../../api/dataLocation";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";

const mono = { input: { fontFamily: "var(--mantine-font-family-monospace)" } };

function size(bytes: number | null) {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** The move's progress from a paused project's 503 answer, if that's what it was. */
function progressOf(e: unknown): MoveProgress | null {
  if (!(e instanceof ApiError) || e.status !== 503) return null;
  try { return (JSON.parse(e.message) as { move?: MoveProgress }).move ?? null; } catch { return null; }
}

const STAGES: Record<string, string> = {
  preparing: "Setting up the new database", paused: "Paused: copying", copying: "Copying tables", checking: "Counting rows on both sides", switching: "Switching over",
};

/** Project settings → Data (server admins): where this project's data is kept, moving it, and its connections. */
export function DataLocationTab() {
  const qc = useQueryClient();
  const [moving, setMoving] = useState<MoveProgress | "starting" | null>(null);
  const info = useQuery({ queryKey: ["data-location"], queryFn: api.dataLocation, enabled: moving === null });
  const [open, setOpen] = useState(false);

  // While a move runs the project is paused: follow its progress until it answers again.
  useEffect(() => {
    if (moving === null) return;
    let stop = false;
    const poll = async () => {
      try {
        const next = await api.dataLocation();
        if (stop) return;
        if (moving === "starting" && !next.previous && !next.lastMoveFailed) { setTimeout(poll, 700); return; }   // not paused yet
        qc.setQueryData(["data-location"], next);
        setMoving(null);
      } catch (e) {
        if (stop) return;
        const p = progressOf(e);
        if (p) setMoving(p);
        setTimeout(poll, 700);
      }
    };
    const t = setTimeout(poll, 500);
    return () => { stop = true; clearTimeout(t); };
  }, [moving === null]);

  if (moving !== null) return <MovingView progress={moving === "starting" ? null : moving} />;
  if (info.isLoading) return <Loader size="sm" />;
  if (info.isError || !info.data) return <Alert color="red">Couldn't read where the data is: {errorMessage(info.error)}</Alert>;
  const d = info.data;

  return (
    <Stack gap="md">
      {d.lastMoveFailed && (
        <Alert color="red" title="The last move didn't happen">
          {d.lastMoveFailed.error} The project carried on where it was ({when(d.lastMoveFailed.at)}).
        </Alert>
      )}
      {d.previous && <FinishMove info={d} />}

      <Paper withBorder radius="md" p="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--w-accent-soft)", color: "var(--w-accent)" }}>
              <IconDatabase size={21} stroke={1.8} />
            </div>
            <div>
              <Title order={4}>Where data is kept</Title>
              <Text size="sm" c={surface.muted}>Documents, files' records, app users, hook deliveries and logs: one database for the project.</Text>
            </div>
          </Group>
          <Button leftSection={<IconArrowsExchange size={16} />} variant="default" onClick={() => setOpen(true)} disabled={!!d.previous}>Move…</Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }} mt="md" spacing="md">
          <Fact label="Server" value={d.host ? `${d.host}:${d.port ?? 5432}` : "This server's PostgreSQL"} />
          <Fact label="Database" value={d.database} mono />
          <Fact label="Size" value={size(d.sizeBytes)} />
          {d.host && <Fact label="User" value={d.username ?? "—"} mono />}
          {d.host && <Fact label="SSL" value={d.sslMode ?? "Prefer"} />}
          <Fact label="PostgreSQL" value={d.version ?? "—"} />
        </SimpleGrid>
      </Paper>

      <PoolCard info={d} />
      <MoveDialog opened={open} onClose={() => setOpen(false)} info={d} onStarted={() => { setOpen(false); setMoving("starting"); }} />
    </Stack>
  );
}

function Fact({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Text size="xs" c={surface.faint} tt="uppercase" fw={600} lts={0.4}>{label}</Text>
      <Text size="sm" ff={isMono ? "monospace" : undefined} style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </div>
  );
}

function MovingView({ progress }: { progress: MoveProgress | null }) {
  const pct = progress && progress.tablesTotal > 0 ? Math.round(progress.tablesDone / progress.tablesTotal * 100) : null;
  return (
    <Paper withBorder radius="md" p="lg" data-testid="data-moving">
      <Stack gap="sm">
        <Group gap="sm"><Loader size="sm" /><Title order={4}>Moving the data</Title></Group>
        <Text size="sm">{progress ? STAGES[progress.stage] ?? progress.stage : "Getting ready…"}{progress?.table ? `: ${progress.table}` : ""}</Text>
        {pct !== null && <Progress value={pct} animated />}
        {progress && progress.tablesTotal > 0 && <Text size="xs" c={surface.muted}>{progress.tablesDone} of {progress.tablesTotal} tables</Text>}
        <Text size="xs" c={surface.muted}>The project is paused while it copies: its apps are told to try again in a moment.</Text>
      </Stack>
    </Paper>
  );
}

function FinishMove({ info }: { info: DataLocationInfo }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"delete" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = info.previous!;
  const finish = async (deleteOld: boolean) => {
    setBusy(deleteOld ? "delete" : "keep"); setError(null);
    try { await api.finishDataMove(deleteOld); await qc.invalidateQueries({ queryKey: ["data-location"] }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <Alert color="teal" title={`Moved ${when(p.movedAt)}`} data-testid="finish-move">
      <Stack gap="xs">
        <Text size="sm">
          The project runs on the new database. The old copy is still at <Text span ff="monospace" fz="sm">{p.database}</Text>{p.host ? ` on ${p.host}` : ""} until you finish.
        </Text>
        <Group gap="xs">
          <Button size="xs" color="red" variant="light" loading={busy === "delete"} disabled={busy !== null} onClick={() => finish(true)}>Delete the old copy</Button>
          <Button size="xs" variant="default" loading={busy === "keep"} disabled={busy !== null} onClick={() => finish(false)}>Keep it, I'll deal with it</Button>
        </Group>
        {error && <Text size="sm" c="red">{error}</Text>}
      </Stack>
    </Alert>
  );
}

function MoveDialog({ opened, onClose, info, onStarted }: { opened: boolean; onClose: () => void; info: DataLocationInfo; onStarted: () => void }) {
  const [elsewhere, setElsewhere] = useState(false);
  const [t, setT] = useState({ database: "", host: "", port: 5432, username: "", password: "", sslMode: "Require" });
  const [check, setCheck] = useState<DataMoveCheck | null>(null);
  const [busy, setBusy] = useState<"check" | "move" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (opened) { setT((x) => ({ ...x, database: info.database })); setCheck(null); setError(null); }
  }, [opened]);
  const set = (patch: Partial<typeof t>) => { setT({ ...t, ...patch }); setCheck(null); };
  const target = () => elsewhere
    ? { database: t.database.trim(), host: t.host.trim(), port: t.port, username: t.username.trim() || null, password: t.password || null, sslMode: t.sslMode }
    : { database: t.database.trim() };
  const run = async (kind: "check" | "move") => {
    setBusy(kind); setError(null);
    try {
      if (kind === "check") setCheck(await api.checkDataTarget(target()));
      else { await api.moveData(target()); onStarted(); }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" title={<Text fw={700} fz={18}>Move the data</Text>}>
      <Stack gap="md">
        <Switch label="To another PostgreSQL server" checked={elsewhere} onChange={(e) => { setElsewhere(e.currentTarget.checked); setCheck(null); }} />
        {elsewhere && (
          <>
            <FieldRow>
              <TextInput label="Host" styles={mono} value={t.host} onChange={(e) => set({ host: e.currentTarget.value })} />
              <NumberInput label="Port" styles={mono} min={1} max={65535} value={t.port} onChange={(v) => set({ port: Number(v) || 5432 })} />
            </FieldRow>
            <FieldRow>
              <TextInput label="User" styles={mono} value={t.username} onChange={(e) => set({ username: e.currentTarget.value })} />
              <PasswordInput label="Password" value={t.password} onChange={(e) => set({ password: e.currentTarget.value })} />
              <Select label="SSL" allowDeselect={false} data={["Disable", "Prefer", "Require", "VerifyFull"]} value={t.sslMode} onChange={(v) => v && set({ sslMode: v })} />
            </FieldRow>
          </>
        )}
        <TextInput label="Database" description="New, or an empty one." styles={mono} value={t.database} onChange={(e) => set({ database: e.currentTarget.value })} />
        {check && (check.ok
          ? <Alert color="teal" p="sm" data-testid="move-check">Ready{check.version ? `: PostgreSQL ${check.version}` : ""}. {check.exists ? "The database is there and empty." : "The database will be created."} About {check.rowsToCopy.toLocaleString()} {check.rowsToCopy === 1 ? "row" : "rows"} to copy.</Alert>
          : <Alert color="red" p="sm" data-testid="move-check">{check.problem}</Alert>)}
        {error && <Alert color="red" p="sm">{error}</Alert>}
        <Text size="xs" c={surface.muted}>
          The project pauses while its tables are copied and counted (its apps are told to try again), then carries on in the new database. The old one stays until you finish the move.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button variant="default" loading={busy === "check"} disabled={!t.database.trim() || (elsewhere && !t.host.trim())} onClick={() => run("check")}>Check</Button>
          <Button leftSection={<IconServer size={16} />} loading={busy === "move"} disabled={!check?.ok || busy !== null} onClick={() => run("move")}>Move now</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function PoolCard({ info }: { info: DataLocationInfo }) {
  const qc = useQueryClient();
  const [max, setMax] = useState<number | "">(info.maxConnections ?? "");
  const [timeout, setTimeoutValue] = useState<number | "">(info.commandTimeoutSeconds ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = (max === "" ? null : max) !== info.maxConnections || (timeout === "" ? null : timeout) !== info.commandTimeoutSeconds;
  const save = async () => {
    setBusy(true); setNote(null);
    try {
      await api.setDataPool(max === "" ? null : max, timeout === "" ? null : timeout);
      await qc.invalidateQueries({ queryKey: ["data-location"] });
      setNote({ ok: true, text: "Saved: the project restarted with them." });
    } catch (e) { setNote({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <Paper withBorder radius="md" p="lg">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Connections</Title>
        <Badge variant="light" color="gray" tt="none">per server running this project</Badge>
      </Group>
      <Group align="flex-end" wrap="wrap">
        <NumberInput label="At most" placeholder="100" suffix=" connections" min={2} max={500} w={200} value={max} onChange={(v) => setMax(v === "" ? "" : Number(v))} />
        <NumberInput label="Commands time out after" placeholder="30" suffix=" s" min={1} max={3600} w={200} value={timeout} onChange={(v) => setTimeoutValue(v === "" ? "" : Number(v))} />
        <Button onClick={save} loading={busy} disabled={!dirty}>Save</Button>
      </Group>
      {note && <Text size="sm" mt="xs" c={note.ok ? "teal" : "red"}>{note.text}</Text>}
    </Paper>
  );
}
