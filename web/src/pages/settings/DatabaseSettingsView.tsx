import { useState } from "react";
import { Badge, Button, Group, Modal, NumberInput, Paper, SegmentedControl, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { fieldsText, parseFields, sameIndex, type DatabaseSettings, type IndexSettings, type LiveConnectionSettings } from "../../api/dataSettings";
import { when } from "../authentication/UsersView";
import { AreaHistory, AreaSettingsView, num, Section } from "./AreaSettings";
import { SettingsLayout } from "../../components/SettingsLayout";
import { EmptyState } from "../../components/EmptyState";
import { IconClockOff, IconListSearch } from "@tabler/icons-react";

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

function DatabaseChanges() {
  const editable = useQuery({ queryKey: ["data-settings", "database"], queryFn: () => api.dataSettings<DatabaseSettings>("database") }).data?.editable ?? false;
  return (
    <Stack gap="md">
      <Title order={4}>Change history</Title>
      <AreaHistory area="database" editable={editable} />
      <AreaHistory area="database.live" editable={editable} />
    </Stack>
  );
}

/** Limits on live (WebSocket) connections. */
function LiveConnections() {
  return (
    <AreaSettingsView<LiveConnectionSettings> area="database.live" optional title="Live connections" history={false}>
      {(d, set, editable) => (
        <Section>
          <Group wrap="wrap">
            <NumberInput label="Connections per user" description="0: no limit" w={200} min={0} max={1000} disabled={!editable} value={d.maxConnectionsPerUser}
              onChange={(v) => set({ ...d, maxConnectionsPerUser: num(v) })} />
            <NumberInput label="Listeners per connection" description="0: no limit" w={200} min={0} max={10000} disabled={!editable} value={d.maxSubscriptionsPerConnection}
              onChange={(v) => set({ ...d, maxSubscriptionsPerConnection: num(v) })} />
            <NumberInput label="Requests per second" w={200} min={1} disabled={!editable} value={d.requestsPerSecond}
              onChange={(v) => set({ ...d, requestsPerSecond: num(v) })} />
            <NumberInput label="Burst" w={200} min={1} disabled={!editable} value={d.requestBurst}
              onChange={(v) => set({ ...d, requestBurst: num(v) })} />
            <NumberInput label="Largest message (KB)" w={200} min={1} max={16384} disabled={!editable} value={d.maxMessageKb}
              onChange={(v) => set({ ...d, maxMessageKb: num(v) })} />
          </Group>
        </Section>
      )}
    </AreaSettingsView>
  );
}

function DatabaseSection({ section, draft, set, editable }: Props & { section: DbSection }) {
  switch (section) {
    case "indexes": return <Indexes draft={draft} set={set} editable={editable} />;
    case "expiry": return <Expiry draft={draft} set={set} editable={editable} />;
    case "history": return (
      <Section>
        <Group align="flex-end" wrap="wrap">
          <Switch label="Keep document history" disabled={!editable} checked={draft.history.enabled}
            onChange={(e) => set({ ...draft, history: { ...draft.history, enabled: e.currentTarget.checked } })} />
          {draft.history.enabled && (
            <NumberInput label="For (days)" w={140} min={1} max={3650} disabled={!editable} value={draft.history.retentionDays}
              onChange={(v) => set({ ...draft, history: { ...draft.history, retentionDays: num(v) } })} />
          )}
        </Group>
      </Section>
    );
    case "limits": return (
      <Section>
        <Group wrap="wrap">
          <NumberInput label="Largest document (KB)" w={200} min={1} max={16384} disabled={!editable} value={draft.writeLimits.maxDocumentKb}
            onChange={(v) => set({ ...draft, writeLimits: { ...draft.writeLimits, maxDocumentKb: num(v) } })} />
          <NumberInput label="Deepest nesting" w={200} min={1} max={100} disabled={!editable} value={draft.writeLimits.maxDepth}
            onChange={(v) => set({ ...draft, writeLimits: { ...draft.writeLimits, maxDepth: num(v) } })} />
          <NumberInput label="Expanded references per response" w={260} min={1} max={10000} disabled={!editable}
            value={draft.expandLimit} onChange={(v) => set({ ...draft, expandLimit: num(v) })} />
        </Group>
      </Section>
    );
    case "logging": return (
      <Section>
        <Group align="flex-end" wrap="wrap">
          <Switch label="Log requests" disabled={!editable} checked={draft.requestLog.enabled}
            onChange={(e) => set({ ...draft, requestLog: { ...draft.requestLog, enabled: e.currentTarget.checked } })} />
          {draft.requestLog.enabled && (
            <>
              <NumberInput label="Successful requests logged (%)" w={220} min={0} max={100} disabled={!editable}
                value={Math.round(draft.requestLog.sampleRate * 100)}
                onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, sampleRate: v === "" ? 0 : Number(v) / 100 } })} />
              <NumberInput label="Slow after (ms)" w={160} min={1} disabled={!editable} value={draft.requestLog.slowMs}
                onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, slowMs: num(v) } })} />
            </>
          )}
        </Group>
        <Group align="flex-end" wrap="wrap">
          <Switch label="Report slow queries without an index" disabled={!editable} checked={draft.slowQueryMs != null}
            onChange={(e) => set({ ...draft, slowQueryMs: e.currentTarget.checked ? 500 : null })} />
          {draft.slowQueryMs != null && (
            <NumberInput label="Slower than (ms)" w={160} min={1} disabled={!editable} value={draft.slowQueryMs}
              onChange={(v) => set({ ...draft, slowQueryMs: num(v) })} />
          )}
        </Group>
      </Section>
    );
    default: return null;
  }
}

