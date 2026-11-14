import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Autocomplete, Button, Group, Modal, Paper, Select, Stack, Text, Tooltip,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type { LogLevel, LogLevelOverride, LogScope } from "../../api/logs";

const LEVELS: LogLevel[] = ["Trace", "Debug", "Information", "Warning", "Error", "Critical"];
const DURATIONS: { value: string; label: string; minutes: number | null }[] = [
  { value: "15", label: "for 15 minutes", minutes: 15 },
  { value: "60", label: "for 1 hour", minutes: 60 },
  { value: "240", label: "for 4 hours", minutes: 240 },
  { value: "1440", label: "for 1 day", minutes: 1440 },
  { value: "none", label: "until removed", minutes: null },
];

/** The category prefix a sub-tab's overrides live under (the Logs tab shows them all). */
export const SCOPE_PREFIX: Record<LogScope, string> = { app: "", database: "Winche.Database", storage: "Winche.Storage" };

const inScope = (o: LogLevelOverride, prefix: string) => !prefix || o.category === prefix || o.category.startsWith(prefix + ".");

interface Row { category: string; level: LogLevel; until: string | null; duration: string | null }

function untilLabel(until: string | null): string {
  if (!until) return "until removed";
  return `until ${new Date(until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Which entries are kept: a default level and per-source overrides (optionally for a while), saved in the console and
 * applied on every instance of the app. A sub-tab shows the overrides under its library and adds new ones there.
 */
export function LogLevelsPanel({ scope, categories }: { scope: LogScope; categories: string[] }) {
  const qc = useQueryClient();
  const prefix = SCOPE_PREFIX[scope];
  const levels = useQuery({ queryKey: ["log-levels"], queryFn: api.logLevels });
  const [defaultLevel, setDefaultLevel] = useState<LogLevel>("Warning");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<Row | null>(null);   // the "Add a source" dialog

  useEffect(() => {
    if (!levels.data) return;
    setDefaultLevel(levels.data.defaultLevel);
    setRows(levels.data.overrides.filter((o) => inScope(o, prefix)).map((o) => ({ ...o, duration: null })));
  }, [levels.data, prefix]);

  if (levels.isLoading || !levels.data) return null;
  const data = levels.data;
  const outside = data.overrides.filter((o) => !inScope(o, prefix));

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const now = Date.now();
      const mine: LogLevelOverride[] = rows
        .filter((r) => r.category.trim())
        .map((r) => {
          const d = DURATIONS.find((x) => x.value === r.duration);
          const until = r.duration === null ? r.until : d?.minutes ? new Date(now + d.minutes * 60_000).toISOString() : null;
          return { category: r.category.trim(), level: r.level, until };
        });
      await api.saveLogLevels(defaultLevel, [...outside, ...mine]);
      await qc.invalidateQueries({ queryKey: ["log-levels"] });
      await qc.invalidateQueries({ queryKey: ["logs"] });
    } catch (e) {
      setError(e instanceof ApiError ? (safeErrors(e.message) ?? e.message) : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setError(null);
    await api.resetLogLevels();
    await qc.invalidateQueries({ queryKey: ["log-levels"] });
  };

  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          {data.source === "code"
            ? `Set in the app's code (default ${data.codeDefaultLevel}). Saving here applies on every instance until you reset.`
            : `Set in the console${data.updatedBy ? ` by ${data.updatedBy}` : ""}${data.updatedAt ? `, ${new Date(data.updatedAt).toLocaleString()}` : ""}. Applies on every instance within seconds.`}
        </Text>
        <Group gap="sm" align="flex-end">
          <Select label="Keep, by default" w={170} data={LEVELS} value={defaultLevel} allowDeselect={false}
            onChange={(v) => v && setDefaultLevel(v as LogLevel)} aria-label="Default level" />
          <Text size="xs" c="dimmed" mb={8}>and up{prefix ? " (for every source — the Logs tab shows the same setting)" : ""}</Text>
        </Group>

        <Text size="sm" fw={500} mt={4}>{prefix ? `Sources under ${prefix}` : "Per source"}</Text>
        {rows.length === 0 && <Text size="xs" c="dimmed">None — every source uses the default.</Text>}
        {rows.map((r, i) => (
          <Group key={i} gap="xs" align="flex-end" wrap="nowrap" data-testid="level-override">
            <Autocomplete placeholder={prefix ? `${prefix}.…` : "e.g. SmartAirway.Reports"} w={300} value={r.category}
              data={categories.filter((c) => !prefix || c.startsWith(prefix))} onChange={(v) => set(i, { category: v })}
              aria-label="Source" />
            <Select w={140} data={LEVELS} value={r.level} allowDeselect={false} onChange={(v) => v && set(i, { level: v as LogLevel })}
              aria-label="Source level" />
            <Select w={170} aria-label="For how long"
              data={r.duration === null ? [{ value: "keep", label: untilLabel(r.until) }, ...DURATIONS] : DURATIONS}
              value={r.duration ?? "keep"} allowDeselect={false}
              onChange={(v) => set(i, { duration: v === "keep" ? null : v })} />
            <Tooltip label="Remove"><ActionIcon variant="subtle" color="gray" aria-label="Remove override" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Tooltip>
          </Group>
        ))}
        <Group gap="xs">
          <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ category: prefix ? `${prefix}.` : "", level: "Debug", until: null, duration: "60" })}>
            Add a source
          </Button>
        </Group>
        <Modal opened={!!adding} onClose={() => setAdding(null)} title={<Text fw={700} fz={18}>Log a source differently</Text>} radius="lg">
          {adding && (
            <Stack gap="md">
              <Autocomplete label="Source" placeholder={prefix ? `${prefix}.…` : "e.g. SmartAirway.Reports"} data-autofocus value={adding.category}
                data={categories.filter((c) => !prefix || c.startsWith(prefix))} onChange={(v) => setAdding({ ...adding, category: v })} />
              <Select label="Keep" data={LEVELS} value={adding.level} allowDeselect={false} onChange={(v) => v && setAdding({ ...adding, level: v as LogLevel })} />
              <Select label="For how long" data={DURATIONS} value={adding.duration ?? "60"} allowDeselect={false} onChange={(v) => setAdding({ ...adding, duration: v })} />
              <Group justify="flex-end" gap="xs">
                <Button variant="default" onClick={() => setAdding(null)}>Cancel</Button>
                <Button disabled={!adding.category.trim() || adding.category.trim().endsWith(".")} onClick={() => { setRows((r) => [...r, adding]); setAdding(null); }}>Add</Button>
              </Group>
            </Stack>
          )}
        </Modal>

        {error && <Alert color="red" py={6}>{error}</Alert>}
        <Group gap="xs">
          <Button size="xs" onClick={save} loading={saving}>Save</Button>
          {data.source === "console" && <Button size="xs" variant="default" onClick={reset}>Reset to the app's settings</Button>}
        </Group>
      </Stack>
    </Paper>
  );
}

function safeErrors(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { errors?: string[] };
    return parsed.errors?.join(" ") ?? null;
  } catch {
    return null;
  }
}
