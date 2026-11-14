import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Chip, Code, Group, Loader, Modal, Paper, SegmentedControl, Select, Stack, Switch, Table, Tabs, Text, TextInput,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import { variablesFor, type FeedDeadLetter, type Hook, type HookActionInfo, type HooksPageData, type HookTestResult } from "../../api/hooks";
import { when } from "../authentication/UsersView";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { IconPlugConnected, IconSend, IconWebhook } from "@tabler/icons-react";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = () => Math.random().toString(36).slice(2, 10);
const EVENT_LABEL: Record<string, string> = {
  created: "created", updated: "updated", deleted: "deleted", uploaded: "uploaded", metadataUpdated: "metadata changed",
  disabled: "disabled", enabled: "enabled", claimsChanged: "claims changed", signedIn: "signed in",
};

/** Hooks: when documents, files or users change, call a webhook or run a ready-made action. */
export function HooksPage() {
  const [tab, setTab] = useState<string | null>("hooks");
  return (
    <Stack gap="sm">
      <PageHeader eyebrow="Build" title="Hooks"
        description="When documents, files or users change, call an address of yours or run a ready-made action. Delivered at least once, retried on failure." />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="hooks">Hooks</Tabs.Tab>
          <Tabs.Tab value="deliveries">Deliveries</Tabs.Tab>
          <Tabs.Tab value="in-app">In the app</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="hooks"><HooksList /></Tabs.Panel>
        <Tabs.Panel value="deliveries"><Deliveries /></Tabs.Panel>
        <Tabs.Panel value="in-app"><InApp /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function describe(h: Hook, d: HooksPageData): { when: string; then: string } {
  const source = d.sources.find((s) => s.name === h.when.source);
  const events = h.when.events.length ? h.when.events.map((e) => EVENT_LABEL[e] ?? e).join(" or ") : "changed";
  const what = source?.name === "auth" ? "a user is" : source?.name === "storage" ? "a file is" : "a document is";
  const where = h.when.path ? ` at ${h.when.path}` : "";
  const action = d.actions.find((a) => a.name === h.do.kind);
  return {
    when: `When ${what} ${events}${where}`,
    then: h.do.kind === "webhook" ? `call ${h.do.url}` : `${action?.title.toLowerCase() ?? h.do.kind}${Object.values(h.do.options).length ? `: ${Object.values(h.do.options).join(", ")}` : ""}`,
  };
}

function HooksList() {
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
  if (page.isError || !page.data || !draft) return <Alert color="red">Couldn't load the hooks: {errorMessage(page.error)}</Alert>;
  const d = page.data;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.saveHooks(draft, reason.trim());
      setReason("");
      setNotice(`Saved as version ${v.number}. Hooks apply on every server within seconds.`);
      await qc.invalidateQueries({ queryKey: ["hooks"] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };
  const addHook = () => setEditing({
    id: newId(), name: "", enabled: true, when: { source: d.sources[0]?.name ?? "database", events: [], path: null }, do: { kind: "webhook", url: "", options: {} },
  });
  const put = (h: Hook) => setDraft(draft.some((x) => x.id === h.id) ? draft.map((x) => (x.id === h.id ? h : x)) : [...draft, h]);

  return (
    <Stack gap="md">
      {!d.editable && <Alert color="gray">Read-only. {d.whyReadOnly}</Alert>}
      {d.sources.length === 0 && <Alert color="yellow">No events reach hooks yet: add the Winche.Webhooks adapters for the database, storage or auth.</Alert>}
      {draft.length === 0 && (
        <EmptyState icon={IconWebhook} title="No hooks yet"
          description="When documents, files or users change, call an address of yours or run a ready-made action."
          action={d.editable && <Button disabled={d.sources.length === 0} onClick={addHook}>Add hook</Button>} />
      )}
      {draft.map((h) => {
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
                  {!saved && <Badge color="blue" variant="light" tt="none">not saved</Badge>}
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
            {h.do.kind === "webhook" && saved && <SigningSecret id={h.id} editable={d.editable} />}
          </Paper>
        );
      })}
      <Modal opened={!!editing} onClose={() => setEditing(null)} size="xl" radius="lg"
        title={<Text fw={700} fz={18}>{editing && draft.some((x) => x.id === editing.id) ? `Edit ${editing.name || "hook"}` : "Add a hook"}</Text>}>
        {editing && <HookEditor initial={editing} data={d} onDone={(h) => { put(h); setEditing(null); }} onCancel={() => setEditing(null)} />}
      </Modal>
      {d.editable && draft.length > 0 && (
        <Button w="fit-content" variant="default" disabled={d.sources.length === 0} onClick={addHook}>Add hook</Button>
      )}
      {d.editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="hooks-save-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined, position: "sticky", bottom: 8 }}>
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

function HookEditor({ initial, data, onDone, onCancel }: { initial: Hook; data: HooksPageData; onDone: (h: Hook) => void; onCancel: () => void }) {
  const [h, setH] = useState<Hook>(initial);
  const [test, setTest] = useState<HookTestResult | "testing" | null>(null);
  const source = data.sources.find((s) => s.name === h.when.source);
  const actions = data.actions.filter((a) => a.sources.length === 0 || a.sources.includes(h.when.source));
  const action: HookActionInfo | undefined = data.actions.find((a) => a.name === h.do.kind);
  const vars = variablesFor(h, data.sources);
  const set = (patch: Partial<Hook>) => { setH({ ...h, ...patch }); setTest(null); };
  const setWhen = (patch: Partial<Hook["when"]>) => set({ when: { ...h.when, ...patch } });
  const setDo = (patch: Partial<Hook["do"]>) => set({ do: { ...h.do, ...patch } });
  const ready = !!h.name.trim() && (h.do.kind === "webhook" ? /^https?:\/\/.+/.test(h.do.url ?? "") : !!action && action.options.every((o) => !o.required || h.do.options[o.name]?.trim()));

  const runTest = async () => {
    setTest("testing");
    try { setTest(await api.testHook(h)); }
    catch (e) { setTest({ ok: false, ran: false, result: errorWithList(e), sample: null }); }
  };

  return (
    <Paper p={0} data-testid="hook-editor">
      <Stack gap="sm">
        <TextInput label="Name" placeholder="Tell the ward system about new visits" value={h.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <Text fw={600} size="sm">When</Text>
        <SegmentedControl size="xs" w="fit-content" aria-label="Source" value={h.when.source}
          data={data.sources.map((s) => ({ value: s.name, label: s.title }))}
          onChange={(v) => set({ when: { source: v, events: [], path: null }, do: actions.some((a) => a.name === h.do.kind) || h.do.kind === "webhook" ? h.do : { kind: "webhook", url: "", options: {} } })} />
        <Chip.Group multiple value={h.when.events} onChange={(v) => setWhen({ events: v })}>
          <Group gap={6}>
            {source?.events.map((e) => <Chip key={e} value={e} size="xs">{EVENT_LABEL[e] ?? e}</Chip>)}
            <Text size="xs" c="dimmed">{h.when.events.length === 0 ? "none picked: every event" : ""}</Text>
          </Group>
        </Chip.Group>
        {source?.hasPaths && (
          <TextInput label="Path (optional)" placeholder={source.name === "storage" ? "uploads/{userId}/{file=**}" : "patients/{patientId}"}
            description="{name} matches one part and can be used below; {name=**} matches the rest. Empty: every path."
            value={h.when.path ?? ""} onChange={(e) => setWhen({ path: e.currentTarget.value || null })} />
        )}
        <Text fw={600} size="sm">Do</Text>
        <SegmentedControl size="xs" w="fit-content" aria-label="Action kind" value={h.do.kind === "webhook" ? "webhook" : "action"}
          data={[{ value: "webhook", label: "Call a webhook" }, { value: "action", label: "Ready-made action", disabled: actions.length === 0 }]}
          onChange={(v) => setDo(v === "webhook" ? { kind: "webhook", options: {} } : { kind: actions[0]?.name ?? "", url: null, options: {} })} />
        {h.do.kind === "webhook" ? (
          <TextInput label="Address" placeholder="https://api.example.com/winche-hooks" description="Gets a signed POST with the event as JSON."
            value={h.do.url ?? ""} onChange={(e) => setDo({ url: e.currentTarget.value })} />
        ) : (
          <>
            <Select label="Action" allowDeselect={false} value={h.do.kind} data={actions.map((a) => ({ value: a.name, label: a.title }))}
              onChange={(v) => setDo({ kind: v ?? "", options: {} })} />
            {action && <Text size="xs" c="dimmed">{action.description}</Text>}
            {action?.options.map((o) => (
              <TextInput key={o.name} label={o.label} placeholder={o.placeholder ?? undefined} description={o.help ?? undefined}
                value={h.do.options[o.name] ?? ""} onChange={(e) => setDo({ options: { ...h.do.options, [o.name]: e.currentTarget.value } })} />
            ))}
          </>
        )}
        {vars.length > 0 && <Text size="xs" c="dimmed">Can use: {vars.map((v) => `{${v}}`).join(" ")}</Text>}
        <Group gap="xs">
          <Button size="xs" variant="default" disabled={!ready} loading={test === "testing"} onClick={runTest}>{h.do.kind === "webhook" ? "Send a test" : "Check"}</Button>
          <Button size="xs" disabled={!ready} onClick={() => onDone({ ...h, name: h.name.trim() })}>Done</Button>
          <Button size="xs" variant="subtle" onClick={onCancel}>Cancel</Button>
        </Group>
        {test && test !== "testing" && (
          <Alert color={test.ok ? "teal" : "red"} data-testid="hook-test" style={{ whiteSpace: "pre-line" }}>
            {test.ran
              ? `${test.ok ? "Delivered" : "Not delivered"}${test.status ? ` (${test.status})` : ""} in ${test.durationMs} ms${test.result ? `: ${test.result}` : ""}`
              : test.options ? `With a sample event it would run with ${Object.entries(test.options).map(([k, v]) => `${k} = ${v}`).join(", ")}. (Not run: it changes data.)` : test.result}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

function Deliveries() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const list = useQuery({
    queryKey: ["hook-deliveries", status], queryFn: () => api.hookDeliveries(undefined, status === "all" ? undefined : status), refetchInterval: 5000,
  });
  const [open, setOpen] = useState<string | null>(null);
  if (list.isLoading) return <Loader size="sm" />;
  if (list.isError) return <Alert color="red">Couldn't load deliveries: {errorMessage(list.error)}</Alert>;
  const rows = list.data?.deliveries ?? [];
  return (
    <Stack gap="sm">
      <SegmentedControl size="xs" w="fit-content" value={status} onChange={setStatus} aria-label="Status"
        data={[{ value: "all", label: "All" }, { value: "failed", label: "Failed" }, { value: "pending", label: "Waiting" }, { value: "delivered", label: "Delivered" }]} />
      {rows.length === 0 ? (
        <EmptyState icon={IconSend} title={status === "all" ? "No deliveries yet" : "None here"}
          description={status === "all" ? "Each time a hook fires, its delivery shows here with how it went." : "No deliveries with this status."} compact={status !== "all"} />
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
                          {r.status === "pending" ? (r.attempts ? `retrying (${r.attempts} tries)` : "waiting") : r.status}
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

/** Hooks inside the app (the database's and storage's, and published changes): how far behind, and what they gave up on. */
function InApp() {
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.feeds, refetchInterval: 5000 });
  if (feeds.isLoading) return <Loader size="sm" />;
  if (feeds.isError) return <Alert color="red">Couldn't load background deliveries: {errorMessage(feeds.error)}</Alert>;
  const rows = (feeds.data?.feeds ?? []).flatMap((f) => f.consumers.map((c) => ({ feed: f.feed, ...c })));
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Code in the app that reacts to changes: the database's and storage's hooks, and the changes they pass on to hooks here
        and to functions. Each takes changes in order; one that keeps failing for an hour is set aside so the rest go on.
      </Text>
      {rows.length === 0 ? <EmptyState compact icon={IconPlugConnected} title="None in this app" /> : (
        <Paper withBorder style={{ overflowX: "auto" }}>
          <Table fz="sm" verticalSpacing={6} miw={640}>
            <Table.Thead><Table.Tr><Table.Th>From</Table.Th><Table.Th>Consumer</Table.Th><Table.Th>State</Table.Th><Table.Th>Set aside</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={`${r.feed}/${r.name}`} data-testid="feed-consumer">
                  <Table.Td>{r.feed}</Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{r.name}</Text></Table.Td>
                  <Table.Td>
                    {r.failingSince
                      ? <Badge color="red" variant="light" tt="none" title={r.lastError ?? undefined}>failing since {when(r.failingSince)} ({r.failingAttempts} tries)</Badge>
                      : r.oldestPendingAt
                        ? <Badge color="yellow" variant="light" tt="none">{r.lagSeconds}s behind</Badge>
                        : <Badge color="teal" variant="light" tt="none">up to date</Badge>}
                  </Table.Td>
                  <Table.Td>{r.deadLetters > 0 ? <Badge color="red" variant="outline">{r.deadLetters}</Badge> : <Text size="xs" c="dimmed">none</Text>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      {(feeds.data?.feeds ?? []).filter((f) => f.consumers.some((c) => c.deadLetters > 0)).map((f) => <SetAside key={f.feed} feed={f.feed} />)}
    </Stack>
  );
}

function SetAside({ feed }: { feed: string }) {
  const qc = useQueryClient();
  const letters = useQuery({ queryKey: ["feed-dead-letters", feed], queryFn: () => api.feedDeadLetters(feed) });
  const [open, setOpen] = useState<number | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["feeds"] }), qc.invalidateQueries({ queryKey: ["feed-dead-letters", feed] })]);
  const rows: FeedDeadLetter[] = letters.data?.deadLetters ?? [];
  const consumers = [...new Set(rows.map((r) => r.consumer))];
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text fw={600} size="sm">Set aside in {feed}</Text>
        <Group gap={6}>
          {consumers.map((c) => (
            <Button key={c} size="compact-xs" variant="light" onClick={async () => { await api.retryFeedDeadLetters(feed, c); await refresh(); }}>
              Retry {consumers.length > 1 ? c : "all"}
            </Button>
          ))}
        </Group>
      </Group>
      <Paper withBorder style={{ overflowX: "auto" }}>
        <Table fz="sm" verticalSpacing={6} miw={640}>
          <Table.Tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <Table.Tr data-testid="dead-letter" onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: "pointer" }}>
                  <Table.Td><Text size="xs">{when(r.deadLetteredAt)}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{r.consumer}</Text></Table.Td>
                  <Table.Td><Text size="xs">{String(r.record.type ?? "")} {String(r.record.path ?? "")}</Text></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed" lineClamp={1}>{r.error?.split("\n")[0]}</Text></Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-xs" variant="subtle" color="red"
                      onClick={async (e) => { e.stopPropagation(); if (window.confirm("Discard this change? Its hook won't get it.")) { await api.discardFeedDeadLetter(feed, r.id); await refresh(); } }}>
                      Discard
                    </Button>
                  </Table.Td>
                </Table.Tr>
                {open === r.id && (
                  <Table.Tr>
                    <Table.Td colSpan={5}><Code block>{JSON.stringify(r.record, null, 2)}{"\n\n"}{r.error}</Code></Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
