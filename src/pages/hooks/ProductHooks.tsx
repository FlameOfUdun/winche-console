import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Chip, Code, Group, Loader, Modal, Paper, SegmentedControl, Stack, Switch, Table, Text, TextInput,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import { variablesFor, type Hook, type HooksPageData, type HookTestResult } from "../../api/hooks";
import { when } from "../authentication/UsersView";
import { EmptyState } from "../../components/EmptyState";
import { IconSend, IconWebhook } from "@tabler/icons-react";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = () => Math.random().toString(36).slice(2, 10);
const EVENT_LABEL: Record<string, string> = {
  created: "created", updated: "updated", deleted: "deleted", uploaded: "uploaded", metadataUpdated: "metadata changed",
  disabled: "disabled", enabled: "enabled", claimsChanged: "claims changed", signedIn: "signed in",
  released: "published", channelMoved: "pointed at by a channel",
};

/** Which product's events a Webhooks tab is about: "database", "storage", "auth" or "assets". */
export type HookSource = "database" | "storage" | "auth" | "assets";

/**
 * A product's Webhooks tab (Authentication, Database, Storage): when its documents, files or users change, call an
 * address of yours; and the deliveries. To do something on the server instead, write a function with that trigger.
 */
export function ProductHooks({ source }: { source: HookSource }) {
  const [view, setView] = useState("hooks");
  return (
    <Stack gap="md">
      <SegmentedControl w="fit-content" value={view} onChange={setView} aria-label="Webhooks view"
        data={[{ value: "hooks", label: "Webhooks" }, { value: "deliveries", label: "Deliveries" }]} />
      {view === "hooks" && <HooksList source={source} />}
      {view === "deliveries" && <Deliveries source={source} />}
    </Stack>
  );
}

function describe(h: Hook, d: HooksPageData): { when: string; then: string } {
  const source = d.sources.find((s) => s.name === h.when.source);
  const events = h.when.events.length ? h.when.events.map((e) => EVENT_LABEL[e] ?? e).join(" or ") : "changed";
  const what = source?.name === "auth" ? "a user is" : source?.name === "storage" ? "a file is" : source?.name === "assets" ? "a release is" : "a document is";
  const where = h.when.path ? ` at ${h.when.path}` : "";
  return { when: `When ${what} ${events}${where}`, then: `call ${h.do.url}` };
}