type Props = { draft: DatabaseSettings; set: (d: DatabaseSettings) => void; editable: boolean };

const NEW_INDEX = { collection: "", fields: "", kind: "ordered" as IndexSettings["kind"], collectionGroup: false };

function Indexes({ draft, set, editable }: Props) {
  const suggestions = useQuery({ queryKey: ["index-suggestions"], queryFn: api.indexSuggestions });
  const [adding, setAdding] = useState<typeof NEW_INDEX | null>(null);
  const add = (index: IndexSettings) => set({ ...draft, indexes: [...draft.indexes, index] });
  const open = (suggestions.data?.suggestions ?? []).filter((s) => !draft.indexes.some((i) => sameIndex(i, s)));

  return (
    <Section>
      {open.length > 0 && (
        <Paper withBorder p="sm" bg="var(--mantine-color-yellow-light)" data-testid="index-suggestions">
          <Stack gap={6}>
            <Text size="sm" fw={500}>Slow queries asked for these</Text>
            {open.map((s) => (
              <Group key={s.code} justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm" ff="monospace" style={{ overflowWrap: "anywhere" }}>
                  {s.collection}{s.collectionGroup ? " (group)" : ""}: {s.kind === "array" ? `${s.fields[0]?.path} (array)` : fieldsText(s.fields)}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c="dimmed">{s.elapsedMs} ms · {when(s.at)}</Text>
                  {editable && <Button size="xs" variant="default" onClick={() => add({ collection: s.collection, fields: s.fields, kind: s.kind, collectionGroup: s.collectionGroup })}>Add</Button>}
                </Group>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
      {draft.indexes.length === 0 ? <EmptyState compact icon={IconListSearch} title="No indexes of your own" description="Every query still works. Slow ones are suggested here when they need one." /> : (
        <Table fz="sm" verticalSpacing={6}>
          <Table.Thead><Table.Tr><Table.Th>Collection</Table.Th><Table.Th>Fields</Table.Th><Table.Th>Kind</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {draft.indexes.map((i, n) => (
              <Table.Tr key={n} data-testid="db-index">
                <Table.Td>{i.collection}{i.collectionGroup && <Badge ml={6} size="xs" variant="light" tt="none">group</Badge>}</Table.Td>
                <Table.Td><Text size="sm" ff="monospace">{fieldsText(i.fields)}</Text></Table.Td>
                <Table.Td>{i.kind === "array" ? "array contains" : "filter and sort"}</Table.Td>
                <Table.Td ta="right">
                  {editable && <Button size="xs" variant="subtle" color="red" onClick={() => set({ ...draft, indexes: draft.indexes.filter((_, j) => j !== n) })}>Remove</Button>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {editable && <Button size="xs" variant="default" w="fit-content" onClick={() => setAdding({ ...NEW_INDEX })}>Add index</Button>}
      <Modal opened={!!adding} onClose={() => setAdding(null)} title={<Text fw={700} fz={18}>Add an index</Text>} radius="lg">
        {adding && (
          <Stack gap="md">
            <SegmentedControl size="xs" w="fit-content" value={adding.kind} aria-label="Index kind"
              data={[{ value: "ordered", label: "Filter and sort" }, { value: "array", label: "Array contains" }]}
              onChange={(v) => setAdding({ ...adding, kind: v as IndexSettings["kind"] })} />
            <Group grow wrap="wrap" align="flex-end">
              <TextInput label="Collection" placeholder="sessions" value={adding.collection} onChange={(e) => setAdding({ ...adding, collection: e.currentTarget.value.trim() })} />
              <TextInput label={adding.kind === "array" ? "Array field" : "Fields, in order"} placeholder={adding.kind === "array" ? "tags" : "userId, startedAt desc"}
                value={adding.fields} onChange={(e) => setAdding({ ...adding, fields: e.currentTarget.value })} />
            </Group>
            <Switch label="Every collection with this name, wherever it is (collection group)" checked={adding.collectionGroup}
              onChange={(e) => setAdding({ ...adding, collectionGroup: e.currentTarget.checked })} />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setAdding(null)}>Cancel</Button>
              <Button disabled={!adding.collection || parseFields(adding.fields).length === 0}
                onClick={() => { add({ collection: adding.collection, fields: parseFields(adding.fields), kind: adding.kind, collectionGroup: adding.collectionGroup }); setAdding(null); }}>Add index</Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Switch label="Drop indexes no longer listed here" disabled={!editable} checked={draft.dropUndeclaredIndexes}
        onChange={(e) => set({ ...draft, dropUndeclaredIndexes: e.currentTarget.checked })} />
    </Section>
  );
}

function Expiry({ draft, set, editable }: Props) {
  const [adding, setAdding] = useState(false);
  const [collection, setCollection] = useState("");
  const [field, setField] = useState("");
  const close = () => { setAdding(false); setCollection(""); setField(""); };
  return (
    <Section>
      {draft.ttl.length === 0 && <EmptyState compact icon={IconClockOff} title="Nothing expires" description="Pick a collection and a timestamp field to delete its documents once that time has passed." />}
      {draft.ttl.map((t, n) => (
        <Group key={n} justify="space-between" data-testid="db-ttl">
          <Text size="sm"><b>{t.collection}</b> when <Text span ff="monospace">{t.field}</Text> has passed</Text>
          {editable && <Button size="xs" variant="subtle" color="red" onClick={() => set({ ...draft, ttl: draft.ttl.filter((_, j) => j !== n) })}>Remove</Button>}
        </Group>
      ))}
      {editable && <Button size="xs" variant="default" w="fit-content" onClick={() => setAdding(true)}>Add expiry</Button>}
      <Modal opened={adding} onClose={close} title={<Text fw={700} fz={18}>Add an expiry</Text>} radius="lg">
        <Stack gap="md">
          <TextInput label="Collection" placeholder="sessions" data-autofocus value={collection} onChange={(e) => setCollection(e.currentTarget.value.trim())} />
          <TextInput label="Timestamp field" description="Documents are deleted once this time has passed." placeholder="expiresAt" value={field} onChange={(e) => setField(e.currentTarget.value.trim())} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button disabled={!collection || !field} onClick={() => { set({ ...draft, ttl: [...draft.ttl, { collection, field }] }); close(); }}>Add expiry</Button>
          </Group>
        </Stack>
      </Modal>
    </Section>
  );
}
