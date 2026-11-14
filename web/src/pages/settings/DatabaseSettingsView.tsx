import { useEffect, useRef, useState } from "react";
import { Badge, Button, Group, Paper, Stack, Switch, Text, Title, Box } from "@mantine/core";
import {
  IconAlertTriangle, IconArrowDown, IconArrowUp, IconBolt, IconBroadcast, IconCalendarTime, IconClockHour4, IconFileText, IconGauge, IconHistory, IconLink, IconListDetails, IconListSearch, IconMessage, IconPercentage, IconStack2, IconUsers, IconWand,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { sameIndex, type DatabaseSettings, type IndexSettings, type LiveConnectionSettings } from "../../api/dataSettings";
import { addToBlock, formatIndexText, indexLine, type IndexTextError } from "../../api/indexText";
import { IndexesCodeEditor } from "./IndexesCodeEditor";
import { when } from "../authentication/UsersView";
import { AreaHistory, AreaSettingsView, num } from "./AreaSettings";
import { SettingsLayout } from "../../components/SettingsLayout";
import { SettingRow, SettingsCard, UnitInput } from "../../components/SettingRows";
import { EmptyState } from "../../components/EmptyState";
import { surface } from "../../theme";

type DbSection = "indexes" | "history" | "limits" | "logging" | "live" | "changes";
const DB_SECTIONS: { id: DbSection; label: string }[] = [
  { id: "indexes", label: "Indexes and expiry" }, { id: "history", label: "Document history" },
  { id: "limits", label: "Limits" }, { id: "logging", label: "Logging" }, { id: "live", label: "Live connections" },
  { id: "changes", label: "Change history" },
];

/** Database → Settings: its sections listed on the left, the chosen one on the right. */
export function DatabaseSettingsView() {
  const [section, setSection] = useState<DbSection>("indexes");
  const label = DB_SECTIONS.find((s) => s.id === section)!.label;
  return (
    <SettingsLayout sections={DB_SECTIONS} active={section} onChange={setSection}>
      {section === "live" ? <LiveConnections /> : section === "changes" ? <DatabaseChanges /> : (
        // One draft for every section of the "database" area: switching sections keeps unsaved changes.
        <AreaSettingsView<DatabaseSettings> area="database" title={label} history={false}>
          {(draft, set, editable, block) => <DatabaseSection section={section} draft={draft} set={set} editable={editable} block={block} />}
        </AreaSettingsView>
      )}
    </SettingsLayout>
  );
}

/** Both areas' changes; one empty state when neither has any. */
function DatabaseChanges() {
  const db = useQuery({ queryKey: ["data-settings", "database"], queryFn: () => api.dataSettings<DatabaseSettings>("database") });
  const dbHistory = useQuery({ queryKey: ["data-settings-history", "database"], queryFn: () => api.dataSettingsHistory("database") });
  const liveHistory = useQuery({ queryKey: ["data-settings-history", "database.live"], queryFn: () => api.dataSettingsHistory("database.live"), retry: false });
  const editable = db.data?.editable ?? false;
  const hasDb = (dbHistory.data?.versions.length ?? 0) > 0;
  const hasLive = (liveHistory.data?.versions.length ?? 0) > 0;
  return (
    <Stack gap="md">
      <Title order={4}>Change history</Title>
      {!dbHistory.isLoading && !hasDb && !hasLive && (
        <EmptyState icon={IconHistory} title="No changes yet" description="Saved changes show up here: who made them, when and why." />
      )}
      {hasDb && <AreaHistory area="database" editable={editable} empty={false} />}
      {hasLive && (
        <>
          <Text fw={600} size="sm" mt="sm">Live connections</Text>
          <AreaHistory area="database.live" editable={editable} empty={false} />
        </>
      )}
    </Stack>
  );
}

/** Limits on live (WebSocket) connections. */
function LiveConnections() {
  return (
    <AreaSettingsView<LiveConnectionSettings> area="database.live" optional title="Live connections" history={false}>
      {(d, set, editable) => (
        <SettingsCard>
          <SettingRow icon={IconUsers} label="Connections per user">
            <UnitInput label="Connections per user" unit="max" placeholder="no limit" min={0} max={1000} disabled={!editable}
              value={d.maxConnectionsPerUser || ""} onChange={(v) => set({ ...d, maxConnectionsPerUser: v === "" ? 0 : num(v) })} />
          </SettingRow>
          <SettingRow icon={IconBroadcast} label="Listeners per connection">
            <UnitInput label="Listeners per connection" unit="max" placeholder="no limit" min={0} max={10000} disabled={!editable}
              value={d.maxSubscriptionsPerConnection || ""} onChange={(v) => set({ ...d, maxSubscriptionsPerConnection: v === "" ? 0 : num(v) })} />
          </SettingRow>
          <SettingRow icon={IconGauge} label="Requests per second">
            <UnitInput label="Requests per second" unit="/s" min={1} disabled={!editable} value={d.requestsPerSecond}
              onChange={(v) => set({ ...d, requestsPerSecond: num(v) })} />
          </SettingRow>
          <SettingRow icon={IconBolt} label="Burst">
            <UnitInput label="Burst" unit="requests" min={1} disabled={!editable} value={d.requestBurst}
              onChange={(v) => set({ ...d, requestBurst: num(v) })} />
          </SettingRow>
          <SettingRow icon={IconMessage} label="Largest message">
            <UnitInput label="Largest message" unit="KB" min={1} max={16384} disabled={!editable} value={d.maxMessageKb}
              onChange={(v) => set({ ...d, maxMessageKb: num(v) })} />
          </SettingRow>
        </SettingsCard>
      )}
    </AreaSettingsView>
  );
}

type Props = { draft: DatabaseSettings; set: (d: DatabaseSettings) => void; editable: boolean };

function DatabaseSection({ section, draft, set, editable, block }: Props & { section: DbSection; block: (why: string | null) => void }) {
  switch (section) {
    case "indexes": return <IndexesAndExpiry draft={draft} set={set} editable={editable} block={block} />;
    case "history": return (
      <SettingsCard>
        <SettingRow icon={IconHistory} label="Keep document history">
          <Switch aria-label="Keep document history" disabled={!editable} checked={draft.history.enabled}
            onChange={(e) => set({ ...draft, history: { ...draft.history, enabled: e.currentTarget.checked } })} />
        </SettingRow>
        <SettingRow icon={IconCalendarTime} label="Keep it for" dimmed={!draft.history.enabled}>
          <UnitInput label="Keep it for" unit="days" min={1} max={3650} disabled={!editable || !draft.history.enabled} value={draft.history.retentionDays}
            onChange={(v) => set({ ...draft, history: { ...draft.history, retentionDays: num(v) } })} />
        </SettingRow>
      </SettingsCard>
    );
    case "limits": return (
      <SettingsCard>
        <SettingRow icon={IconFileText} label="Largest document">
          <UnitInput label="Largest document" unit="KB" min={1} max={16384} disabled={!editable} value={draft.writeLimits.maxDocumentKb}
            onChange={(v) => set({ ...draft, writeLimits: { ...draft.writeLimits, maxDocumentKb: num(v) } })} />
        </SettingRow>
        <SettingRow icon={IconStack2} label="Deepest nesting">
          <UnitInput label="Deepest nesting" unit="levels" min={1} max={100} disabled={!editable} value={draft.writeLimits.maxDepth}
            onChange={(v) => set({ ...draft, writeLimits: { ...draft.writeLimits, maxDepth: num(v) } })} />
        </SettingRow>
        <SettingRow icon={IconLink} label="Expanded references per response">
          <UnitInput label="Expanded references per response" unit="refs" min={1} max={10000} disabled={!editable} value={draft.expandLimit}
            onChange={(v) => set({ ...draft, expandLimit: num(v) })} />
        </SettingRow>
      </SettingsCard>
    );
    case "logging": return (
      <Stack gap="md">
        <SettingsCard title="Requests">
          <SettingRow icon={IconListDetails} label="Log requests">
            <Switch aria-label="Log requests" disabled={!editable} checked={draft.requestLog.enabled}
              onChange={(e) => set({ ...draft, requestLog: { ...draft.requestLog, enabled: e.currentTarget.checked } })} />
          </SettingRow>
          <SettingRow icon={IconPercentage} label="Successful requests logged" dimmed={!draft.requestLog.enabled}>
            <UnitInput label="Successful requests logged" unit="%" min={0} max={100} disabled={!editable || !draft.requestLog.enabled}
              value={Math.round(draft.requestLog.sampleRate * 100)}
              onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, sampleRate: v === "" ? 0 : Number(v) / 100 } })} />
          </SettingRow>
          <SettingRow icon={IconClockHour4} label="Slow after" dimmed={!draft.requestLog.enabled}>
            <UnitInput label="Slow after" unit="ms" min={1} disabled={!editable || !draft.requestLog.enabled} value={draft.requestLog.slowMs}
              onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, slowMs: num(v) } })} />
          </SettingRow>
        </SettingsCard>
        <SettingsCard title="Queries">
          <SettingRow icon={IconAlertTriangle} label="Report slow queries without an index">
            <Switch aria-label="Report slow queries without an index" disabled={!editable} checked={draft.slowQueryMs != null}
              onChange={(e) => set({ ...draft, slowQueryMs: e.currentTarget.checked ? 500 : null })} />
          </SettingRow>
          <SettingRow icon={IconClockHour4} label="Slower than" dimmed={draft.slowQueryMs == null}>
            <UnitInput label="Slower than" unit="ms" min={1} disabled={!editable || draft.slowQueryMs == null} value={draft.slowQueryMs ?? 500}
              onChange={(v) => set({ ...draft, slowQueryMs: num(v) })} />
          </SettingRow>
        </SettingsCard>
      </Stack>
    );
    default: return null;
  }
}