function HooksList({ source: only }: { source: HookSource }) {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["hooks"], queryFn: api.hooks });
  const [draft, setDraft] = useState<Hook[] | null>(null);
  const [editing, setEditing] = useState<Hook | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { if (page.data) setDraft(clone(page.data.settings.hooks)); }, [page.data]);
  const dirty = useMemo(() => !!page.data && !!draft && JSON.stringify(page.data.settings.hooks) !== JSON.stringify(draft), [page.data, draft]);

  if (page.isLoading || (page.data && !draft)) return <Loader size="sm" />;
  if (page.isError || !page.data || !draft) return <Alert color="red">Couldn't load the webhooks: {errorMessage(page.error)}</Alert>;
  const d = page.data;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.saveHooks(draft, reason.trim(), d.version?.number ?? 0);
      setReason("");
      setNotice(`Saved as version ${v.number}. Webhooks apply on every server within seconds.`);
      await qc.invalidateQueries({ queryKey: ["hooks"] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };
  const available = d.sources.some((s) => s.name === only);
  const mine = draft.filter((h) => h.when.source === only);
  const addHook = () => setEditing({
    id: newId(), name: "", enabled: true, when: { source: only, events: [], path: null }, do: { kind: "webhook", url: "", options: {} },
  });
  const put = (h: Hook) => setDraft(draft.some((x) => x.id === h.id) ? draft.map((x) => (x.id === h.id ? h : x)) : [...draft, h]);

  return (
    <Stack gap="md">
      {!d.editable && <Alert color="gray">Read-only. {d.whyReadOnly}</Alert>}
      {!available && <Alert color="yellow">This server doesn't pass these events to webhooks.</Alert>}
      {mine.length === 0 && (
        <EmptyState icon={IconWebhook} title="No webhooks yet"
          description={`When ${only === "database" ? "documents" : only === "storage" ? "files" : only === "assets" ? "releases or channels" : "users"} change, call an address of yours.`}
          action={d.editable && <Button disabled={!available} onClick={addHook}>Add webhook</Button>} />
      )}
      {mine.map((h) => {
        const text = describe(h, d);
        const counts = d.counts[h.id] ?? {};
        const saved = d.settings.hooks.some((x) => x.id === h.id);
        return (
          <Paper key={h.id} withBorder p="sm" data-testid="hook">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Group gap="xs">
                  <Text fw={600}>{h.name}</Text>
                  {!h.enabled && <Badge color="gray" variant="light" tt="none">off</Badge>}
                  {!saved && <Badge color="winche" variant="light" tt="none">not saved</Badge>}
                </Group>
                <Text size="sm">{text.when}, {text.then}.</Text>
                {saved && (
                  <Text size="xs" c="dimmed">
                    Last day: {counts.delivered ?? 0} delivered{counts.pending ? `, ${counts.pending} waiting` : ""}{counts.failed ? `, ${counts.failed} failed` : ""}
                  </Text>
                )}
              </Stack>
              {d.editable && (
                <Group gap={6} wrap="nowrap">
                  <Switch size="xs" aria-label={`Turn ${h.name} ${h.enabled ? "off" : "on"}`} checked={h.enabled} onChange={(e) => put({ ...h, enabled: e.currentTarget.checked })} />
                  <Button size="xs" variant="default" onClick={() => setEditing(clone(h))}>Edit</Button>
                  <Button size="xs" variant="subtle" color="red" onClick={() => setDraft(draft.filter((x) => x.id !== h.id))}>Remove</Button>
                </Group>
              )}
            </Group>
            {saved && <SigningSecret id={h.id} editable={d.editable} />}
          </Paper>
        );
      })}
      <Modal opened={!!editing} onClose={() => setEditing(null)} size="xl" radius="lg"
        title={<Text fw={700} fz={18}>{editing && draft.some((x) => x.id === editing.id) ? `Edit ${editing.name || "webhook"}` : "Add a webhook"}</Text>}>
        {editing && <HookEditor initial={editing} data={d} fixedSource onDone={(h) => { put(h); setEditing(null); }} onCancel={() => setEditing(null)} />}
      </Modal>
      {d.editable && mine.length > 0 && (
        <Button w="fit-content" variant="default" disabled={!available} onClick={addHook}>Add webhook</Button>
      )}
      {d.editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="hooks-save-bar" style={{ borderColor: dirty ? "var(--w-accent)" : undefined, position: "sticky", bottom: 8 }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 280px" }}
                  value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Button loading={busy} disabled={!reason.trim() || !!editing} onClick={save}>Save changes</Button>
                <Button variant="subtle" disabled={busy} onClick={() => { setDraft(clone(d.settings.hooks)); setEditing(null); setError(null); }}>Discard</Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function SigningSecret({ id, editable }: { id: string; editable: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<{ secret: string }>) => {
    setError(null);
    try { setSecret((await f()).secret); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Group gap="xs" mt={6}>
      <Text size="xs" c="dimmed">Signing secret:</Text>
      {secret ? <Code data-testid="hook-secret">{secret}</Code> : <Button size="compact-xs" variant="subtle" onClick={() => run(() => api.hookSecret(id))}>Show</Button>}
      {editable && <Button size="compact-xs" variant="subtle" color="red"
        onClick={() => window.confirm("Make a new signing secret? Your receiver must switch to it: until then it will reject deliveries.") && run(() => api.rotateHookSecret(id))}>New secret</Button>}
      {error && <Text size="xs" c="red">{error}</Text>}
    </Group>
  );
}

function HookEditor({ initial, data, onDone, onCancel, fixedSource = false }: {
  initial: Hook; data: HooksPageData; onDone: (h: Hook) => void; onCancel: () => void; fixedSource?: boolean;
}) {
  const [h, setH] = useState<Hook>(initial);
  const [test, setTest] = useState<HookTestResult | "testing" | null>(null);
  const source = data.sources.find((s) => s.name === h.when.source);
  const vars = variablesFor(h, data.sources);
  const set = (patch: Partial<Hook>) => { setH({ ...h, ...patch }); setTest(null); };
  const setWhen = (patch: Partial<Hook["when"]>) => set({ when: { ...h.when, ...patch } });
  const setDo = (patch: Partial<Hook["do"]>) => set({ do: { ...h.do, ...patch } });
  const ready = !!h.name.trim() && /^https?:\/\/.+/.test(h.do.url ?? "");

  const runTest = async () => {
    setTest("testing");
    try { setTest(await api.testHook(h)); }
    catch (e) { setTest({ ok: false, ran: false, result: errorWithList(e), sample: null }); }
  };

  return (
    <Paper p={0} data-testid="hook-editor">
      <Stack gap="sm">
        <TextInput label="Name" placeholder="Tell the shipping system about new orders" value={h.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <Text fw={600} size="sm">When</Text>
        {!fixedSource && <SegmentedControl size="xs" w="fit-content" aria-label="Source" value={h.when.source}
          data={data.sources.map((s) => ({ value: s.name, label: s.title }))}
          onChange={(v) => set({ when: { source: v, events: [], path: null } })} />}
        <Chip.Group multiple value={h.when.events} onChange={(v) => setWhen({ events: v })}>
          <Group gap={6}>
            {source?.events.map((e) => <Chip key={e} value={e} size="xs">{EVENT_LABEL[e] ?? e}</Chip>)}
            <Text size="xs" c="dimmed">{h.when.events.length === 0 ? "none picked: every event" : ""}</Text>
          </Group>
        </Chip.Group>
        {source?.hasPaths && (
          <TextInput label="Path (optional)" placeholder={source.name === "storage" ? "uploads/{userId}/{file=**}" : "orders/{orderId}"}
            description="{name} matches one part, {name=**} the rest. Empty: every path."
            value={h.when.path ?? ""} onChange={(e) => setWhen({ path: e.currentTarget.value || null })} />
        )}
        <Text fw={600} size="sm">Call</Text>
        <TextInput label="Address" placeholder="https://api.example.com/winche-hooks"
          value={h.do.url ?? ""} onChange={(e) => setDo({ url: e.currentTarget.value })} />
        {vars.length > 0 && (
          <Group gap={4} data-testid="hook-vars">
            <Text size="xs" c="dimmed">Vars</Text>
            {vars.map((v) => <Code key={v} fz="xs">{`{${v}}`}</Code>)}
          </Group>
        )}
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={!ready} loading={test === "testing"} onClick={runTest}>Send a test</Button>
          <Button size="xs" disabled={!ready} onClick={() => onDone({ ...h, name: h.name.trim() })}>Done</Button>
          <Button size="xs" variant="subtle" onClick={onCancel}>Cancel</Button>
        </Group>
        {test && test !== "testing" && (
          <Alert color={test.ok ? "teal" : "red"} data-testid="hook-test" style={{ whiteSpace: "pre-line" }}>
            {test.ran
              ? `${test.ok ? "Delivered" : "Not delivered"}${test.status ? ` (${test.status})` : ""} in ${test.durationMs} ms${test.result ? `: ${test.result}` : ""}`
              : test.result}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

function Deliveries({ source }: { source: HookSource }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const list = useQuery({
    queryKey: ["hook-deliveries", status], queryFn: () => api.hookDeliveries(undefined, status === "all" ? undefined : status), refetchInterval: 5000,
  });
  const [open, setOpen] = useState<string | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  if (list.isError) return <Alert color="red">Couldn't load deliveries: {errorMessage(list.error)}</Alert>;
  const rows = (list.data?.deliveries ?? []).filter((r) => r.source === source);
  return (
    <Stack gap="sm">
      <SegmentedControl size="xs" w="fit-content" value={status} onChange={setStatus} aria-label="Status"
        data={[{ value: "all", label: "All" }, { value: "failed", label: "Failed" }, { value: "pending", label: "Waiting" }, { value: "delivered", label: "Delivered" }]} />
      {rows.length === 0 ? (
        <EmptyState icon={IconSend} title={status === "all" ? "No deliveries yet" : "None here"}
          description={status === "all" ? "Each delivery shows here." : "No deliveries with this status."} compact={status !== "all"} />
      ) : (
        <Paper withBorder style={{ overflowX: "auto" }}>
          <Table fz="sm" verticalSpacing={6} miw={760}>
            <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Hook</Table.Th><Table.Th>Event</Table.Th><Table.Th>Result</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <Table.Tr data-testid="delivery" onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: "pointer" }}>
                    <Table.Td><Text size="xs">{when(r.createdAt)}</Text></Table.Td>
                    <Table.Td>{r.hookName}</Table.Td>
                    <Table.Td><Text size="xs">{r.source}.{r.type}{r.path ? ` · ${r.path}` : ""}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Badge variant="light" tt="none" color={r.status === "delivered" ? "teal" : r.status === "failed" ? "red" : "yellow"}>
                          {r.status === "pending" ? (r.attempts ? `retrying (${r.attempts} ${r.attempts === 1 ? "try" : "tries"} so far)` : "waiting") : r.status}
                        </Badge>
                        <Text size="xs" c="dimmed" lineClamp={1}>{r.lastStatus ? `${r.lastStatus} ` : ""}{r.lastResult ?? ""}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      {r.status !== "pending" && (
                        <Button size="compact-xs" variant="subtle" onClick={async (e) => { e.stopPropagation(); await api.retryHookDelivery(r.id); await qc.invalidateQueries({ queryKey: ["hook-deliveries"] }); }}>
                          {r.status === "failed" ? "Retry" : "Send again"}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                  {open === r.id && (
                    <Table.Tr>
                      <Table.Td colSpan={5}><Code block>{JSON.stringify(r.event, null, 2)}</Code></Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
