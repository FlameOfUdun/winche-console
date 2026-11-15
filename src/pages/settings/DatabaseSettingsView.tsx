import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Box, Button, Group, Loader, Menu, Modal, Paper, SegmentedControl, Stack, Switch, Table, Text, TextInput, ActionIcon } from "@mantine/core";
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconClockHour4, IconCode, IconDots, IconListSearch, IconPlus, IconWand } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorWithList } from "../../api/appAuth";
import { parseFields, sameIndex, type DatabaseSettings, type IndexSettings, type LiveConnectionSettings } from "../../api/dataSettings";
import { addToBlock, formatIndexText, indexLine, type IndexTextError } from "../../api/indexText";
import { IndexesCodeEditor } from "./IndexesCodeEditor";
import { when } from "../authentication/UsersView";
import { AreaHistory, AreaSettingsView, num, useAreaCards, versionLine } from "./AreaSettings";
import { UnitInput } from "../../components/SettingRows";
import { CardsPage, EditCard, EditRow, HistoryButton, OnOff } from "../../components/EditCard";
import { EmptyState } from "../../components/EmptyState";
import { surface } from "../../theme";

const kb = (n: number) => `${n.toLocaleString()} KB`;
const limit = (n: number) => (n > 0 ? n.toLocaleString() : <Text span c="var(--w-faint)" size="sm">No limit</Text>);