/** An index's fields as chips, each with its direction (the slow-query suggestions). */
function FieldChips({ index }: { index: IndexSettings }) {
  if (index.kind === "array") {
    return <Badge variant="outline" color="gray" tt="none" radius="sm" ff="monospace">{index.fields[0]?.path} contains</Badge>;
  }
  return (
    <Group gap={4}>
      {index.fields.map((f, i) => (
        <Badge key={i} variant="outline" color="gray" tt="none" radius="sm" ff="monospace"
          rightSection={f.direction === "desc" ? <IconArrowDown size={11} /> : <IconArrowUp size={11} />}>{f.path}</Badge>
      ))}
    </Group>
  );
}

const sameRules = (d: Pick<DatabaseSettings, "indexes" | "ttl">) => JSON.stringify({ i: d.indexes, t: d.ttl });

/**
 * Indexes and expiry, written like rules (Indexes.IndexText on the server): one block per collection. The text is
 * checked as you type; while it has a mistake, saving waits and the mistake is underlined.
 */
function IndexesAndExpiry({ draft, set, editable, block }: Props & { block: (why: string | null) => void }) {
  const suggestions = useQuery({ queryKey: ["index-suggestions"], queryFn: api.indexSuggestions });
  const initial = formatIndexText(draft.indexes, draft.ttl);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<IndexTextError | null>(null);
  const [checking, setChecking] = useState(false);
  const applied = useRef(sameRules(draft));     // the indexes and expiry the text last produced
  const checkedText = useRef(initial);           // the text last checked
  const latest = useRef(draft);
  latest.current = draft;
  const fieldCache = useRef(new Map<string, Promise<string[]>>());

  // Changed from outside (Discard, a restored version): show it.
  useEffect(() => {
    const now = sameRules(draft);
    if (now === applied.current) return;
    applied.current = now;
    const t = formatIndexText(draft.indexes, draft.ttl);
    checkedText.current = t;
    setText(t);
    setError(null);
    block(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.indexes, draft.ttl]);

  // Checked as you type (a moment after you stop).
  useEffect(() => {
    if (text === checkedText.current) return;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.parseIndexText(text);
        checkedText.current = text;
        if (r.ok && r.indexes && r.ttl) {
          const next = { ...latest.current, indexes: r.indexes, ttl: r.ttl };
          applied.current = sameRules(next);
          set(next);
          setError(null);
          block(null);
        } else if (r.error) {
          setError(r.error);
          block(`Line ${r.error.line}: ${r.error.message}`);
        }
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const fieldsFor = (collection: string) => {
    let f = fieldCache.current.get(collection);
    if (!f) {
      f = api.rulesFields("database", `/${collection}/{id}`).then((r) => r.fields.map((x) => x.path));
      fieldCache.current.set(collection, f);
      f.catch(() => fieldCache.current.delete(collection));
    }
    return f;
  };

  const open = (suggestions.data?.suggestions ?? []).filter((s) => !draft.indexes.some((i) => sameIndex(i, s)));
  const expiring = draft.ttl.length;

  return (
    <Stack gap="md">
      {open.length > 0 && (
        <Paper withBorder radius="md" p="md" data-testid="index-suggestions"
          style={{ background: "linear-gradient(135deg, #FFFBEB 0%, #FFFFFF 70%)", borderColor: "#FDE68A" }}>
          <Group gap={8} mb="sm">
            <IconWand size={18} color="#B45309" />
            <Text size="sm" fw={600}>Slow queries asked for these</Text>
          </Group>
          <Stack gap={8}>
            {open.map((s) => (
              <Group key={s.code} justify="space-between" wrap="nowrap" gap="xs">
                <Group gap={8} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} ff="monospace">{s.collection}</Text>
                  <FieldChips index={s} />
                  {s.collectionGroup && <Badge size="xs" variant="light" tt="none">group</Badge>}
                  <Text size="xs" c="dimmed">{s.elapsedMs} ms · {when(s.at)}</Text>
                </Group>
                {editable && <Button size="xs" variant="default" onClick={() => setText(addToBlock(text, s.collection, s.collectionGroup, indexLine(s)))}>Add</Button>}
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Group justify="space-between" px="md" py={10} style={{ borderBottom: `1px solid ${surface.subtle}` }}>
          <Group gap="xs" data-testid="index-status">
            {error ? (
              <Badge color="red" variant="light" tt="none" leftSection={<IconAlertTriangle size={12} />}>Line {error.line}: {error.message}</Badge>
            ) : checking ? (
              <Badge color="gray" variant="light" tt="none">Checking…</Badge>
            ) : (
              <>
                <Badge color="winche" variant="light" tt="none" leftSection={<IconListSearch size={12} />}>
                  {draft.indexes.length} index{draft.indexes.length === 1 ? "" : "es"}
                </Badge>
                <Badge color="red" variant="light" tt="none" leftSection={<IconClockHour4 size={12} />}>
                  {expiring} expir{expiring === 1 ? "y" : "ies"}
                </Badge>
              </>
            )}
          </Group>
          {editable && (
            <Button size="xs" variant="default" disabled={!!error || checking} onClick={() => setText(formatIndexText(draft.indexes, draft.ttl))}>Format</Button>
          )}
        </Group>
        <Box p={8}>
          <IndexesCodeEditor value={text} onChange={setText} error={error} fieldsFor={fieldsFor} readOnly={!editable} />
        </Box>
      </Paper>
    </Stack>
  );
}
