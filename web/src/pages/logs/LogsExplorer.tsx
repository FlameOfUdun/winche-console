import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Anchor, Badge, Button, Code, Group, Loader, Paper, SegmentedControl, Select, Stack, Switch, Table, Text, TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { FieldFilter, FilterField, LogEntry, LogFilter, LogLevel, LogResource, LogScope } from "../../api/logs";
import { useSession } from "../../auth/session";
import { Histogram } from "./Histogram";
import { LogLevelsPanel } from "./LogLevelsPanel";
import { RANGES, queryText, rangeFrom, toSpec, withFilter, type ExplorerState, type RangeKey } from "./explorerQuery";

const PAGE = 100;
const LIVE_MS = 3000;
const SEVERITY: Record<LogLevel, { label: string; color: string }> = {
  Trace: { label: "Debug", color: "gray" }, Debug: { label: "Debug", color: "gray" }, Information: { label: "Info", color: "blue" },
  Warning: { label: "Warning", color: "yellow" }, Error: { label: "Error", color: "red" }, Critical: { label: "Critical", color: "grape" },
};
const RESOURCES: { value: LogResource | ""; label: string }[] = [
  { value: "", label: "All resources" }, { value: "database", label: "Database" }, { value: "storage", label: "Storage" },
  { value: "app", label: "App" }, { value: "console", label: "Console" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function time(at: string): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The entry's fields shown when it's opened; the filterable ones get Show / Hide matching. */
export function entryFields(e: LogEntry): { label: string; field?: FilterField; value: string }[] {
  const rows: { label: string; field?: FilterField; value: string | null | undefined }[] = [
    { label: "resource", field: "resource", value: e.resource },
    { label: "operation", field: "operation", value: e.operation },
    { label: "principal", field: "principal", value: e.principal },
    { label: "path", field: "path", value: e.path },
    { label: "outcome", field: "outcome", value: e.outcome },
    { label: "latency", value: e.latencyMs === null ? null : `${e.latencyMs.toLocaleString()} ms` },
    { label: "category", field: "category", value: e.category },
    { label: "instance", field: "instance", value: e.instance },
  ];
  return rows.filter((r): r is { label: string; field?: FilterField; value: string } => !!r.value);
}

const STRUCTURED = new Set(["Operation", "Path", "Principal", "Outcome", "LatencyMs", "{OriginalFormat}"]);

/** What's left of the entry once its fields are shown: other properties and the exception. */
export function payload(e: LogEntry): string | null {
  const props = Object.fromEntries(Object.entries(e.properties ?? {}).filter(([k]) => !STRUCTURED.has(k)));
  const out: Record<string, unknown> = { ...props };
  if (e.eventId) out.eventId = e.eventId;
  if (e.exception) out.exception = e.exception;
  return Object.keys(out).length ? JSON.stringify(out, null, 2) : null;
}

/**
 * The Logs Explorer: structured entries (who did what to which path, with what outcome) from Winche and the app,
 * filtered by resource, severity, field and text, over a time range with a histogram; live tail; save the query.
 * scope "app" is the Logs tab (everything); "database" / "storage" are a library's Logs sub-tab.
 */
export function LogsExplorer({ scope, state, onChange, onSaved }: {
  scope: LogScope;
  state: ExplorerState;
  onChange: (s: ExplorerState) => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { state: session } = useSession();
  const [search, setSearch] = useState(state.q);
  useEffect(() => setSearch(state.q), [state.q]);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => {
    if (q !== state.q.trim()) onChange({ ...state, q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [live, setLive] = useState(false);
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [newer, setNewer] = useState<LogEntry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [showLevels, setShowLevels] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const filter: LogFilter = useMemo(
    () => ({ resource: state.resource, level: state.level, filters: state.filters, q: state.q.trim() }),
    [state.resource, state.level, state.filters, state.q],
  );
  const key = [scope, filter, state.range];

  const first = useQuery({
    queryKey: ["logs", ...key],
    queryFn: () => api.logs(scope, { ...filter, from: rangeFrom(state.range), limit: PAGE }),
  });
  const histogram = useQuery({
    queryKey: ["log-histogram", ...key],
    queryFn: () => api.logHistogram(scope, { ...filter, from: rangeFrom(state.range), buckets: 60 }),
    refetchInterval: live ? LIVE_MS : false,
  });
  const categories = useQuery({ queryKey: ["log-categories", scope], queryFn: () => api.logCategories(scope) });

  useEffect(() => {
    setOlder([]);
    setNewer([]);
    setExhausted(false);
    setOpen(null);
  }, [scope, filter, state.range]);

  const entries = useMemo(() => [...newer, ...(first.data?.entries ?? []), ...older], [newer, first.data, older]);

  useEffect(() => {
    if (!live || !first.data) return;
    const tick = async () => {
      const newest = entries[0]?.id ?? 0;
      const page = await api.logs(scope, { ...filter, after: newest, limit: 200 }).catch(() => null);
      if (page && page.entries.length) setNewer((n) => [...[...page.entries].reverse(), ...n]);
    };
    const t = setInterval(tick, LIVE_MS);
    return () => clearInterval(t);
  }, [live, first.data, entries, scope, filter]);

  const loadOlder = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    const page = await api.logs(scope, { ...filter, from: rangeFrom(state.range), before: last.id, limit: PAGE });
    setOlder((o) => [...o, ...page.entries]);
    if (page.entries.length < PAGE) setExhausted(true);
  };

  const match = (f: FieldFilter) => onChange(withFilter(state, f));
  const removeFilter = (i: number) => onChange({ ...state, filters: state.filters.filter((_, j) => j !== i) });

  const save = async () => {
    if (!saving?.trim()) return;
    try {
      await api.saveLogQuery(saving.trim(), toSpec(state));
      setSaving(null);
      setSaveError(null);
      await qc.invalidateQueries({ queryKey: ["log-queries"] });
      onSaved?.();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  const errors = entries.filter((e) => e.level === "Error" || e.level === "Critical").length;
  const warnings = entries.filter((e) => e.level === "Warning").length;
  const rangeLabel = RANGES.find((r) => r.value === state.range)?.label ?? "";
  const hasHistory = !!session?.capabilities?.history;

  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="wrap" align="flex-end">
        <TextInput placeholder="Search entries (text, user, path, error id)" w={320} aria-label="Search entries"
          value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        {scope === "app" && (
          <Select aria-label="Resource" w={160} data={RESOURCES} value={state.resource} allowDeselect={false}
            onChange={(v) => onChange({ ...state, resource: (v ?? "") as LogResource | "" })} />
        )}
        <Select aria-label="Time range" w={170} data={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={state.range}
          allowDeselect={false} onChange={(v) => onChange({ ...state, range: (v ?? "1h") as RangeKey })} />
        <SegmentedControl size="xs" value={state.level || "all"} aria-label="Severity"
          onChange={(v) => onChange({ ...state, level: v === "all" ? "" : (v as LogLevel) })}
          data={[{ value: "all", label: "All" }, { value: "Information", label: "Info+" }, { value: "Warning", label: "Warning+" }, { value: "Error", label: "Error+" }]} />
        <Switch label="Live" checked={live} onChange={(e) => setLive(e.currentTarget.checked)} mb={6} />
        <Button variant={showLevels ? "light" : "subtle"} size="xs" mb={4} onClick={() => setShowLevels((v) => !v)}>Levels</Button>
      </Group>

      {showLevels && <LogLevelsPanel scope={scope} categories={categories.data ?? []} />}

      {state.filters.length > 0 && (
        <Group gap={6}>
          <Text size="xs" c="dimmed">Filters</Text>
          {state.filters.map((f, i) => (
            <Badge key={`${f.field}${f.value}${i}`} variant="light" color={f.not ? "gray" : "blue"} tt="none" pr={2}
              rightSection={<ActionIcon size="xs" variant="transparent" aria-label={`Remove ${f.field} filter`} onClick={() => removeFilter(i)}><IconX size={12} /></ActionIcon>}>
              {f.field} {f.not ? "≠" : "="} {f.value}
            </Badge>
          ))}
          <Anchor size="xs" component="button" onClick={() => onChange({ ...state, filters: [] })}>Clear all</Anchor>
        </Group>
      )}

      <Paper withBorder p="xs">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed">Query</Text>
            <Code data-testid="query-text" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{queryText(state)}</Code>
          </Group>
          {saving === null ? (
            <Button size="xs" variant="subtle" onClick={() => setSaving("")}>Save this query</Button>
          ) : (
            <Group gap={6} wrap="nowrap">
              <TextInput size="xs" placeholder="Name" aria-label="Query name" value={saving} autoFocus error={saveError}
                onChange={(e) => setSaving(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
              <Button size="xs" onClick={save} disabled={!saving.trim()}>Save</Button>
              <Button size="xs" variant="subtle" onClick={() => { setSaving(null); setSaveError(null); }}>Cancel</Button>
            </Group>
          )}
        </Group>
      </Paper>

      {histogram.data && <Histogram data={histogram.data} title={`${rangeLabel} · ${histogram.data.total.toLocaleString()} entries`} />}
      {live && <Text size="xs" c="teal">Streaming new entries as they arrive…</Text>}

      {first.isLoading && <Loader size="sm" />}
      {first.isError && <Alert color="red">Couldn't load the logs: {String((first.error as Error).message)}</Alert>}
      {first.data && entries.length === 0 && (
        <Text c="dimmed" size="sm">No entries match. Remove a filter or widen the time range.</Text>
      )}

      {entries.length > 0 && (
        <>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{plural(entries.length, "entry", "entries")} · {plural(errors, "error")} · {plural(warnings, "warning")} · newest first</Text>
            <Text size="xs" c="dimmed">Click an entry for details</Text>
          </Group>
          <Table highlightOnHover verticalSpacing={4} fz="sm">
            <Table.Tbody>
              {entries.map((e) => {
                const sev = SEVERITY[e.level];
                const isOpen = open === e.id;
                const extra = isOpen ? payload(e) : null;
                const docPath = e.resource === "database" && e.path && !e.path.includes(" ") && e.path.split("/").length % 2 === 0 ? e.path : null;
                return (
                  <Fragment key={e.id}>
                    <Table.Tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : e.id)} data-testid="log-row">
                      <Table.Td w={150}><Text size="xs" ff="monospace">{time(e.at)}</Text></Table.Td>
                      <Table.Td w={90}><Badge size="sm" color={sev.color} variant="light">{sev.label}</Badge></Table.Td>
                      <Table.Td w={90}><Text size="xs" c="dimmed">{e.resource}</Text></Table.Td>
                      <Table.Td><Text size="sm" lineClamp={isOpen ? undefined : 1}>{e.message}</Text></Table.Td>
                      <Table.Td w={160}><Text size="xs" c="dimmed" truncate>{e.principal ?? ""}</Text></Table.Td>
                    </Table.Tr>
                    {isOpen && (
                      <Table.Tr>
                        <Table.Td colSpan={5} style={{ background: "var(--mantine-color-gray-0)" }}>
                          <Table fz="xs" withRowBorders={false} verticalSpacing={2}>
                            <Table.Tbody>
                              {entryFields(e).map((f) => (
                                <Table.Tr key={f.label}>
                                  <Table.Td w={110}><Text size="xs" c="dimmed">{f.label}</Text></Table.Td>
                                  <Table.Td><Text size="xs" ff="monospace">{f.value}</Text></Table.Td>
                                  <Table.Td w={220}>
                                    {f.field && (
                                      <Group gap="sm">
                                        <Anchor size="xs" component="button" onClick={() => match({ field: f.field!, value: f.value })}>Show matching</Anchor>
                                        <Anchor size="xs" component="button" onClick={() => match({ field: f.field!, value: f.value, not: true })}>Hide matching</Anchor>
                                      </Group>
                                    )}
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                          {extra && (
                            <>
                              <Text size="xs" c="dimmed" mt={6}>Payload</Text>
                              <Code block fz="xs">{extra}</Code>
                            </>
                          )}
                          {docPath && hasHistory && (
                            <Anchor size="xs" component={Link} to={`/database/history?path=${encodeURIComponent(docPath)}`} mt={6} display="inline-block">
                              Open this document's history →
                            </Anchor>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
          {(first.data?.entries.length ?? 0) >= PAGE && !exhausted && (
            <Button variant="subtle" onClick={loadOlder} w="fit-content">Older entries</Button>
          )}
        </>
      )}
    </Stack>
  );
}
