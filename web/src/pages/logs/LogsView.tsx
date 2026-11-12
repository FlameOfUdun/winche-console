import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Code, Group, Loader, Select, Stack, Switch, Table, Text, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { LogEntry, LogLevel, LogScope } from "../../api/logs";

const LEVELS: LogLevel[] = ["Trace", "Debug", "Information", "Warning", "Error", "Critical"];
const COLORS: Record<LogLevel, string> = {
  Trace: "gray", Debug: "gray", Information: "blue", Warning: "yellow", Error: "red", Critical: "grape",
};
const PAGE = 100;
const LIVE_MS = 3000;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "Winche.Database.Runtime.Listening.QueryListener" → "…Listening.QueryListener" for the table. */
function shortCategory(c: string): string {
  const parts = c.split(".");
  return parts.length <= 2 ? c : `…${parts.slice(-2).join(".")}`;
}

function time(at: string): string {
  const d = new Date(at);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The app's kept log entries for one scope: the Logs tab ("app"), or a library's Logs sub-tab ("database",
 * "storage"). Filters by level, source and text (error ids too), pages back, and polls for new entries in live mode.
 */
export function LogsView({ scope }: { scope: LogScope }) {
  const [level, setLevel] = useState<LogLevel | "">("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [live, setLive] = useState(false);
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [newer, setNewer] = useState<LogEntry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const filter = useMemo(() => ({ level, category, q }), [level, category, q]);
  const first = useQuery({
    queryKey: ["logs", scope, filter],
    queryFn: () => api.logs(scope, { ...filter, limit: PAGE }),
  });
  const categories = useQuery({ queryKey: ["log-categories", scope], queryFn: () => api.logCategories(scope) });

  // A new filter starts over.
  useEffect(() => {
    setOlder([]);
    setNewer([]);
    setExhausted(false);
  }, [scope, filter]);

  const entries = useMemo(
    () => [...newer, ...(first.data?.entries ?? []), ...older],
    [newer, first.data, older],
  );

  // Live: ask for anything newer than the newest shown.
  useEffect(() => {
    if (!live || !first.data) return;
    const tick = async () => {
      const newest = entries[0]?.id;
      const page = await api.logs(scope, { ...filter, after: newest ?? 0, limit: 200 }).catch(() => null);
      if (page && page.entries.length) setNewer((n) => [...[...page.entries].reverse(), ...n]);
    };
    const t = setInterval(tick, LIVE_MS);
    return () => clearInterval(t);
  }, [live, scope, filter, first.data, entries]);

  const loadOlder = async () => {
    const oldest = entries[entries.length - 1]?.id;
    if (oldest === undefined) return;
    setLoadingOlder(true);
    try {
      const page = await api.logs(scope, { ...filter, before: oldest, limit: PAGE });
      setOlder((o) => [...o, ...page.entries]);
      if (page.entries.length < PAGE) setExhausted(true);
    } finally {
      setLoadingOlder(false);
    }
  };

  const kept = first.data;
  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select label="Level" placeholder="Any" clearable w={150} data={LEVELS} value={level || null}
          onChange={(v) => setLevel((v as LogLevel) ?? "")} aria-label="Level" />
        <Select label="Source" placeholder="Any" clearable searchable w={320}
          data={categories.data ?? []} value={category || null} onChange={(v) => setCategory(v ?? "")} aria-label="Source" />
        <TextInput label="Search" placeholder="Text, user or error id" w={280} value={search}
          onChange={(e) => setSearch(e.currentTarget.value)} aria-label="Search" />
        <Switch label="Live" checked={live} onChange={(e) => setLive(e.currentTarget.checked)} mb={6} />
      </Group>
      {kept && (
        <Text size="xs" c="dimmed">
          Keeps {kept.minimumLevel} and above for {kept.retentionDays} days{scope === "app" ? "" : `, from ${scope === "database" ? "Winche.Database" : "Winche.Storage"}`}.
        </Text>
      )}

      {first.isLoading && <Loader size="sm" />}
      {first.isError && <Alert color="red">Couldn't load the logs: {String((first.error as Error).message)}</Alert>}
      {kept && entries.length === 0 && <Text c="dimmed">No entries{q || level || category ? " match" : " yet"}.</Text>}

      {entries.length > 0 && (
        <Table highlightOnHover striped verticalSpacing={4} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={150}>Time</Table.Th>
              <Table.Th w={110}>Level</Table.Th>
              <Table.Th w={220}>Source</Table.Th>
              <Table.Th>Message</Table.Th>
              <Table.Th w={140}>User</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((e) => (
              <Fragment key={e.id}>
                <Table.Tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === e.id ? null : e.id)} data-testid="log-row">
                  <Table.Td><Text size="xs" ff="monospace">{time(e.at)}</Text></Table.Td>
                  <Table.Td><Badge color={COLORS[e.level]} variant="light" size="sm">{e.level}</Badge></Table.Td>
                  <Table.Td title={e.category}><Text size="xs" ff="monospace">{shortCategory(e.category)}</Text></Table.Td>
                  <Table.Td><Text size="sm" lineClamp={open === e.id ? undefined : 1}>{e.message}{e.exception ? " ⚠" : ""}</Text></Table.Td>
                  <Table.Td><Text size="xs">{e.userId ?? ""}</Text></Table.Td>
                </Table.Tr>
                {open === e.id && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Stack gap={6} py={4}>
                        <Text size="xs" c="dimmed">{e.category} · event {e.eventId} · {e.instance} · {new Date(e.at).toISOString()}</Text>
                        {e.properties && Object.keys(e.properties).length > 0 && (
                          <Group gap={6}>
                            {Object.entries(e.properties).map(([k, v]) => (
                              <Badge key={k} variant="outline" color="gray" tt="none">{k}: {v ?? "null"}</Badge>
                            ))}
                          </Group>
                        )}
                        {e.exception && <Code block style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{e.exception}</Code>}
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {entries.length >= PAGE && !exhausted && (first.data?.entries.length ?? 0) >= PAGE && (
        <Button variant="subtle" onClick={loadOlder} loading={loadingOlder} w="fit-content">Older entries</Button>
      )}
    </Stack>
  );
}
