import { useState } from "react";
import { ActionIcon, Badge, Button, Group, Modal, Paper, SegmentedControl, Stack, Switch, Text, TextInput, Title, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle, IconArrowDown, IconArrowUp, IconBolt, IconBroadcast, IconCalendarTime, IconClockHour4, IconClockOff, IconFileText,
  IconGauge, IconHistory, IconLink, IconListDetails, IconListSearch, IconMessage, IconPercentage, IconPlus, IconStack2, IconTrash,
  IconUsers, IconWand,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { parseFields, sameIndex, type DatabaseSettings, type IndexSettings, type LiveConnectionSettings } from "../../api/dataSettings";
import { when } from "../authentication/UsersView";
import { AreaHistory, AreaSettingsView, num } from "./AreaSettings";
import { SettingsLayout } from "../../components/SettingsLayout";
import { SettingRow, SettingsCard, UnitInput } from "../../components/SettingRows";
import { EmptyState } from "../../components/EmptyState";
import { surface } from "../../theme";

type DbSection = "indexes" | "expiry" | "history" | "limits" | "logging" | "live" | "changes";
const DB_SECTIONS: { id: DbSection; label: string }[] = [
  { id: "indexes", label: "Indexes" }, { id: "expiry", label: "Expiry" }, { id: "history", label: "Document history" },
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
          {(draft, set, editable) => <DatabaseSection section={section} draft={draft} set={set} editable={editable} />}
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

function DatabaseSection({ section, draft, set, editable }: Props & { section: DbSection }) {
  switch (section) {
    case "indexes": return <Indexes draft={draft} set={set} editable={editable} />;
    case "expiry": return <Expiry draft={draft} set={set} editable={editable} />;
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

const NEW_INDEX = { collection: "", fields: "", kind: "ordered" as IndexSettings["kind"], collectionGroup: false };

/** An index's fields as chips, each with its direction. */
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

function Indexes({ draft, set, editable }: Props) {
  const suggestions = useQuery({ queryKey: ["index-suggestions"], queryFn: api.indexSuggestions });
  const [adding, setAdding] = useState<typeof NEW_INDEX | null>(null);
  const add = (index: IndexSettings) => set({ ...draft, indexes: [...draft.indexes, index] });
  const open = (suggestions.data?.suggestions ?? []).filter((s) => !draft.indexes.some((i) => sameIndex(i, s)));
  const addButton = editable && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ ...NEW_INDEX })}>Add index</Button>;

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
                {editable && <Button size="xs" variant="default" onClick={() => add({ collection: s.collection, fields: s.fields, kind: s.kind, collectionGroup: s.collectionGroup })}>Add</Button>}
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        {draft.indexes.length === 0 ? (
          <EmptyState bordered={false} icon={IconListSearch} title="No indexes of your own"
            description="Every query still works. Slow ones are suggested here when they need one." action={addButton || undefined} />
        ) : (
          <>
            <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
              <Text size="sm" c={surface.muted}>{draft.indexes.length} index{draft.indexes.length === 1 ? "" : "es"}</Text>
              {addButton}
            </Group>
            {draft.indexes.map((i, n) => (
              <Group key={n} justify="space-between" wrap="nowrap" px="md" py={12} className="winche-setting-row" data-testid="db-index">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0,
                    background: "var(--mantine-color-winche-0)", color: "var(--mantine-color-winche-6)" }}>
                    <IconListSearch size={17} stroke={1.8} />
                  </div>
                  <Stack gap={4} style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text size="sm" fw={600} ff="monospace">{i.collection}</Text>
                      {i.collectionGroup && <Badge size="xs" variant="light" tt="none">every {i.collection}</Badge>}
                      <Badge size="xs" variant="light" color="gray" tt="none">{i.kind === "array" ? "array contains" : "filter and sort"}</Badge>
                    </Group>
                    <FieldChips index={i} />
                  </Stack>
                </Group>
                {editable && (
                  <Tooltip label="Remove index" withArrow>
                    <ActionIcon variant="subtle" color="gray" aria-label={`Remove index on ${i.collection}`}
                      onClick={() => set({ ...draft, indexes: draft.indexes.filter((_, j) => j !== n) })}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            ))}
          </>
        )}
      </Paper>

      <Modal opened={!!adding} onClose={() => setAdding(null)} title={<Text fw={700} fz={18}>Add an index</Text>} radius="lg">
        {adding && (
          <Stack gap="md">
            <SegmentedControl fullWidth value={adding.kind} aria-label="Index kind"
              data={[{ value: "ordered", label: "Filter and sort" }, { value: "array", label: "Array contains" }]}
              onChange={(v) => setAdding({ ...adding, kind: v as IndexSettings["kind"] })} />
            <TextInput label="Collection" placeholder="sessions" data-autofocus value={adding.collection}
              onChange={(e) => setAdding({ ...adding, collection: e.currentTarget.value.trim() })} />
            <TextInput label={adding.kind === "array" ? "Array field" : "Fields, in order"} placeholder={adding.kind === "array" ? "tags" : "userId, startedAt desc"}
              styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
              value={adding.fields} onChange={(e) => setAdding({ ...adding, fields: e.currentTarget.value })} />
            {adding.kind === "ordered" && parseFields(adding.fields).length > 0 && (
              <FieldChips index={{ collection: adding.collection, fields: parseFields(adding.fields), kind: "ordered", collectionGroup: false }} />
            )}
            <Switch label="Every collection with this name, wherever it is" checked={adding.collectionGroup}
              onChange={(e) => setAdding({ ...adding, collectionGroup: e.currentTarget.checked })} />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setAdding(null)}>Cancel</Button>
              <Button disabled={!adding.collection || parseFields(adding.fields).length === 0}
                onClick={() => { add({ collection: adding.collection, fields: parseFields(adding.fields), kind: adding.kind, collectionGroup: adding.collectionGroup }); setAdding(null); }}>Add index</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function Expiry({ draft, set, editable }: Props) {
  const [adding, setAdding] = useState(false);
  const [collection, setCollection] = useState("");
  const [field, setField] = useState("");
  const close = () => { setAdding(false); setCollection(""); setField(""); };
  const addButton = editable && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAdding(true)}>Add expiry</Button>;
  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {draft.ttl.length === 0 ? (
        <EmptyState bordered={false} icon={IconClockOff} title="Nothing expires"
          description="Pick a collection and a timestamp field to delete its documents once that time has passed." action={addButton || undefined} />
      ) : (
        <>
          <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
            <Text size="sm" c={surface.muted}>{draft.ttl.length} collection{draft.ttl.length === 1 ? "" : "s"} expire</Text>
            {addButton}
          </Group>
          {draft.ttl.map((t, n) => (
            <Group key={n} justify="space-between" wrap="nowrap" px="md" py={12} className="winche-setting-row" data-testid="db-ttl">
              <Group gap="sm" wrap="nowrap">
                <div style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0, background: "#FEF3F2", color: "#B42318" }}>
                  <IconClockHour4 size={17} stroke={1.8} />
                </div>
                <Text size="sm"><Text span fw={600} ff="monospace">{t.collection}</Text> <Text span c={surface.muted}>when</Text> <Badge variant="outline" color="gray" tt="none" radius="sm" ff="monospace">{t.field}</Badge> <Text span c={surface.muted}>has passed</Text></Text>
              </Group>
              {editable && (
                <Tooltip label="Remove" withArrow>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Remove expiry on ${t.collection}`} onClick={() => set({ ...draft, ttl: draft.ttl.filter((_, j) => j !== n) })}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </>
      )}
      <Modal opened={adding} onClose={close} title={<Text fw={700} fz={18}>Add an expiry</Text>} radius="lg">
        <Stack gap="md">
          <TextInput label="Collection" placeholder="sessions" data-autofocus value={collection} onChange={(e) => setCollection(e.currentTarget.value.trim())} />
          <TextInput label="Timestamp field" placeholder="expiresAt" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            value={field} onChange={(e) => setField(e.currentTarget.value.trim())} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button disabled={!collection || !field} onClick={() => { set({ ...draft, ttl: [...draft.ttl, { collection, field }] }); close(); }}>Add expiry</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
