import { useState } from "react";
import { Badge, Button, Group, NumberInput, Paper, SegmentedControl, Stack, Switch, Table, Text, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { fieldsText, parseFields, sameIndex, type DatabaseSettings, type IndexSettings } from "../../api/dataSettings";
import { when } from "../authentication/UsersView";
import { AreaSettingsView, num, Section } from "./AreaSettings";

/** Database → Settings: indexes (with the slow queries' suggestions), expiry, history, limits and logging. */
export function DatabaseSettingsView() {
  return (
    <AreaSettingsView<DatabaseSettings> area="database" title="Database settings"
      about="Indexes, expiry and limits. Indexes are built in the background without blocking writes.">
      {(draft, set, editable) => (
        <Stack gap="md">
          <Indexes draft={draft} set={set} editable={editable} />
          <Expiry draft={draft} set={set} editable={editable} />
          <Section title="History" hint="Keep a copy of each document before and after every change, and who made it (Documents → History).">
            <Group align="flex-end" wrap="wrap">
              <Switch label="Keep document history" disabled={!editable} checked={draft.history.enabled}
                onChange={(e) => set({ ...draft, history: { ...draft.history, enabled: e.currentTarget.checked } })} />
              {draft.history.enabled && (
                <NumberInput label="For (days)" w={140} min={1} max={3650} disabled={!editable} value={draft.history.retentionDays}
                  onChange={(v) => set({ ...draft, history: { ...draft.history, retentionDays: num(v) } })} />
              )}
            </Group>
          </Section>
          <Section title="Limits">
            <Group wrap="wrap">
              <NumberInput label="Largest document (KB)" w={200} min={1} max={16384} disabled={!editable} value={draft.writeLimits.maxDocumentKb}
                onChange={(v) => set({ ...draft, writeLimits: { ...draft.writeLimits, maxDocumentKb: num(v) } })} />
              <NumberInput label="Deepest nesting" w={200} min={1} max={100} disabled={!editable} value={draft.writeLimits.maxDepth}
                onChange={(v) => set({ ...draft, writeLimits: { ...draft.writeLimits, maxDepth: num(v) } })} />
            </Group>
          </Section>
          <Section title="Logging" hint="Requests appear in Logs; denied and slow ones always, a share of the rest.">
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
        </Stack>
      )}
    </AreaSettingsView>
  );
}

type Props = { draft: DatabaseSettings; set: (d: DatabaseSettings) => void; editable: boolean };

const NEW_INDEX = { collection: "", fields: "", kind: "ordered" as IndexSettings["kind"], collectionGroup: false };

function Indexes({ draft, set, editable }: Props) {
  const suggestions = useQuery({ queryKey: ["index-suggestions"], queryFn: api.indexSuggestions });
  const [adding, setAdding] = useState<typeof NEW_INDEX | null>(null);
  const add = (index: IndexSettings) => set({ ...draft, indexes: [...draft.indexes, index] });
  const open = (suggestions.data?.suggestions ?? []).filter((s) => !draft.indexes.some((i) => sameIndex(i, s)));

  return (
    <Section title="Indexes" hint="Speed up queries that filter or sort. Queries work without them, only slower on large collections.">
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
      {draft.indexes.length === 0 ? <Text size="sm" c="dimmed">None: every collection uses the built-in one.</Text> : (
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
      {editable && !adding && <Button size="xs" variant="default" w="fit-content" onClick={() => setAdding({ ...NEW_INDEX })}>Add index</Button>}
      {adding && (
        <Paper withBorder p="sm">
          <Stack gap="xs">
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
            <Group gap="xs">
              <Button size="xs" disabled={!adding.collection || parseFields(adding.fields).length === 0}
                onClick={() => { add({ collection: adding.collection, fields: parseFields(adding.fields), kind: adding.kind, collectionGroup: adding.collectionGroup }); setAdding(null); }}>Add</Button>
              <Button size="xs" variant="subtle" onClick={() => setAdding(null)}>Cancel</Button>
            </Group>
          </Stack>
        </Paper>
      )}
      <Switch label="Drop indexes no longer listed here" disabled={!editable} checked={draft.dropUndeclaredIndexes}
        onChange={(e) => set({ ...draft, dropUndeclaredIndexes: e.currentTarget.checked })} />
    </Section>
  );
}

function Expiry({ draft, set, editable }: Props) {
  const [collection, setCollection] = useState("");
  const [field, setField] = useState("");
  return (
    <Section title="Expiry" hint="Delete documents once a timestamp field is in the past (checked every few minutes).">
      {draft.ttl.length === 0 && <Text size="sm" c="dimmed">Nothing expires.</Text>}
      {draft.ttl.map((t, n) => (
        <Group key={n} justify="space-between" data-testid="db-ttl">
          <Text size="sm"><b>{t.collection}</b> when <Text span ff="monospace">{t.field}</Text> has passed</Text>
          {editable && <Button size="xs" variant="subtle" color="red" onClick={() => set({ ...draft, ttl: draft.ttl.filter((_, j) => j !== n) })}>Remove</Button>}
        </Group>
      ))}
      {editable && (
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Collection" placeholder="sessions" value={collection} onChange={(e) => setCollection(e.currentTarget.value.trim())} />
          <TextInput label="Timestamp field" placeholder="expiresAt" value={field} onChange={(e) => setField(e.currentTarget.value.trim())} />
          <Button size="xs" variant="default" disabled={!collection || !field}
            onClick={() => { set({ ...draft, ttl: [...draft.ttl, { collection, field }] }); setCollection(""); setField(""); }}>Add expiry</Button>
        </Group>
      )}
    </Section>
  );
}
