import { useState, type ReactNode } from "react";
import {
  ActionIcon, Alert, Badge, Button, Code, FileButton, Group, Loader, Menu, Modal, NumberInput, Paper, PasswordInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table,
  TagsInput, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import {
  IconApps, IconBrandAndroid, IconBrandApple, IconBrandFlutter, IconBrandUbuntu, IconBrandWindows, IconDeviceDesktop, IconDots, IconDownload,
  IconKey, IconLock, IconPencil, IconPlus, IconTrash, IconWorld,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { AndroidDeviceLevel, AppFields, IntegrityApp, IntegrityData, IntegrityMode, Usage } from "../../api/apps";
import { secretBody } from "../../api/secrets";
import { EditCard } from "../../components/EditCard";
import { EmptyState } from "../../components/EmptyState";
import { isProjectId, projectIdFrom } from "../../api/project";
import { surface } from "../../theme";
import { Copy } from "../apps/AppsPage";

const INTEGRITY = ["integrity"];

/** The SDKs an app can use: Flutter today; the rest are shown greyed out until they exist. */
const SDKS: { id: string; label: string; icon: typeof IconWorld; ready: boolean }[] = [
  { id: "flutter", label: "Flutter", icon: IconBrandFlutter, ready: true },
  { id: "android", label: "Android", icon: IconBrandAndroid, ready: false },
  { id: "ios", label: "iOS", icon: IconBrandApple, ready: false },
  { id: "web", label: "Web", icon: IconWorld, ready: false },
  { id: "macos", label: "macOS", icon: IconDeviceDesktop, ready: false },
  { id: "windows", label: "Windows", icon: IconBrandWindows, ready: false },
  { id: "linux", label: "Linux", icon: IconBrandUbuntu, ready: false },
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
    <Stack gap="lg" maw={1100}>
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

      {list.length === 0 && (
        <EmptyState icon={IconApps} title="No apps yet"
          description="Add your app to get its winche_options.dart. Once it sends Integrity tokens, its requests show here."
          action={editable ? <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add app</Button> : undefined} />
      )}

      {list.length > 0 && (
        <Stack gap={0}>
          {list.map((a) => (
            <Group key={a.id} justify="space-between" wrap="nowrap" gap="md" py={14} data-testid="integrity-app"
              style={{ borderTop: `1px solid ${surface.subtle}` }}>
              <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--w-accent-soft)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <IconBrandFlutter size={22} color="var(--w-accent)" />
                </div>
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap={8} wrap="nowrap">
                    <Text fw={600} truncate>{a.name}</Text>
                    <Text size="xs" ff="monospace" c={surface.faint}>{a.id}</Text>
                    <Copy value={a.id} label="app id" />
                  </Group>
                  <Group gap={6}>
                    {a.androidPackage && <Badge variant="light" color="gray" tt="none" leftSection={<IconBrandAndroid size={12} />}>{a.androidPackage}</Badge>}
                    {a.appleBundleId && <Badge variant="light" color="gray" tt="none" leftSection={<IconBrandApple size={12} />}>
                      {a.appleTeamId ? `${a.appleTeamId}.${a.appleBundleId}` : a.appleBundleId}</Badge>}
                  </Group>
                  <Text size="xs" c={surface.muted}>{usageLine(total(a.usage))}</Text>
                  {a.androidPackage && (
                    <Text size="xs" c={surface.muted} data-testid="play-integrity-setup">
                      Play Integrity: {a.androidCloudProjectNumber ? `Cloud project ${a.androidCloudProjectNumber}` : "no Cloud project number yet"} · {DEVICE_LEVEL[a.androidDeviceIntegrity]}
                      {a.androidSideloaded ? " · builds from outside Google Play accepted" : ""}
                      {a.androidCertificates.length ? ` · ${a.androidCertificates.length} signing certificate${a.androidCertificates.length === 1 ? "" : "s"}` : ""}
                    </Text>
                  )}
                  {a.webSiteKey && (
                    <Text size="xs" c={a.turnstileSecret ? surface.muted : "red"} data-testid="browser-check-setup">
                      Browser check: {a.webHostnames.length ? a.webHostnames.join(", ") : "any site"}
                      {a.turnstileSecret ? "" : " · no secret key yet"}
                    </Text>
                  )}
                  {a.appleBundleId && a.appleTeamId && (
                    <Text size="xs" c={surface.muted} data-testid="app-attest-devices">
                      App Attest: {a.devices ? `${a.devices.count.toLocaleString()} device${a.devices.count === 1 ? "" : "s"}${a.devices.development ? ` (${a.devices.development} development)` : ""} · last proof ${ago(a.devices.lastUsed)}` : "no devices yet"}
                      {a.appleDevelopment ? " · development builds accepted" : ""}
                    </Text>
                  )}
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
          <Stack gap="xl" pt="xs">
            <FlutterSteps baseUrl={baseUrl} snippet={snippet} appId={connecting.id} />
            <Group justify="flex-end"><Button onClick={() => setConnecting(null)}>Done</Button></Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!removing} onClose={() => setRemoving(null)} radius="lg" title={<Text fw={700} fz={18}>Remove {removing?.name}?</Text>}>
        <Stack gap="md">
          <Text size="sm" c={surface.muted}>
            Its Integrity tokens and debug tokens stop working at once.
            {enforced ? (list.length === 1 ? " It's the last app, so enforced products go back to Monitor." : " Copies of it already installed are refused where a product is enforced.") : ""}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button color="red" onClick={async () => { if (removing) await api.removeApp(removing.id); setRemoving(null); await refresh(); }}>Remove app</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

/** Each product's mode, with today's requests with and without a valid token; and how long tokens last. */
function Enforcement({ data }: { data: IntegrityData }) {
  const qc = useQueryClient();
  const [modes, setModes] = useState<Record<string, IntegrityMode> | null>(null);
  const [minutes, setMinutes] = useState<number | string>("");
  const [editing, setEditing] = useState(false);
  const verified = (product: string) => data.apps.reduce((n, a) => n + (a.usage[product]?.today ?? 0), 0);
  const unverified = (product: string) => data.unverified[product]?.today ?? 0;
  const counts = (p: string) => data.enforcement[p] === "off" ? "Not counted" : `${verified(p).toLocaleString()} verified · ${unverified(p).toLocaleString()} without a token`;
  const m = modes ?? data.enforcement;
  return (
    <EditCard title="Enforcement" testId="integrity-enforcement"
      description="How each product treats requests without a valid Integrity token. Links opened from emails, identity providers' notices, HTTP functions (webhooks) and signed file links never need one."
      editable={data.editable} editing={editing}
      onEdit={() => { setModes(data.enforcement); setMinutes(data.tokenMinutes); setEditing(true); }}
      onCancel={() => setEditing(false)}
      onSave={async (reason) => {
        await api.setIntegrityEnforcement(m, Number(minutes) || data.tokenMinutes, reason);
        await qc.invalidateQueries({ queryKey: INTEGRITY });
        setEditing(false);
      }}
      rows={[
        ...data.products.map((p) => ({
          label: PRODUCT_LABEL[p] ?? p,
          value: (
            <Group gap="sm" wrap="wrap">
              <Badge variant="light" color={data.enforcement[p] === "enforce" ? "teal" : data.enforcement[p] === "off" ? "gray" : "blue"}>
                {MODES.find((x) => x.value === data.enforcement[p])?.label}</Badge>
              <Text span size="xs" c={surface.muted}>Today: {counts(p)}</Text>
            </Group>
          ),
        })),
        { label: "Tokens last", value: `${data.tokenMinutes} minutes` },
      ]}
      form={
        <Stack gap="md" style={{ padding: "0 24px 16px" }}>
          {data.apps.length === 0 && <Alert color="gray" p="xs">Add an app before enforcing: nothing could call.</Alert>}
          <Table withRowBorders={false} verticalSpacing={6}>
            <Table.Tbody>
              {data.products.map((p) => (
                <Table.Tr key={p}>
                  <Table.Td w={160}><Text size="sm" fw={500}>{PRODUCT_LABEL[p] ?? p}</Text></Table.Td>
                  <Table.Td>
                    <SegmentedControl size="xs" aria-label={`${PRODUCT_LABEL[p] ?? p} mode`} data={MODES.map((x) => ({ ...x, disabled: x.value === "enforce" && data.apps.length === 0 }))}
                      value={m[p]} onChange={(v) => setModes({ ...m, [p]: v as IntegrityMode })} />
                  </Table.Td>
                  <Table.Td><Text size="xs" c={surface.muted}>{MODE_TEXT[m[p]]}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <NumberInput label="Tokens last (minutes)" description="30 minutes to 24 hours. Shorter: a stolen token is good for less time; apps prove themselves more often."
            w={260} min={30} max={1440} value={minutes} onChange={setMinutes} />
        </Stack>
      } />
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
  const close = () => { setMaking(false); setApp(null); setName(""); setMade(null); setError(null); };
  const make = async () => {
    const forApp = app ?? data.apps[0]?.id;
    if (!forApp) return;
    setBusy(true); setError(null);
    try {
      const r = await api.makeDebugToken(forApp, name.trim());
      setMade({ name: r.name, token: r.token });
      await qc.invalidateQueries({ queryKey: INTEGRITY });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
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

      <Modal opened={making} onClose={close} radius="lg" title={<Text fw={700} fz={18}>{made ? `${made.name}: copy it now` : "Make a debug token"}</Text>}>
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
      <Modal opened={!!removing} onClose={() => setRemoving(null)} radius="lg" title={<Text fw={700} fz={18}>Remove {removing?.name}?</Text>}>
        <Stack gap="md">
          <Text size="sm" c={surface.muted}>The Integrity tokens it got stop working at once.</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button color="red" onClick={async () => { if (removing) await api.removeDebugToken(removing.id); setRemoving(null); await qc.invalidateQueries({ queryKey: INTEGRITY }); }}>Remove token</Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

const EMPTY: AppFields = { name: "", sdk: "flutter", androidPackage: null, appleBundleId: null, appleTeamId: null, appleDevelopment: false,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <Modal opened={open} onClose={close} size="lg" radius="lg" title={<Text fw={700} fz={18}>Google service account</Text>}>
        <Stack gap="md">
          <Textarea label="Key file (JSON)" description="Pasted here, or picked below; or a reference to where it's kept, like aws-sm:clinic/play-integrity. It's kept encrypted and never shown again."
            autosize minRows={4} maxRows={10} styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12 } }}
            value={typed} onChange={(e) => setTyped(e.currentTarget.value)} data-autofocus />
          <Group justify="space-between">
            <FileButton accept="application/json,.json" onChange={async (f) => { if (f) setTyped(await f.text()); }}>
              {(props) => <Button {...props} variant="default" size="xs">Pick the key file</Button>}
            </FileButton>
            {account && data.editable && (
              <Button variant="subtle" color="red" size="xs" onClick={async () => { await api.removePlayServiceAccount(); await qc.invalidateQueries({ queryKey: INTEGRITY }); close(); }}>Remove it</Button>
            )}
          </Group>
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button onClick={save} loading={busy} disabled={!typed.trim()}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </EditCard>
  );
}

/**
 * Name, id and identifiers of an app. The id is chosen when adding (filled in from the name until edited) and shown
 * locked when editing: it's in the app's options file.
 */
function AppFieldsForm({ value, onChange, fixedId, secret, onSecret, secretSet }: {
  value: AppFields; onChange: (v: AppFields) => void; fixedId?: string;
  /** The Turnstile secret key typed (write-only), and whether one is kept. */
  secret: string; onSecret: (s: string) => void; secretSet?: boolean;
}) {
  const [idEdited, setIdEdited] = useState(false);
  const id = value.id ?? "";
  return (
    <Stack gap="sm">
      <TextInput label="App name" placeholder="Clinic app" data-autofocus value={value.name}
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
      <TextInput label="Android package" placeholder="com.example.clinic (optional)" leftSection={<IconBrandAndroid size={16} />}
        description="For Play Integrity"
        value={value.androidPackage ?? ""} onChange={(e) => onChange({ ...value, androidPackage: e.currentTarget.value || null })} />
      {value.androidPackage && (
        <>
          <Group grow wrap="wrap" align="flex-start">
            <NumberInput label="Google Cloud project number" description="The project with the Play Integrity API, linked in Play Console" placeholder="123456789012"
              allowDecimal={false} allowNegative={false} hideControls value={value.androidCloudProjectNumber ?? ""}
              onChange={(v) => onChange({ ...value, androidCloudProjectNumber: typeof v === "number" ? v : v ? Number(v) : null })} />
            <Select label="The device must meet" allowDeselect={false} value={value.androidDeviceIntegrity}
              data={(Object.keys(DEVICE_LEVEL) as AndroidDeviceLevel[]).map((k) => ({ value: k, label: DEVICE_LEVEL[k] }))}
              onChange={(v) => onChange({ ...value, androidDeviceIntegrity: (v ?? "device") as AndroidDeviceLevel })} />
          </Group>
          <Switch label="Accept builds from outside Google Play" checked={value.androidSideloaded}
            description="Debug and internal builds Google Play doesn't know. With signing certificates set below, only builds signed with them."
            onChange={(e) => onChange({ ...value, androidSideloaded: e.currentTarget.checked })} />
          <TagsInput label="Signing certificates (optional)" placeholder="SHA-256, base64url, then Enter"
            description="Play Console → App integrity → App signing. When set, builds must be signed with one of them."
            value={value.androidCertificates} onChange={(v) => onChange({ ...value, androidCertificates: v })} />
        </>
      )}
      <TextInput label="Turnstile site key (web)" placeholder="0x4AAAAAAA… (optional)" leftSection={<IconWorld size={16} />}
        description="The browser check: a Cloudflare Turnstile widget (Cloudflare dashboard → Turnstile → Add widget, Invisible)"
        styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        value={value.webSiteKey ?? ""} onChange={(e) => onChange({ ...value, webSiteKey: e.currentTarget.value.trim() || null })} />
      {value.webSiteKey && (
        <>
          <PasswordInput label="Turnstile secret key" placeholder={secretSet ? "Kept: type to replace" : "0x4AAAAAAA…, or aws-sm:…"}
            description="Kept encrypted, never shown again" value={secret} onChange={(e) => onSecret(e.currentTarget.value)} />
          <TagsInput label="Sites the app runs on" placeholder="app.example.com, then Enter (empty: any)"
            description="A browser check made on another site is refused. Add the same hostnames to the widget in Cloudflare."
            value={value.webHostnames} onChange={(v) => onChange({ ...value, webHostnames: v.map((h) => h.trim().toLowerCase()) })} />
        </>
      )}
      <Group grow wrap="wrap" align="flex-start">
        <TextInput label="Apple bundle id" placeholder="com.example.clinic (optional)" leftSection={<IconBrandApple size={16} />}
          description="iOS and macOS, for App Attest"
          value={value.appleBundleId ?? ""} onChange={(e) => onChange({ ...value, appleBundleId: e.currentTarget.value || null })} />
        <TextInput label="Apple team id" placeholder="ABCDE12345 (optional)" description="In your Apple developer account"
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
          value={value.appleTeamId ?? ""} onChange={(e) => onChange({ ...value, appleTeamId: e.currentTarget.value.toUpperCase() || null })} />
      </Group>
      <Switch label="Accept development builds" checked={value.appleDevelopment}
        description="App Attest keys from builds run from Xcode, besides TestFlight and App Store ones. Turn it off before you enforce in production."
        onChange={(e) => onChange({ ...value, appleDevelopment: e.currentTarget.checked })} />
    </Stack>
  );
}

function AppFormDialog({ app, onClose }: { app: IntegrityApp | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<AppFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const v = value ?? (app ? { name: app.name, sdk: app.sdk, androidPackage: app.androidPackage, appleBundleId: app.appleBundleId, appleTeamId: app.appleTeamId,
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
    <Modal opened={!!app} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Edit {app?.name}</Text>}>
      <Stack gap="md">
        <AppFieldsForm value={v} onChange={setValue} fixedId={app?.id} secret={secret} onSecret={setSecret} secretSet={!!app?.turnstileSecret} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!v.name.trim()}>Save</Button>
        </Group>
      </Stack>
    </Modal>
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

/** Picks the SDK (Flutter today; the others greyed out until they exist). */
export function SdkPicker({ onPick }: { onPick: (sdk: string) => void }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      {SDKS.map((x) => {
        const Icon = x.icon;
        const tile = (
          <UnstyledButton key={x.id} disabled={!x.ready} onClick={() => onPick(x.id)}
            aria-label={x.ready ? x.label : `${x.label}: not available yet`}
            style={{ border: `1px solid ${surface.border}`, borderRadius: 12, padding: "16px 8px", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 8, opacity: x.ready ? 1 : 0.45, cursor: x.ready ? "pointer" : "not-allowed",
              background: x.ready ? surface.card : surface.page }}>
            <Icon size={26} stroke={1.6} color={x.ready ? "var(--w-accent)" : surface.faint} />
            <Text size="sm" fw={600}>{x.label}</Text>
          </UnstyledButton>
        );
        return x.ready ? tile : <Tooltip key={x.id} label="Not available yet" withArrow>{tile}</Tooltip>;
      })}
    </SimpleGrid>
  );
}

/** The steps to connect a Flutter app: packages, the options file (by the CLI, or downloaded), main(). */
export function FlutterSteps({ baseUrl, snippet, appId }: { baseUrl: string; snippet: string; appId?: string }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const data = await api.apps(ALL_PLATFORMS, appId);
      const url = URL.createObjectURL(new Blob([data.file], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "winche_options.dart";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="xl">
      <Step n={1} title="Add the packages">
        <Command value="flutter pub add winche_flutter winche_database winche_storage winche_auth winche_functions" />
      </Step>
      <Step n={2} title="Add lib/winche_options.dart">
        <Command value={`winche configure --url ${baseUrl}${appId ? ` --app ${appId}` : ""}`} />
        <Group gap="xs">
          <Text size="sm" c={surface.faint}>or</Text>
          <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} loading={busy} onClick={download}>Download winche_options.dart</Button>
        </Group>
      </Step>
      <Step n={3} title="Start Winche in main()">
        <Command value={snippet} />
      </Step>
    </Stack>
  );
}

/**
 * Adding an app: pick its SDK, name it (and its package, bundle and team id), then the steps to connect it with its
 * own options file. Used from Integrity and the setup wizard.
 */
export function AddAppDialog({ opened, baseUrl, snippet, onClose }: { opened: boolean; baseUrl: string; snippet: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [sdk, setSdk] = useState<string | null>(null);
  const [fields, setFields] = useState<AppFields>(EMPTY);
  const [appId, setAppId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setSdk(null); setFields(EMPTY); setAppId(null); setSecret(""); setError(null); onClose(); };
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const { id } = await api.addApp({ ...fields, id: fields.id?.trim() || undefined, sdk: sdk ?? "flutter" });
      if (fields.webSiteKey && secret.trim()) { const b = secretBody(secret.trim()); await api.setTurnstileSecret(id, b.value ?? null, b.reference ?? null); }
      setAppId(id);
      await qc.invalidateQueries({ queryKey: INTEGRITY });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const title = appId ? `Connect ${fields.name.trim()}` : sdk ? "Add a Flutter app" : "Add an app";
  return (
    <Modal opened={opened} onClose={close} size="lg" radius="lg" title={<Text fw={700} fz={18}>{title}</Text>}>
      {!sdk && (
        <Stack gap="md">
          <Text size="sm" c={surface.muted}>What's your app built with?</Text>
          <SdkPicker onPick={setSdk} />
        </Stack>
      )}
      {sdk && !appId && (
        <Stack gap="md">
          <AppFieldsForm value={fields} onChange={setFields} secret={secret} onSecret={setSecret} />
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="space-between">
            <Button variant="subtle" color="gray" onClick={() => setSdk(null)}>← Back</Button>
            <Button onClick={add} loading={busy} disabled={!fields.name.trim() || (!!fields.id && !isProjectId(fields.id))}>Add app</Button>
          </Group>
        </Stack>
      )}
      {appId && (
        <Stack gap="xl" pt="xs">
          <Group gap={6}>
            <Text size="sm" c={surface.muted}>App id</Text>
            <Text size="sm" ff="monospace" fw={500}>{appId}</Text>
            <Copy value={appId} label="app id" />
          </Group>
          <FlutterSteps baseUrl={baseUrl} snippet={snippet} appId={appId} />
          <Group justify="flex-end"><Button onClick={close}>Done</Button></Group>
        </Stack>
      )}
    </Modal>
  );
}
