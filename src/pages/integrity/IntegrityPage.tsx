import { useEffect, useRef, useState, type ReactNode } from "react";
import { FieldRow } from "../../components/FieldRow";
import {
  ActionIcon, Alert, Badge, Button, Code, FileButton, Group, Loader, Menu, Modal, NumberInput, Paper, SegmentedControl, Select, Stack, Switch, Table,
  Tabs, TagsInput, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import {
  IconApps, IconBrandAndroid, IconBrandApple, IconDots, IconDownload,
  IconKey, IconLock, IconPencil, IconPlus, IconTrash, IconWorld,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { AndroidDeviceLevel, AppFields, IntegrityApp, IntegrityData, IntegrityMode, Usage } from "../../api/apps";
import { secretBody } from "../../api/secrets";
import { ConfirmModal } from "../../components/ConfirmModal";
import { Copy } from "../../components/Copy";
import { useOnTop } from "../../components/dialogStack";
import { EditCard } from "../../components/EditCard";
import { EmptyState } from "../../components/EmptyState";
import { ScrollDialog } from "../../components/ScrollDialog";
import { SecretInput } from "../../components/SecretInput";
import { isProjectId, projectIdFrom } from "../../api/project";
import { surface } from "../../theme";

const INTEGRITY = ["integrity"];

/** The guides to connect an app, one per SDK: Flutter today; the rest greyed out until they exist. Nothing is stored about it. */
const GUIDES: { id: string; label: string; ready: boolean }[] = [
  { id: "flutter", label: "Flutter", ready: true },
  { id: "android", label: "Android", ready: false },
  { id: "ios", label: "iOS", ready: false },
  { id: "web", label: "Web", ready: false },
  { id: "windows", label: "Windows", ready: false },
];
const ALL_PLATFORMS = ["android", "ios", "macos", "web", "windows", "linux"];

const PRODUCT_LABEL: Record<string, string> = {
  database: "Database", storage: "Storage", authentication: "Authentication", functions: "Functions", assets: "Assets",
};
const MODES: { value: IntegrityMode; label: string }[] = [
  { value: "off", label: "Off" }, { value: "monitor", label: "Monitor" }, { value: "enforce", label: "Enforce" },
];
const MODE_TEXT: Record<IntegrityMode, string> = {
  off: "Not checked", monitor: "Checked and counted, never refused", enforce: "Refused without a valid token",
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** All products' requests added up. */
const total = (u: Record<string, Usage>): Usage | null => {
  const all = Object.values(u);
  if (all.length === 0) return null;
  const last = all.map((x) => x.lastSeen).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { today: all.reduce((n, x) => n + x.today, 0), last7Days: all.reduce((n, x) => n + x.last7Days, 0), lastSeen: last };
};
const usageLine = (u: Usage | null) =>
  !u ? "No verified requests yet" : `${u.today.toLocaleString()} verified requests today · ${u.last7Days.toLocaleString()} this week · last seen ${ago(u.lastSeen)}`;

/**
 * Integrity: the project's apps, which prove they're its own to get a token they send with every request; how each
 * product treats requests without one; and debug tokens for simulators, desktop builds and CI.
 */
export function IntegrityPage() {
  const integrity = useQuery({ queryKey: INTEGRITY, queryFn: api.integrity });
  const page = useQuery({ queryKey: ["apps", "android,ios,web"], queryFn: () => api.apps(["android", "ios", "web"]) });
  const d = integrity.data;
  return (
    <Stack gap="lg" maw={1100} pb={40}>
      <div>
        <Title order={1} fz={24}>Integrity</Title>
        <Text size="sm" c={surface.muted} mt={4} maw={720}>
          Proof that requests come from your own apps, not a copy, a script or someone's curl. Each app proves itself, gets
          a token that lasts {d ? `${d.tokenMinutes} minutes` : "a while"}, and sends it with every request. Watch the counts
          in Monitor, then enforce a product once your apps all send tokens.
        </Text>
      </div>
      {(integrity.isLoading || page.isLoading) && <Loader size="sm" />}
      {integrity.error && <Alert color="red">Couldn't load Integrity: {errorMessage(integrity.error)}</Alert>}
      {d && !d.available && <Alert color="gray">Integrity is set up once this console runs project setup.</Alert>}
      {d?.available && !d.canSign && <Alert color="yellow">This server has no master key, so it can't make Integrity tokens: set one to use Integrity.</Alert>}
      {d?.available && page.data && (
        <>
          <Apps data={d} baseUrl={page.data.setup.baseUrl} snippet={page.data.snippet} />
          <PlayServiceAccount data={d} />
          <Enforcement data={d} />
          <DebugTokens data={d} />
        </>
      )}
    </Stack>
  );
}

/** One platform's state for an app: ready, or what's missing (shown as a chip, its detail on hover). */
interface Readiness { platform: "apple" | "android" | "web" | "debug"; label: string; detail: string; color: "teal" | "blue" | "red" | "gray"; icon: ReactNode }

/** Each platform the app is set up for: ready, or exactly what's missing; debug tokens only when none is. */
export function readiness(a: IntegrityApp, data: Pick<IntegrityData, "playServiceAccount" | "debugTokens">): Readiness[] {
  const out: Readiness[] = [];
  if (a.appleBundleId || a.appleTeamId) {
    const icon = <IconBrandApple size={12} />;
    const id = a.appleTeamId && a.appleBundleId ? `${a.appleTeamId}.${a.appleBundleId}` : a.appleBundleId ?? "";
    const dev = a.appleDevelopment ? " Development builds are accepted: turn that off before you enforce in production." : "";
    if (!a.appleTeamId || !a.appleBundleId) out.push({ platform: "apple", icon, color: "red", label: `Apple: needs its ${a.appleTeamId ? "bundle id" : "team id"}`, detail: "App Attest checks the app's Apple team id and bundle id: set both." });
    else if (!a.devices) out.push({ platform: "apple", icon, color: "blue", label: "Apple: ready, no devices yet", detail: `App Attest for ${id}. No device has attested a key yet.${dev}` });
    else out.push({ platform: "apple", icon, color: "teal", label: `Apple: ${a.devices.count.toLocaleString()} device${a.devices.count === 1 ? "" : "s"}`,
      detail: `App Attest for ${id}: ${a.devices.count} device${a.devices.count === 1 ? "" : "s"}${a.devices.development ? ` (${a.devices.development} development)` : ""}, last proof ${ago(a.devices.lastUsed)}.${dev}` });
  }
  if (a.androidPackage) {
    const icon = <IconBrandAndroid size={12} />;
    const what = `Play Integrity for ${a.androidPackage}: ${DEVICE_LEVEL[a.androidDeviceIntegrity]}${a.androidSideloaded ? ", builds from outside Google Play accepted" : ""}${a.androidCertificates.length ? `, ${a.androidCertificates.length} signing certificate${a.androidCertificates.length === 1 ? "" : "s"}` : ""}.`;
    if (!a.androidCloudProjectNumber) out.push({ platform: "android", icon, color: "red", label: "Android: needs its Cloud project number", detail: `${what} The app asks Play Integrity under the Google Cloud project: set its number.` });
    else if (!data.playServiceAccount) out.push({ platform: "android", icon, color: "red", label: "Android: needs the service account", detail: `${what} The server reads verdicts as the project's Google service account: set it under Google Play Integrity.` });
    else out.push({ platform: "android", icon, color: "teal", label: "Android: ready", detail: `${what} Cloud project ${a.androidCloudProjectNumber}.` });
  }
  if (a.webSiteKey) {
    const icon = <IconWorld size={12} />;
    const where = a.webHostnames.length ? a.webHostnames.join(", ") : "any site";
    if (!a.turnstileSecret) out.push({ platform: "web", icon, color: "red", label: "Web: needs its secret key", detail: `The browser check (Turnstile) on ${where}: set the widget's secret key.` });
    else out.push({ platform: "web", icon, color: "teal", label: "Web: ready", detail: `The browser check (Turnstile) on ${where}.` });
  }
  if (out.length === 0) {
    const tokens = data.debugTokens.filter((t) => t.app === a.id).length;
    out.push({ platform: "debug", icon: <IconKey size={12} />, color: "gray", label: tokens ? `Debug tokens only (${tokens})` : "No way to prove itself yet",
      detail: "Set its Apple, Android or web details for it to prove itself on devices and in browsers; debug tokens are for simulators, desktop builds and CI." });
  }
  return out;
}

/** The project's apps: an empty state until the first is added, then the list with each one's verified requests. */
function Apps({ data, baseUrl, snippet }: { data: IntegrityData; baseUrl: string; snippet: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<IntegrityApp | null>(null);
  const [connecting, setConnecting] = useState<IntegrityApp | null>(null);
  const [removing, setRemoving] = useState<IntegrityApp | null>(null);
  const list = data.apps;
  const editable = data.editable;
  const refresh = () => qc.invalidateQueries({ queryKey: INTEGRITY });
  const enforced = Object.values(data.enforcement).includes("enforce");

  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" align="center" gap="sm" mb={list.length ? "md" : "sm"}>
        <Title order={2} fz={16}>Apps</Title>
        {editable && list.length > 0 && <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add app</Button>}
      </Group>

      {enforced && list.some((a) => readiness(a, data).some((r) => r.color === "red")) && (
        <Alert color="yellow" p="xs" mb="sm" data-testid="enforced-not-ready">
          Some products are enforced, and not every app can prove itself yet: their requests are refused until what's marked in red is set.
        </Alert>
      )}
      {list.length === 0 && (
        <EmptyState icon={IconApps} title="No apps yet"
          description="Add your app to get its winche_options.dart. Once it sends Integrity tokens, its requests show here."
          action={editable ? <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add app</Button> : undefined} />
      )}

      {list.length > 0 && (
        <Stack gap={0}>
          {list.map((a) => (
            <Group key={a.id} justify="space-between" wrap="wrap" gap="md" py={14} data-testid="integrity-app"
              style={{ borderTop: `1px solid ${surface.subtle}` }}>
              <Group gap="md" wrap="nowrap" style={{ minWidth: 0, flex: "1 1 260px" }}>
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap={8} wrap="wrap" style={{ rowGap: 0 }}>
                    <Text fw={600} style={{ overflowWrap: "anywhere" }}>{a.name}</Text>
                    <Text size="xs" ff="monospace" c={surface.faint}>{a.id}</Text>
                    <Copy value={a.id} label="app id" />
                  </Group>
                  <Text size="xs" c={surface.muted}>{usageLine(total(a.usage))}</Text>
                  <Group gap={6} mt={4} data-testid="app-readiness">
                    {readiness(a, data).map((r) => (
                      <Tooltip key={r.platform} label={r.detail} multiline w={320} withArrow>
                        <Badge variant="light" color={r.color} tt="none" leftSection={r.icon} data-testid={`ready-${r.platform}`}>{r.label}</Badge>
                      </Tooltip>
                    ))}
                  </Group>
                </Stack>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Button size="xs" variant="default" onClick={() => setConnecting(a)}>Connect</Button>
                {editable && (
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`More for ${a.name}`}><IconDots size={16} /></ActionIcon></Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setEditing(a)}>Edit</Menu.Item>
                      <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => setRemoving(a)}>Remove</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            </Group>
          ))}
        </Stack>
      )}

      <AddAppDialog opened={adding} baseUrl={baseUrl} snippet={snippet} onClose={() => setAdding(false)} />
      <AppFormDialog app={editing} onClose={() => setEditing(null)} />
      <Modal opened={!!connecting} onClose={() => setConnecting(null)} size="lg" radius="lg" title={<Text fw={700} fz={18}>Connect {connecting?.name}</Text>}>
        {connecting && (
          <Stack gap="lg" pt="xs">
            <ConnectGuide baseUrl={baseUrl} snippet={snippet} appId={connecting.id} />
            <Group justify="flex-end"><Button onClick={() => setConnecting(null)}>Done</Button></Group>
          </Stack>
        )}
      </Modal>
      <ConfirmModal opened={!!removing} title={`Remove ${removing?.name ?? ""}?`} confirmLabel="Remove app" onCancel={() => setRemoving(null)}
        action={async () => { if (removing) await api.removeApp(removing.id); await refresh(); }}
        message={<>
          Its Integrity tokens and debug tokens stop working at once.
          {enforced ? (list.length === 1 ? " It's the last app, so enforced products go back to Monitor." : " Copies of it already installed are refused where a product is enforced.") : ""}
        </>} />
    </Paper>
  );
}

/** A product's requests: today's with and without a valid token, the last 7 days' share verified. */
function productCounts(data: IntegrityData, p: string) {
  const today = { ok: data.apps.reduce((n, a) => n + (a.usage[p]?.today ?? 0), 0), no: data.unverified[p]?.today ?? 0 };
  const ok = data.apps.reduce((n, a) => n + (a.usage[p]?.last7Days ?? 0), 0), no = data.unverified[p]?.last7Days ?? 0;
  return { today, week: { ok, no, share: ok + no === 0 ? null : Math.floor((ok / (ok + no)) * 100) } };
}

/** Ready to enforce: 99% verified over a week, and every app able to prove itself. */
function readyToEnforce(data: IntegrityData, p: string) {
  const { week } = productCounts(data, p);
  return week.share !== null && week.share >= 99 && data.apps.length > 0
    && data.apps.every((a) => !readiness(a, data).some((r) => r.color === "red"));
}

/** The verified share as a bar: teal verified, the rest without a token. */
function ShareBar({ share }: { share: number | null }) {
  return (
    <div role="img" aria-label={share === null ? "no requests yet" : `${share}% verified`}
      style={{ height: 8, width: 160, borderRadius: 999, background: share === null ? surface.subtle : "light-dark(var(--mantine-color-orange-2), rgba(253, 126, 20, 0.35))", overflow: "hidden", flexShrink: 0 }}>
      {share !== null && <div style={{ width: `${share}%`, height: "100%", background: "var(--mantine-color-teal-6)" }} />}
    </div>
  );
}

/** Each product's mode and how its requests stand; changed in a dialog. */
function Enforcement({ data }: { data: IntegrityData }) {
  const [editing, setEditing] = useState(false);
  return (
    <Paper withBorder p="lg" data-testid="integrity-enforcement">
      <Group justify="space-between" align="flex-start" gap="sm" mb="md">
        <div>
          <Title order={2} fz={16}>Enforcement</Title>
          <Text size="sm" c={surface.muted} mt={2}>How each product treats requests without a valid Integrity token.</Text>
        </div>
        {data.editable && <Button variant="default" onClick={() => setEditing(true)}>Change…</Button>}
      </Group>
      <Stack gap={0}>
        {data.products.map((p) => {
          const mode = data.enforcement[p];
          const { today, week } = productCounts(data, p);
          const refused = mode !== "enforce" && mode !== "off" && today.no > 0;
          return (
            <Group key={p} wrap="wrap" gap="md" py={10} style={{ borderTop: `1px solid ${surface.subtle}` }} data-testid={`enforcement-${p}`}>
              <Text fw={500} size="sm" w={130}>{PRODUCT_LABEL[p] ?? p}</Text>
              <Badge w={86} variant="light" color={mode === "enforce" ? "teal" : mode === "off" ? "gray" : "blue"}>{MODES.find((x) => x.value === mode)?.label}</Badge>
              {mode === "off" ? <Text size="sm" c={surface.faint}>Not checked</Text> : (
                <Stack gap={2} style={{ flex: 1, minWidth: 220 }}>
                  <Group gap="sm" wrap="nowrap">
                    <ShareBar share={week.share} />
                    <Text size="xs" c={week.share !== null && week.share < 95 ? "orange" : surface.muted} data-testid={`week-${p}`}>
                      {week.share === null ? "no requests yet" : `${week.share}% verified · 7 days`}
                    </Text>
                  </Group>
                  <Text size="xs" c={surface.muted}>
                    Today: {today.ok.toLocaleString()} verified · {today.no.toLocaleString()} without a token
                    {refused && <Text span size="xs" c="orange">{`  ⚠ ${today.no.toLocaleString()} would be refused`}</Text>}
                    {mode === "monitor" && readyToEnforce(data, p) && <Text span size="xs" c="teal">{"  ✓ ready to enforce"}</Text>}
                  </Text>
                </Stack>
              )}
            </Group>
          );
        })}
      </Stack>
      <Stack gap={4} pt="sm" style={{ borderTop: `1px solid ${surface.subtle}` }}>
        <Text size="sm">Tokens last {data.tokenMinutes} minutes</Text>
        <Text size="xs" c={surface.muted}>Never need a token: links opened from emails, users' photos, identity providers' notices, HTTP functions (webhooks) and signed file links.</Text>
      </Stack>
      {data.editable && <EnforcementDialog data={data} opened={editing} onClose={() => setEditing(false)} />}
    </Paper>
  );
}

/** Every product's mode, how long tokens last, and why: saved together, as one change in the history. */
function EnforcementDialog({ data, opened, onClose }: { data: IntegrityData; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [modes, setModes] = useState<Record<string, IntegrityMode>>(data.enforcement);
  const [minutes, setMinutes] = useState<number | string>(data.tokenMinutes);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (opened) { setModes(data.enforcement); setMinutes(data.tokenMinutes); setReason(""); setError(null); } }, [opened, data.enforcement, data.tokenMinutes]);
  const typedMinutes = typeof minutes === "number" ? minutes : null;   // cleared: the lifetime stays as it is
  const changed = data.products.some((p) => modes[p] !== data.enforcement[p]) || (typedMinutes !== null && typedMinutes !== data.tokenMinutes);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.setIntegrityEnforcement(modes, typedMinutes || data.tokenMinutes, reason.trim());
      await qc.invalidateQueries({ queryKey: INTEGRITY });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollDialog opened={opened} onClose={onClose} title="Enforcement"
      footer={<><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!changed || !reason.trim()}>Save</Button></>}>
      <Stack gap="md">
        {data.apps.length === 0 && <Alert color="gray" p="xs">Add an app before enforcing: with none, nothing could call.</Alert>}
        <Table withRowBorders={false} verticalSpacing={6}>
          <Table.Tbody>
            {data.products.map((p) => (
              <Table.Tr key={p}>
                <Table.Td w={140}><Text size="sm" fw={500}>{PRODUCT_LABEL[p] ?? p}</Text></Table.Td>
                <Table.Td>
                  <SegmentedControl size="xs" aria-label={`${PRODUCT_LABEL[p] ?? p} mode`} value={modes[p]} onChange={(v) => setModes({ ...modes, [p]: v as IntegrityMode })}
                    data={MODES.map((x) => ({ ...x, disabled: x.value === "enforce" && data.apps.length === 0 }))} />
                </Table.Td>
                <Table.Td>
                  {modes[p] === "monitor" && readyToEnforce(data, p) ? <Text size="xs" c="teal">✓ ready</Text> : <Text size="xs" c={surface.faint}>{MODE_TEXT[modes[p]]}</Text>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {data.products.filter((p) => modes[p] === "enforce" && data.enforcement[p] !== "enforce" && productCounts(data, p).week.no > 0).map((p) => (
          <Alert key={p} color="yellow" p="xs" data-testid={`enforce-warning-${p}`}>
            {PRODUCT_LABEL[p] ?? p}: {productCounts(data, p).week.no.toLocaleString()} request{productCounts(data, p).week.no === 1 ? "" : "s"} in the last 7 days had no valid token. Enforced, they'd have been refused.
          </Alert>
        ))}
        <NumberInput label="Tokens last (minutes)" description="30 minutes to 24 hours. Shorter: a stolen token is good for less time; apps prove themselves more often."
          w={300} min={30} max={1440} allowDecimal={false} allowNegative={false} value={minutes} onChange={setMinutes} />
        <TextInput label="Reason for the change" placeholder="Our apps all send tokens" value={reason} onChange={(e) => setReason(e.currentTarget.value)}
          description="Kept in the history with the change" />
        {error && <Alert color="red" p="xs">{error}</Alert>}
      </Stack>
    </ScrollDialog>
  );
}

/** Debug tokens: for places that can't prove themselves (simulators, emulators, desktop builds, CI). Shown once. */
function DebugTokens({ data }: { data: IntegrityData }) {
  const qc = useQueryClient();
  const [making, setMaking] = useState(false);
  const [app, setApp] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appName = (id: string) => data.apps.find((a) => a.id === id)?.name ?? id;
  // Which opening of the dialog a token is being made for: one that arrives after it's closed isn't shown later.
  const attempt = useRef(0);
  const close = () => { attempt.current++; setMaking(false); setApp(null); setName(""); setMade(null); setError(null); setBusy(false); };
  const make = async () => {
    const forApp = app ?? data.apps[0]?.id;
    if (!forApp) return;
    const mine = ++attempt.current;
    setBusy(true); setError(null);
    try {
      const r = await api.makeDebugToken(forApp, name.trim());
      if (mine === attempt.current) setMade({ name: r.name, token: r.token });
      await qc.invalidateQueries({ queryKey: INTEGRITY });
    } catch (e) { if (mine === attempt.current) setError(errorMessage(e)); } finally { if (mine === attempt.current) setBusy(false); }
  };
  return (
    <Paper withBorder p="lg" data-testid="integrity-debug-tokens">
      <Group justify="space-between" align="center" gap="sm" mb="xs">
        <div>
          <Title order={2} fz={16}>Debug tokens</Title>
          <Text size="sm" c={surface.muted} mt={2}>
            For simulators, emulators, desktop builds (Windows and Linux can't prove themselves) and CI. Each is for one app and is shown once.
          </Text>
        </div>
        {data.editable && data.apps.length > 0 && <Button variant="default" leftSection={<IconKey size={16} />} onClick={() => setMaking(true)}>Make debug token</Button>}
      </Group>
      {data.debugTokens.length === 0 ? (
        <Text size="sm" c={surface.faint} mt="sm">{data.apps.length === 0 ? "Add an app first." : "None yet."}</Text>
      ) : (
        <Table mt="sm" verticalSpacing={8}>
          <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>App</Table.Th><Table.Th visibleFrom="sm">Made</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {data.debugTokens.map((t) => (
              <Table.Tr key={t.id} data-testid="debug-token">
                <Table.Td><Text size="sm" fw={500}>{t.name}</Text></Table.Td>
                <Table.Td><Text size="sm">{appName(t.app)}</Text></Table.Td>
                <Table.Td visibleFrom="sm"><Text size="xs" c={surface.muted}>{when(t.createdAt)}{t.createdBy ? ` by ${t.createdBy}` : ""}</Text></Table.Td>
                <Table.Td>
                  {data.editable && (
                    <Tooltip label="Remove" withArrow>
                      <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${t.name}`} onClick={() => setRemoving({ id: t.id, name: t.name })}><IconTrash size={15} /></ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={making} onClose={close} radius="lg" closeOnEscape={!made} closeOnClickOutside={!made}
        title={<Text fw={700} fz={18}>{made ? `${made.name}: copy it now` : "Make a debug token"}</Text>}>
        {!made ? (
          <Stack gap="md">
            <Select label="For the app" data={data.apps.map((a) => ({ value: a.id, label: a.name }))} value={app ?? data.apps[0]?.id ?? null}
              onChange={setApp} allowDeselect={false} />
            <TextInput label="Name" description="Where it's used, so you know which to remove later" placeholder="Ann's simulator, CI"
              data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
            {error && <Alert color="red" p="xs">{error}</Alert>}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={close}>Cancel</Button>
              <Button onClick={make} loading={busy} disabled={!name.trim()}>Make token</Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            <Text size="sm" c={surface.muted}>It isn't shown again. Anyone with it can get Integrity tokens for this app: keep it like a password, and never ship it in a release build.</Text>
            <Group gap={4} wrap="nowrap" style={{ background: surface.subtle, borderRadius: 8, padding: "6px 6px 6px 12px" }}>
              <Text size="sm" ff="monospace" data-testid="debug-token-value" style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }}>{made.token}</Text>
              <Copy value={made.token} label="debug token" />
            </Group>
            <Text size="sm" c={surface.muted}>In the app, in debug builds only: <Code>app.useIntegrity(WincheDebugIntegrity('…'))</Code>.</Text>
            <Group justify="flex-end"><Button onClick={close}>Done</Button></Group>
          </Stack>
        )}
      </Modal>
      <ConfirmModal opened={!!removing} title={`Remove ${removing?.name ?? ""}?`} confirmLabel="Remove token" onCancel={() => setRemoving(null)}
        action={async () => { if (removing) await api.removeDebugToken(removing.id); await qc.invalidateQueries({ queryKey: INTEGRITY }); }}
        message="The Integrity tokens it got stop working at once." />
    </Paper>
  );
}

const EMPTY: AppFields = { name: "", androidPackage: null, appleBundleId: null, appleTeamId: null, appleDevelopment: false,
  androidCloudProjectNumber: null, androidSideloaded: false, androidDeviceIntegrity: "device", androidCertificates: [], webSiteKey: null, webHostnames: [] };

const DEVICE_LEVEL: Record<AndroidDeviceLevel, string> = {
  basic: "basic integrity (rooted devices may pass)", device: "device integrity", strong: "strong integrity (hardware-backed, recent security update)",
};

/**
 * The Google service account Play Integrity signs in as: its key file, pasted or picked (kept as a secret, never shown
 * again), or a reference to where it's kept.
 */
function PlayServiceAccount({ data }: { data: IntegrityData }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTop = useOnTop(open);   // not closed by Escape in the remove confirm over it
  const account = data.playServiceAccount;
  const needed = data.apps.some((a) => a.androidPackage);
  if (!needed && !account) return null;
  const close = () => { setOpen(false); setTyped(""); setError(null); };
  const save = async () => {
    const b = secretBody(typed.trim());
    setBusy(true); setError(null);
    try { await api.setPlayServiceAccount(b.value ?? null, b.reference ?? null); await qc.invalidateQueries({ queryKey: INTEGRITY }); close(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <EditCard title="Google Play Integrity" testId="play-service-account"
      description="Android apps prove themselves with Play Integrity; the server asks Google what each token says, signed in as this service account. In Google Cloud: enable the Play Integrity API, make a service account with a JSON key, and link the project to the app in Play Console (App integrity)."
      actions={data.editable && <Button variant={account ? "subtle" : "filled"} leftSection={<IconKey size={15} />} onClick={() => setOpen(true)}>{account ? "Replace" : "Set service account"}</Button>}
      rows={[
        { label: "Service account", value: account ? <Text span size="sm" ff="monospace">{account.email ?? "set"}</Text> : <Text span size="sm" c="red">Not set: Android apps can't prove themselves</Text> },
        ...(account ? [{ label: "Kept", value: account.reference ? `From ${account.reference}` : `Set ${when(account.setAt)}${account.setBy ? ` by ${account.setBy}` : ""}` }] : []),
      ]}>
      <Modal opened={open} onClose={close} closeOnEscape={onTop} size="lg" radius="lg" title={<Text fw={700} fz={18}>Google service account</Text>}>
        <Stack gap="md">
          <SecretInput label="Key file (JSON)" multiline value={typed} onChange={setTyped} savedReference={account?.reference}
            description="Pasted here or picked below. Kept in Winche Secrets, encrypted, never shown again." />
          <Group justify="space-between">
            <FileButton accept="application/json,.json" onChange={async (f) => { if (f) setTyped(await f.text()); }}>
              {(props) => <Button {...props} variant="default" size="xs">Pick the key file</Button>}
            </FileButton>
            {account && data.editable && (
              <Button variant="subtle" color="red" size="xs" onClick={() => setRemoving(true)}>Remove it</Button>
            )}
          </Group>
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button onClick={save} loading={busy} disabled={!typed.trim()}>Save</Button>
          </Group>
        </Stack>
      </Modal>
      <ConfirmModal opened={removing} title="Remove the service account?" confirmLabel="Remove it" onCancel={() => setRemoving(false)}
        action={async () => { await api.removePlayServiceAccount(); await qc.invalidateQueries({ queryKey: INTEGRITY }); close(); }}
        message="Android apps can't prove themselves until one is set again: where a product is enforced, their requests are refused." />
    </EditCard>
  );
}

/**
 * Name, id and identifiers of an app. The id is chosen when adding (filled in from the name until edited) and shown
 * locked when editing: it's in the app's options file.
 */
function AppFieldsForm({ value, onChange, fixedId, secret, onSecret, secretSet, savedSecretReference }: {
  value: AppFields; onChange: (v: AppFields) => void; fixedId?: string;
  /** The Turnstile secret key typed (write-only), and whether one is kept. */
  secret: string; onSecret: (s: string) => void; secretSet?: boolean;
  /** The kept secret's reference, when it's read from elsewhere (AWS). */
  savedSecretReference?: string | null;
}) {
  const [idEdited, setIdEdited] = useState(false);
  const id = value.id ?? "";
  return (
    <Stack gap="sm">
      <FieldRow>
      <TextInput label="App name" placeholder="My app" data-autofocus value={value.name}
        onChange={(e) => {
          const name = e.currentTarget.value;
          onChange({ ...value, name, ...(fixedId || idEdited ? {} : { id: name.trim() ? projectIdFrom(name) : "" }) });
        }} />
      {fixedId ? (
        <TextInput label="App id" value={fixedId} disabled leftSection={<IconLock size={14} />}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} />
      ) : (
        <TextInput label="App id" placeholder="Blank: one is made" value={id}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          error={id && !isProjectId(id) ? "3 to 40 lower-case letters, digits and dashes, starting with a letter." : undefined}
          onChange={(e) => { setIdEdited(true); onChange({ ...value, id: e.currentTarget.value.toLowerCase() }); }} />
      )}
      </FieldRow>
      <Text size="xs" c={surface.muted}>Set the platforms the app runs on; the rest stay empty.</Text>

      <PlatformHeading icon={<IconBrandApple size={16} />} title="Apple (iOS, macOS)" proof="App Attest" />
      <FieldRow>
        <TextInput label="Apple bundle id" placeholder="com.example.myapp"
          value={value.appleBundleId ?? ""} onChange={(e) => onChange({ ...value, appleBundleId: e.currentTarget.value || null })} />
        <TextInput label="Apple team id" placeholder="ABCDE12345" description="In your Apple developer account"
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          value={value.appleTeamId ?? ""} onChange={(e) => onChange({ ...value, appleTeamId: e.currentTarget.value.toUpperCase() || null })} />
      </FieldRow>
      {(value.appleBundleId || value.appleTeamId) && (
        <Switch label="Accept development builds" checked={value.appleDevelopment}
          description="App Attest keys from builds run from Xcode, besides TestFlight and App Store ones. Turn it off before you enforce in production."
          onChange={(e) => onChange({ ...value, appleDevelopment: e.currentTarget.checked })} />
      )}

      <PlatformHeading icon={<IconBrandAndroid size={16} />} title="Android" proof="Play Integrity" />
      <FieldRow>
        <TextInput label="Android package" placeholder="com.example.myapp"
          value={value.androidPackage ?? ""} onChange={(e) => onChange({ ...value, androidPackage: e.currentTarget.value || null })} />
        <NumberInput label="Google Cloud project number" description="Linked to the app in Play Console" placeholder="123456789012"
          disabled={!value.androidPackage}
          allowDecimal={false} allowNegative={false} hideControls value={value.androidCloudProjectNumber ?? ""}
          onChange={(v) => onChange({ ...value, androidCloudProjectNumber: typeof v === "number" ? v : v ? Number(v) : null })} />
      </FieldRow>
      {value.androidPackage && (
        <>
          <FieldRow>
            <Select label="The device must meet" allowDeselect={false} value={value.androidDeviceIntegrity}
              data={(Object.keys(DEVICE_LEVEL) as AndroidDeviceLevel[]).map((k) => ({ value: k, label: DEVICE_LEVEL[k] }))}
              onChange={(v) => onChange({ ...value, androidDeviceIntegrity: (v ?? "device") as AndroidDeviceLevel })} />
          </FieldRow>
          <Switch label="Accept builds from outside Google Play" checked={value.androidSideloaded}
            description="Debug and internal builds Google Play doesn't know. With signing certificates set below, only builds signed with them."
            onChange={(e) => onChange({ ...value, androidSideloaded: e.currentTarget.checked })} />
          <TagsInput label="Signing certificates (optional)" placeholder="SHA-256, base64url, then Enter"
            description="Play Console → App integrity → App signing. When set, builds must be signed with one of them."
            value={value.androidCertificates} onChange={(v) => onChange({ ...value, androidCertificates: v })} />
        </>
      )}

      <PlatformHeading icon={<IconWorld size={16} />} title="Web" proof="browser check (Cloudflare Turnstile)" />
      <FieldRow>
        <TextInput label="Turnstile site key" placeholder="0x4AAAAAAA…"
          description="Cloudflare → Turnstile → Add widget (Invisible)"
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          value={value.webSiteKey ?? ""} onChange={(e) => onChange({ ...value, webSiteKey: e.currentTarget.value.trim() || null })} />
        <TagsInput label="Sites the app runs on" placeholder="app.example.com, then Enter" disabled={!value.webSiteKey}
          description="Empty: any. Add the same ones to the widget."
          value={value.webHostnames} onChange={(v) => onChange({ ...value, webHostnames: v.map((h) => h.trim().toLowerCase()) })} />
      </FieldRow>
      {value.webSiteKey && (
        <SecretInput label="Turnstile secret key" value={secret} onChange={onSecret}
          placeholder={secretSet ? "Kept: type to replace" : "0x4AAAAAAA…"} savedReference={savedSecretReference}
          description="Kept in Winche Secrets, encrypted, never shown again" />
      )}
    </Stack>
  );
}

/** A platform's part of the app form: its name and the proof it gives. */
function PlatformHeading({ icon, title, proof }: { icon: ReactNode; title: string; proof: string }) {
  return (
    <Group gap={8} mt="xs" pt="sm" style={{ borderTop: `1px solid ${surface.subtle}` }}>
      <span style={{ display: "inline-flex", color: "var(--w-accent)" }}>{icon}</span>
      <Text fw={600} size="sm">{title}</Text>
      <Text size="xs" c={surface.faint}>· {proof}</Text>
    </Group>
  );
}

function AppFormDialog({ app, onClose }: { app: IntegrityApp | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<AppFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const v = value ?? (app ? { name: app.name, androidPackage: app.androidPackage, appleBundleId: app.appleBundleId, appleTeamId: app.appleTeamId,
    appleDevelopment: app.appleDevelopment, androidCloudProjectNumber: app.androidCloudProjectNumber, androidSideloaded: app.androidSideloaded,
    androidDeviceIntegrity: app.androidDeviceIntegrity, androidCertificates: app.androidCertificates, webSiteKey: app.webSiteKey, webHostnames: app.webHostnames } : EMPTY);
  const close = () => { setValue(null); setSecret(""); setError(null); onClose(); };
  const save = async () => {
    if (!app) return;
    setBusy(true); setError(null);
    try {
      await api.updateApp(app.id, v);
      if (v.webSiteKey && secret.trim()) { const b = secretBody(secret.trim()); await api.setTurnstileSecret(app.id, b.value ?? null, b.reference ?? null); }
      await qc.invalidateQueries({ queryKey: INTEGRITY }); close();
    }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollDialog opened={!!app} onClose={close} title={`Edit ${app?.name ?? ""}`}
      footer={<><Button variant="default" onClick={close}>Cancel</Button><Button onClick={save} loading={busy} disabled={!v.name.trim()}>Save</Button></>}>
      <Stack gap="md">
        <AppFieldsForm value={v} onChange={setValue} fixedId={app?.id} secret={secret} onSecret={setSecret} secretSet={!!app?.turnstileSecret} savedSecretReference={app?.turnstileSecret?.reference} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
      </Stack>
    </ScrollDialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      <div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--w-accent-soft)", color: "var(--w-accent)",
        display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{n}</div>
      <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600}>{title}</Text>
        {children}
      </Stack>
    </Group>
  );
}

function Command({ value }: { value: string }) {
  return (
    <Group gap={4} wrap="nowrap" style={{ background: surface.subtle, borderRadius: 8, padding: "6px 6px 6px 12px" }}>
      <Text size="sm" ff="monospace" style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }}>{value}</Text>
      <Copy value={value} label="command" />
    </Group>
  );
}

/** How to connect the app, one guide per SDK (Flutter today; the rest greyed out until they exist). Nothing is stored. */
function ConnectGuide({ baseUrl, snippet, appId }: { baseUrl: string; snippet: string; appId?: string }) {
  const [guide, setGuide] = useState("flutter");
  return (
    <Stack gap="md">
      {appId && (
        <Group gap={6}>
          <Text size="sm" c={surface.muted}>App id</Text>
          <Text size="sm" ff="monospace" fw={500}>{appId}</Text>
          <Copy value={appId} label="app id" />
        </Group>
      )}
      <Tabs value={guide} onChange={(v) => setGuide(v ?? "flutter")}>
        <Tabs.List>
          {GUIDES.map((g) => g.ready
            ? <Tabs.Tab key={g.id} value={g.id}>{g.label}</Tabs.Tab>
            : <Tooltip key={g.id} label="Not available yet" withArrow><span style={{ display: "inline-flex" }}><Tabs.Tab value={g.id} disabled>{g.label}</Tabs.Tab></span></Tooltip>)}
        </Tabs.List>
        <Tabs.Panel value="flutter" pt="lg"><FlutterSteps baseUrl={baseUrl} snippet={snippet} appId={appId} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

/** The steps to connect a Flutter app: packages, the options file (by the CLI, or downloaded), main() with Integrity. */
function FlutterSteps({ baseUrl, snippet, appId }: { baseUrl: string; snippet: string; appId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setError(null);
    try {
      const data = await api.apps(ALL_PLATFORMS, appId);
      const url = URL.createObjectURL(new Blob([data.file], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "winche_options.dart";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Couldn't download it: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="xl">
      <Step n={1} title="Add the packages">
        <Command value="flutter pub add winche_flutter winche_database winche_storage winche_auth winche_functions winche_integrity" />
      </Step>
      <Step n={2} title="Add lib/winche_options.dart">
        <Command value={`winche configure --url ${baseUrl}${appId ? ` --app ${appId}` : ""}`} />
        <Group gap="xs">
          <Text size="sm" c={surface.faint}>or</Text>
          <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} loading={busy} onClick={download}>Download winche_options.dart</Button>
        </Group>
        {error && <Alert color="red" p="xs">{error}</Alert>}
      </Step>
      <Step n={3} title="Start Winche in main(), with Integrity">
        <Command value={snippet} />
        <Command value="app.useIntegrity(WinchePlatformIntegrity(debugToken: kDebugMode ? const String.fromEnvironment('WINCHE_DEBUG_TOKEN') : null));" />
        <Text size="xs" c={surface.muted}>App Attest on iOS and macOS, Play Integrity on Android, the browser check on the web; a debug token from below where there's none (simulators, desktop).</Text>
      </Step>
    </Stack>
  );
}

/**
 * Adding an app: its name and its platforms' ids, then how to connect it with its own options file. Used from
 * Integrity and the setup wizard.
 */
export function AddAppDialog({ opened, baseUrl, snippet, onClose }: { opened: boolean; baseUrl: string; snippet: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [fields, setFields] = useState<AppFields>(EMPTY);
  const [appId, setAppId] = useState<string | null>(null);
  // Added, but its secret key not saved yet: trying again sends only the secret (and any change), never a second app.
  const [created, setCreated] = useState<{ id: string; fields: AppFields } | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setFields(EMPTY); setAppId(null); setCreated(null); setSecret(""); setError(null); onClose(); };
  const add = async () => {
    setBusy(true); setError(null);
    let id = created?.id ?? null;
    try {
      if (!id) {
        id = (await api.addApp({ ...fields, id: fields.id?.trim() || undefined })).id;
        setCreated({ id, fields });
        await qc.invalidateQueries({ queryKey: INTEGRITY });
      } else if (JSON.stringify(created!.fields) !== JSON.stringify(fields)) {
        const { id: _, ...rest } = fields;
        await api.updateApp(id, rest);
        setCreated({ id, fields });
      }
    } catch (e) {
      setError(errorMessage(e)); setBusy(false);
      return;
    }
    try {
      if (fields.webSiteKey && secret.trim()) { const b = secretBody(secret.trim()); await api.setTurnstileSecret(id, b.value ?? null, b.reference ?? null); }
      setAppId(id);
      await qc.invalidateQueries({ queryKey: INTEGRITY });
    } catch (e) {
      setError(`The app was added, but its Turnstile secret key wasn't saved: ${errorMessage(e)}. Try again, or skip and set it later from Edit.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollDialog opened={opened} onClose={close} title={appId ? `Connect ${fields.name.trim()}` : "Add an app"}
      footer={!appId ? (
        <>
          {created ? <Button variant="default" onClick={() => setAppId(created.id)} disabled={busy}>Skip</Button> : <Button variant="default" onClick={close}>Cancel</Button>}
          <Button onClick={add} loading={busy} disabled={!fields.name.trim() || (!!fields.id && !isProjectId(fields.id))}>{created ? "Save secret key" : "Add app"}</Button>
        </>
      ) : <Button onClick={close}>Done</Button>}>
      {!appId ? (
        <Stack gap="md">
          <AppFieldsForm value={fields} onChange={setFields} fixedId={created?.id} secret={secret} onSecret={setSecret} />
          {error && <Alert color="red" p="xs">{error}</Alert>}
        </Stack>
      ) : <ConnectGuide baseUrl={baseUrl} snippet={snippet} appId={appId} />}
    </ScrollDialog>
  );
}