/** Database → Settings: each group a card showing what's set, edited in place and saved with a reason. */
export function DatabaseSettingsView() {
  const db = useAreaCards<DatabaseSettings>("database");
  const live = useAreaCards<LiveConnectionSettings>("database.live");
  if (db.saved.isLoading) return <Loader size="sm" />;
  if (db.saved.isError || !db.settings) return <Alert color="red">Couldn't load the settings: {errorWithList(db.saved.error)}</Alert>;
  const s = db.settings;
  const d = db.draft;
  const hasLive = !!live.settings;
  return (
    <CardsPage intro={versionLine(db.saved.data)}
      history={<HistoryButton subtitle="Database settings"><DatabaseChanges editable={db.editable} hasLive={hasLive} /></HistoryButton>}>
      {!db.editable && <Alert color="gray">Read-only. {db.saved.data?.whyReadOnly}</Alert>}

      <EditCard title="Document history" description="Earlier versions of every document, to see who changed what and restore it." {...db.card("history")}
        rows={[{ label: "Keep document history", value: <OnOff on={s.history.enabled} /> },
          ...(s.history.enabled ? [{ label: "Keep it for", value: `${s.history.retentionDays} days` }] : [])]}
        form={d && (
          <>
            <EditRow label="Keep document history" hint="Every write keeps the document's previous version.">
              <Switch aria-label="Keep document history" checked={d.history.enabled}
                onChange={(e) => db.setDraft({ ...d, history: { ...d.history, enabled: e.currentTarget.checked } })} />
            </EditRow>
            <EditRow label="Keep it for" hint="Older versions are deleted after this.">
              <UnitInput label="Keep it for" unit="days" min={1} max={3650} disabled={!d.history.enabled} value={d.history.retentionDays}
                onChange={(v) => db.setDraft({ ...d, history: { ...d.history, retentionDays: num(v) } })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Limits" description="What one document and one response may hold. Writes over a limit are refused." {...db.card("limits")}
        rows={[{ label: "Largest document", value: kb(s.writeLimits.maxDocumentKb) }, { label: "Deepest nesting", value: `${s.writeLimits.maxDepth} levels` },
          { label: "Expanded references per response", value: s.expandLimit.toLocaleString() }]}
        form={d && (
          <>
            <EditRow label="Largest document" hint="Up to 16,384 KB.">
              <UnitInput label="Largest document" unit="KB" min={1} max={16384} value={d.writeLimits.maxDocumentKb}
                onChange={(v) => db.setDraft({ ...d, writeLimits: { ...d.writeLimits, maxDocumentKb: num(v) } })} />
            </EditRow>
            <EditRow label="Deepest nesting" hint="Maps and lists inside each other.">
              <UnitInput label="Deepest nesting" unit="levels" min={1} max={100} value={d.writeLimits.maxDepth}
                onChange={(v) => db.setDraft({ ...d, writeLimits: { ...d.writeLimits, maxDepth: num(v) } })} />
            </EditRow>
            <EditRow label="Expanded references per response" hint="References followed when a query asks for them.">
              <UnitInput label="Expanded references per response" unit="refs" min={1} max={10000} value={d.expandLimit}
                onChange={(v) => db.setDraft({ ...d, expandLimit: num(v) })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Logging" description="Which reads and writes show in Logs, and slow queries that need an index. Failures are always logged." {...db.card("logging")}
        rows={[{ label: "Log requests", value: <OnOff on={s.requestLog.enabled} /> },
          ...(s.requestLog.enabled ? [{ label: "Successful reads logged", value: `${Math.round(s.requestLog.sampleRate * 100)}%` },
            { label: "Slow after", value: `${s.requestLog.slowMs.toLocaleString()} ms` }] : []),
          { label: "Report slow queries without an index", value: s.slowQueryMs != null ? `Slower than ${s.slowQueryMs.toLocaleString()} ms` : <OnOff on={false} /> }]}
        form={d && (
          <>
            <EditRow label="Log requests">
              <Switch aria-label="Log requests" checked={d.requestLog.enabled}
                onChange={(e) => db.setDraft({ ...d, requestLog: { ...d.requestLog, enabled: e.currentTarget.checked } })} />
            </EditRow>
            <EditRow label="Successful reads logged" hint="A sample, to keep Logs small.">
              <UnitInput label="Successful reads logged" unit="%" min={0} max={100} disabled={!d.requestLog.enabled} value={Math.round(d.requestLog.sampleRate * 100)}
                onChange={(v) => db.setDraft({ ...d, requestLog: { ...d.requestLog, sampleRate: v === "" ? 0 : Number(v) / 100 } })} />
            </EditRow>
            <EditRow label="Slow after">
              <UnitInput label="Slow after" unit="ms" min={1} disabled={!d.requestLog.enabled} value={d.requestLog.slowMs}
                onChange={(v) => db.setDraft({ ...d, requestLog: { ...d.requestLog, slowMs: num(v) } })} />
            </EditRow>
            <EditRow label="Report slow queries without an index" hint="They show in Logs and as suggestions on Indexes.">
              <Switch aria-label="Report slow queries without an index" checked={d.slowQueryMs != null}
                onChange={(e) => db.setDraft({ ...d, slowQueryMs: e.currentTarget.checked ? 500 : null })} />
            </EditRow>
            <EditRow label="Slower than">
              <UnitInput label="Slower than" unit="ms" min={1} disabled={d.slowQueryMs == null} value={d.slowQueryMs ?? 500}
                onChange={(v) => db.setDraft({ ...d, slowQueryMs: num(v) })} />
            </EditRow>
          </>
        )} />

      {hasLive && <LiveConnectionsCard live={live} />}
    </CardsPage>
  );
}

function LiveConnectionsCard({ live }: { live: ReturnType<typeof useAreaCards<LiveConnectionSettings>> }) {
  const s = live.settings!;
  const d = live.draft;
  const set = (patch: Partial<LiveConnectionSettings>) => live.setDraft({ ...d, ...patch });
  return (
    <EditCard title="Live connections" description="Limits on apps listening for changes as they happen." {...live.card("live")}
      rows={[{ label: "Connections per user", value: limit(s.maxConnectionsPerUser) }, { label: "Listeners per connection", value: limit(s.maxSubscriptionsPerConnection) },
        { label: "Requests per second, per connection", value: `${s.requestsPerSecond} (bursts of ${s.requestBurst})` }, { label: "Largest message", value: kb(s.maxMessageKb) }]}
      form={d && (
        <>
          <EditRow label="Connections per user" hint="Empty: no limit.">
            <UnitInput label="Connections per user" unit="max" placeholder="no limit" min={0} max={1000} value={d.maxConnectionsPerUser || ""}
              onChange={(v) => set({ maxConnectionsPerUser: v === "" ? 0 : num(v) })} />
          </EditRow>
          <EditRow label="Listeners per connection" hint="Empty: no limit.">
            <UnitInput label="Listeners per connection" unit="max" placeholder="no limit" min={0} max={10000} value={d.maxSubscriptionsPerConnection || ""}
              onChange={(v) => set({ maxSubscriptionsPerConnection: v === "" ? 0 : num(v) })} />
          </EditRow>
          <EditRow label="Requests per second">
            <UnitInput label="Requests per second" unit="/s" min={1} value={d.requestsPerSecond} onChange={(v) => set({ requestsPerSecond: num(v) })} />
          </EditRow>
          <EditRow label="Burst">
            <UnitInput label="Burst" unit="requests" min={1} value={d.requestBurst} onChange={(v) => set({ requestBurst: num(v) })} />
          </EditRow>
          <EditRow label="Largest message">
            <UnitInput label="Largest message" unit="KB" min={1} max={16384} value={d.maxMessageKb} onChange={(v) => set({ maxMessageKb: num(v) })} />
          </EditRow>
        </>
      )} />
  );
}

/** Both areas' changes; one empty state when neither has any. */
function DatabaseChanges({ editable, hasLive }: { editable: boolean; hasLive: boolean }) {
  const dbHistory = useQuery({ queryKey: ["data-settings-history", "database"], queryFn: () => api.dataSettingsHistory("database") });
  const liveHistory = useQuery({ queryKey: ["data-settings-history", "database.live"], queryFn: () => api.dataSettingsHistory("database.live"), retry: false, enabled: hasLive });
  const hasDb = (dbHistory.data?.versions.length ?? 0) > 0;
  const hasLiveChanges = (liveHistory.data?.versions.length ?? 0) > 0;
  return (
    <Stack gap="md">
      {!dbHistory.isLoading && !hasDb && !hasLiveChanges && (
        <EmptyState compact bordered={false} icon={IconClockHour4} title="No changes yet" description="Saved changes show up here: who made them, when and why." />
      )}
      {hasDb && <AreaHistory area="database" editable={editable} empty={false} />}
      {hasLiveChanges && (
        <>
          <Text fw={600} size="sm" mt="sm">Live connections</Text>
          <AreaHistory area="database.live" editable={editable} empty={false} />
        </>
      )}
    </Stack>
  );
}

/**
 * Database → Indexes: the indexes queries use and the expiry rules, as tables, with what slow queries asked for;
 * added and removed one at a time with a reason, or all of it edited as text.
 */
export function DatabaseIndexesView() {
  const db = useAreaCards<DatabaseSettings>("database");
  const [view, setView] = useState<"indexes" | "expiry">("indexes");
  const [asText, setAsText] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ what: string; next: DatabaseSettings } | null>(null);
  const suggestions = useQuery({ queryKey: ["index-suggestions"], queryFn: api.indexSuggestions });
  if (db.saved.isLoading) return <Loader size="sm" />;
  if (db.saved.isError || !db.settings) return <Alert color="red">Couldn't load the indexes: {errorWithList(db.saved.error)}</Alert>;
  const s = db.settings;
  if (asText) return (
    <Stack gap="md" pb={40}>
      <Group><Button variant="default" onClick={() => setAsText(false)}>Back to the tables</Button></Group>
      <AreaSettingsView<DatabaseSettings> area="database" title="Indexes and expiry, as text" history={false}>
        {(draft, set, editable, block) => <IndexesAndExpiry draft={draft} set={set} editable={editable} block={block} />}
      </AreaSettingsView>
    </Stack>
  );
  const open = (suggestions.data?.suggestions ?? []).filter((x) => !s.indexes.some((i) => sameIndex(i, x)));
  return (
    <Stack gap="md" pb={40}>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <SegmentedControl value={view} onChange={(v) => setView(v as "indexes" | "expiry")} aria-label="Index kind"
          data={[{ value: "indexes", label: `Indexes (${s.indexes.length})` }, { value: "expiry", label: `Expiry (${s.ttl.length})` }]} />
        <Group gap="xs">
          <Button variant="default" leftSection={<IconCode size={16} />} onClick={() => setAsText(true)}>Edit as text</Button>
          {db.editable && <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>{view === "indexes" ? "Add index" : "Add expiry"}</Button>}
        </Group>
      </Group>
      {view === "indexes" && open.length > 0 && db.editable && (
        <Paper withBorder radius="lg" p="md" data-testid="index-suggestions" style={{ background: "var(--w-pill-off-bg)", borderColor: "var(--w-pill-off-bd)" }}>
          <Group gap={8} mb="sm"><IconWand size={18} color="var(--w-pill-off-fg)" /><Text size="sm" fw={600}>Slow queries asked for these</Text></Group>
          <Stack gap={8}>
            {open.map((x) => (
              <Group key={x.code} justify="space-between" wrap="nowrap" gap="xs">
                <Group gap={8} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} ff="monospace">{x.collection}</Text><FieldChips index={x} />
                  <Text size="xs" c="dimmed">{x.elapsedMs} ms · {when(x.at)}</Text>
                </Group>
                <Button size="xs" variant="default" onClick={() => setRemoving({ what: `Add the index ${x.collection} (${indexLine(x)})`,
                  next: { ...s, indexes: [...s.indexes, { collection: x.collection, fields: x.fields, kind: x.kind, collectionGroup: x.collectionGroup }] } })}>Add</Button>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
      <Text size="sm" c="var(--w-muted)">
        {view === "indexes"
          ? "Queries that filter or sort on more than one field need an index. Single fields are indexed already."
          : "Documents are deleted once the time in a field has passed, within about an hour."}
      </Text>
      <Paper withBorder radius="lg" style={{ overflowX: "auto" }}>
        {view === "indexes" ? (s.indexes.length === 0
          ? <EmptyState compact bordered={false} icon={IconListSearch} title="No indexes yet" description="Add one, or let a slow query suggest it." />
          : (
            <Table verticalSpacing={12} horizontalSpacing="lg" miw={640}>
              <Table.Thead><Table.Tr><Table.Th>Collection</Table.Th><Table.Th>Fields</Table.Th><Table.Th>Scope</Table.Th><Table.Th w={48} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {s.indexes.map((i, n) => (
                  <Table.Tr key={n} data-testid="index-row">
                    <Table.Td><Text size="sm" ff="monospace">{i.collection}</Text></Table.Td>
                    <Table.Td><FieldChips index={i} /></Table.Td>
                    <Table.Td><Text size="sm">{i.collectionGroup ? "Collection group" : "Collection"}</Text></Table.Td>
                    <Table.Td>{db.editable && <RowMenu label="Index actions" onRemove={() => setRemoving({ what: `Remove the index on ${i.collection}`,
                      next: { ...s, indexes: s.indexes.filter((_, k) => k !== n) } })} />}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )) : (s.ttl.length === 0
          ? <EmptyState compact bordered={false} icon={IconClockHour4} title="No expiry yet" description="Delete documents once a time in them has passed, like sessions." />
          : (
            <Table verticalSpacing={12} horizontalSpacing="lg" miw={520}>
              <Table.Thead><Table.Tr><Table.Th>Collection</Table.Th><Table.Th>Field</Table.Th><Table.Th w={48} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {s.ttl.map((t, n) => (
                  <Table.Tr key={n} data-testid="ttl-row">
                    <Table.Td><Text size="sm" ff="monospace">{t.collection}</Text></Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{t.field}</Text></Table.Td>
                    <Table.Td>{db.editable && <RowMenu label="Expiry actions" onRemove={() => setRemoving({ what: `Stop expiring ${t.collection}`,
                      next: { ...s, ttl: s.ttl.filter((_, k) => k !== n) } })} />}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ))}
      </Paper>
      <AddIndexDialog opened={adding} expiry={view === "expiry"} onClose={() => setAdding(false)}
        onAdd={(next) => { setAdding(false); setRemoving(next(s)); }} />
      <ReasonDialog change={removing} onClose={() => setRemoving(null)} onSave={(reason) => db.save(reason, removing!.next)} />
    </Stack>
  );
}

function RowMenu({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={label}><IconDots size={16} /></ActionIcon></Menu.Target>
      <Menu.Dropdown><Menu.Item color="red" onClick={onRemove}>Remove</Menu.Item></Menu.Dropdown>
    </Menu>
  );
}

/** An index or expiry rule to add: collection, fields; then the reason (the change is a new version). */
function AddIndexDialog({ opened, expiry, onClose, onAdd }: {
  opened: boolean; expiry: boolean; onClose: () => void; onAdd: (next: (s: DatabaseSettings) => { what: string; next: DatabaseSettings }) => void;
}) {
  const [collection, setCollection] = useState("");
  const [fields, setFields] = useState("");
  const [group, setGroup] = useState(false);
  const [contains, setContains] = useState(false);
  const reset = () => { setCollection(""); setFields(""); setGroup(false); setContains(false); };
  const ok = !!collection.trim() && !!fields.trim();
  const add = () => {
    const c = collection.trim();
    onAdd((s) => expiry
      ? { what: `Expire ${c} by ${fields.trim()}`, next: { ...s, ttl: [...s.ttl, { collection: c, field: fields.trim() }] } }
      : { what: `Add an index on ${c} (${fields.trim()})`, next: { ...s, indexes: [...s.indexes, contains
        ? { collection: c, fields: [{ path: fields.trim().split(/[\s,]+/)[0], direction: "asc" as const }], kind: "array" as const, collectionGroup: group }
        : { collection: c, fields: parseFields(fields), kind: "ordered" as const, collectionGroup: group }] } });
    reset();
  };
  return (
    <Modal opened={opened} onClose={() => { reset(); onClose(); }} radius="lg" title={<Text fw={700} fz={18}>{expiry ? "Add expiry" : "Add an index"}</Text>}>
      <Stack gap="md">
        <TextInput label="Collection" placeholder="patients" data-autofocus value={collection} onChange={(e) => setCollection(e.currentTarget.value)}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} />
        <TextInput label={expiry ? "Field with the time" : contains ? "List field" : "Fields"} placeholder={expiry ? "expiresAt" : contains ? "tags" : "ward, admittedAt desc"}
          description={expiry ? undefined : contains ? "Queries asking whether the list contains a value." : "In order, separated by commas; add desc to sort newest first."}
          value={fields} onChange={(e) => setFields(e.currentTarget.value)} styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} />
        {!expiry && (
          <Group gap="lg">
            <Switch label="Every collection with this name (a group)" checked={group} onChange={(e) => setGroup(e.currentTarget.checked)} />
            <Switch label="List contains" checked={contains} onChange={(e) => setContains(e.currentTarget.checked)} />
          </Group>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button disabled={!ok} onClick={add}>Continue</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** A one-off change, saved as a new version with a reason. */
function ReasonDialog({ change, onClose, onSave }: { change: { what: string } | null; onClose: () => void; onSave: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setReason(""); setError(null); onClose(); };
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave(reason.trim()); close(); } catch (e) { setError(errorWithList(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={!!change} onClose={close} radius="lg" title={<Text fw={700} fz={18}>{change?.what}</Text>}>
      <Stack gap="md">
        <TextInput label="Why?" placeholder="Why are you making this change?" data-autofocus value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type Props = { draft: DatabaseSettings; set: (d: DatabaseSettings) => void; editable: boolean };

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
    // Back to the text last checked (an undo, say): nothing to check, and not "Checking…" either.
    if (text === checkedText.current) { setChecking(false); return; }
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
          style={{ background: "var(--w-pill-off-bg)", borderColor: "var(--w-pill-off-bd)" }}>
          <Group gap={8} mb="sm">
            <IconWand size={18} color="var(--w-pill-off-fg)" />
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
