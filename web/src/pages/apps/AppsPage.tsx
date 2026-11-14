import { useState, type ReactNode } from "react";
import {
  ActionIcon, Alert, Badge, Button, CopyButton, FileButton, Group, Loader, Menu, Modal, Paper, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput,
  Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import {
  IconApps, IconBrandAndroid, IconBrandApple, IconBrandFlutter, IconBrandUbuntu, IconBrandWindows, IconCheck, IconCopy, IconDeviceDesktop,
  IconDots, IconDownload, IconPencil, IconPhoto, IconPlus, IconTrash, IconWorld,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { AppFields, RegisteredApp, AppUsage } from "../../api/apps";
import { EmptyState } from "../../components/EmptyState";
import { ProjectAvatar, squareThumbnail } from "../../components/ProjectAvatar";
import { useSession } from "../../auth/session";
import { surface } from "../../theme";

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

function Copy({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={1500}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : `Copy ${label}`} withArrow>
          <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} onClick={copy} aria-label={`Copy ${label}`}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}



/** Project settings → General: the project (thumbnail, name, id) and its apps. */
export function GeneralSettings() {
  const page = useQuery({ queryKey: ["apps", "android,ios,web"], queryFn: () => api.apps(["android", "ios", "web"]) });
  if (page.isLoading) return <Loader size="sm" />;
  if (page.error || !page.data) return <Alert color="red">Couldn't load the project: {String(page.error)}</Alert>;
  return (
    <Stack gap="lg">
      <YourProject fallbackName={page.data.setup.name ?? page.data.setup.projectId} fallbackId={page.data.setup.projectId} />
      <YourApps baseUrl={page.data.setup.baseUrl} snippet={page.data.snippet} />
    </Stack>
  );
}

/** The project's thumbnail, name and id; admins change the thumbnail and rename the project here. */
function YourProject({ fallbackName, fallbackId }: { fallbackName: string; fallbackId: string }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const project = useQuery({ queryKey: ["project"], queryFn: api.project });
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = user?.role === "Admin";
  const p = project.data;
  const name = p?.created ? p.name : fallbackName;
  const id = p?.created ? p.id : fallbackId;
  const canEdit = admin && !!p?.setup && !!p.created;
  const refresh = () => Promise.all(["project", "overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setError(null);
    try { await api.setProjectImage(await squareThumbnail(file)); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const removeImage = async () => {
    setBusy(true); setError(null);
    try { await api.removeProjectImage(); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" align="center" gap="lg" wrap="wrap">
        <Group gap="lg" wrap="nowrap" style={{ minWidth: 0 }}>
          <ProjectAvatar version={p?.imageVersion} size={72} radius={16} />
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text fw={700} fz={20} truncate data-testid="project-name">{name}</Text>
            <Group gap={4} wrap="nowrap">
              <Text size="sm" c={surface.muted}>Project id</Text>
              <Text size="sm" ff="monospace" fw={500}>{id}</Text>
              <Copy value={id} label="project id" />
            </Group>
          </Stack>
        </Group>
        {canEdit && (
          <Group gap="xs">
            <FileButton onChange={upload} accept="image/png,image/jpeg,image/webp">
              {(props) => <Button {...props} variant="default" leftSection={<IconPhoto size={16} />} loading={busy}>{p?.imageVersion ? "Change image" : "Add image"}</Button>}
            </FileButton>
            {p?.imageVersion && <Button variant="subtle" color="gray" onClick={removeImage} disabled={busy}>Remove image</Button>}
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setRenaming(true)}>Rename</Button>
          </Group>
        )}
      </Group>
      {error && <Alert color="red" p="xs" mt="md">{error}</Alert>}
      <RenameDialog opened={renaming} name={name} id={id} onClose={() => setRenaming(false)} onDone={refresh} />
    </Paper>
  );
}

/** Renaming the project. Its id stays: apps and their options files use it. */
function RenameDialog({ opened, name, id, onClose, onDone }: { opened: boolean; name: string; id: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = value ?? name;
  const close = () => { setValue(null); setError(null); onClose(); };
  const save = async () => {
    setBusy(true); setError(null);
    try { await api.renameProject(v.trim(), id); await onDone(); close(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Rename the project</Text>}>
      <Stack gap="md">
        <TextInput label="Project name" data-autofocus value={v} onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && v.trim() && save()} />
        <Text size="sm" c={surface.muted}>The project id stays <Text span ff="monospace">{id}</Text>: your apps use it.</Text>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!v.trim() || v.trim() === name}>Rename</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const usageLine = (u: AppUsage | null) =>
  !u ? "No requests yet" : `${u.today.toLocaleString()} requests today · ${u.last7Days.toLocaleString()} this week · last seen ${ago(u.lastSeen)}`;

/** The project's apps: an empty state until the first is registered, then the list. */
function YourApps({ baseUrl, snippet }: { baseUrl: string; snippet: string }) {
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: ["registered-apps"], queryFn: api.registeredApps });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RegisteredApp | null>(null);
  const [connecting, setConnecting] = useState<RegisteredApp | null>(null);
  const [removing, setRemoving] = useState<RegisteredApp | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const data = apps.data;
  const list = data?.apps ?? [];
  const editable = !!data?.editable;
  const refresh = () => qc.invalidateQueries({ queryKey: ["registered-apps"] });

  const setPolicy = async (on: boolean) => {
    setPolicyError(null);
    try { await api.setAppsPolicy(on); await refresh(); } catch (e) { setPolicyError(errorMessage(e)); }
  };

  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" align="center" gap="sm" mb={list.length ? "md" : "sm"}>
        <Title order={2} fz={16}>Your apps</Title>
        {editable && list.length > 0 && <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add app</Button>}
      </Group>

      {apps.isLoading && <Loader size="sm" />}
      {data && !data.available && <Text size="sm" c={surface.muted}>Apps can be registered once this console runs project setup.</Text>}
      {data?.available && list.length === 0 && (
        <EmptyState icon={IconApps} title="No apps yet"
          description="Register your app to get its winche_options.dart. Its requests then show here."
          action={editable ? <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add app</Button> : undefined} />
      )}

      {list.length > 0 && (
        <Stack gap={0}>
          {list.map((a) => (
            <Group key={a.id} justify="space-between" wrap="nowrap" gap="md" py={14} data-testid="registered-app"
              style={{ borderTop: `1px solid ${surface.subtle}` }}>
              <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--mantine-color-winche-0)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <IconBrandFlutter size={22} color="var(--mantine-color-winche-6)" />
                </div>
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap={8} wrap="nowrap">
                    <Text fw={600} truncate>{a.name}</Text>
                    <Text size="xs" ff="monospace" c={surface.faint}>{a.id}</Text>
                    <Copy value={a.id} label="app id" />
                  </Group>
                  <Group gap={6}>
                    {a.androidPackage && <Badge variant="light" color="gray" tt="none" leftSection={<IconBrandAndroid size={12} />}>{a.androidPackage}</Badge>}
                    {a.appleBundleId && <Badge variant="light" color="gray" tt="none" leftSection={<IconBrandApple size={12} />}>{a.appleBundleId}</Badge>}
                    {a.webOrigins.map((o) => <Badge key={o} variant="light" color="gray" tt="none" leftSection={<IconWorld size={12} />}>{o}</Badge>)}
                  </Group>
                  <Text size="xs" c={surface.muted}>{usageLine(a.usage)}</Text>
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
          <Group justify="space-between" wrap="nowrap" gap="md" pt={14} style={{ borderTop: `1px solid ${surface.subtle}` }}>
            <div>
              <Switch label="Only registered apps may call" checked={!!data?.registeredOnly} disabled={!editable}
                onChange={(e) => setPolicy(e.currentTarget.checked)} />
              <Text size="xs" c={surface.muted} mt={4} pl={52}>
                {data?.unregistered ? `Without an app id: ${usageLine(data.unregistered).toLowerCase()}.` : "Every request so far named a registered app."}
              </Text>
            </div>
          </Group>
          {policyError && <Alert color="red" p="xs" mt="xs">{policyError}</Alert>}
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
            Copies of it already installed keep sending its id.{data?.registeredOnly ? " With only registered apps allowed, they'll be refused." : ""}
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

const EMPTY: AppFields = { name: "", sdk: "flutter", androidPackage: null, appleBundleId: null, webOrigins: [] };

/** Name and identifiers of an app (registering or editing). */
function AppFieldsForm({ value, onChange }: { value: AppFields; onChange: (v: AppFields) => void }) {
  return (
    <Stack gap="sm">
      <TextInput label="App name" placeholder="Clinic app" data-autofocus value={value.name} onChange={(e) => onChange({ ...value, name: e.currentTarget.value })} />
      <TextInput label="Android package" placeholder="com.example.clinic (optional)" leftSection={<IconBrandAndroid size={16} />}
        value={value.androidPackage ?? ""} onChange={(e) => onChange({ ...value, androidPackage: e.currentTarget.value || null })} />
      <TextInput label="Apple bundle id" placeholder="com.example.clinic (optional)" leftSection={<IconBrandApple size={16} />}
        value={value.appleBundleId ?? ""} onChange={(e) => onChange({ ...value, appleBundleId: e.currentTarget.value || null })} />
      <TagsInput label="Web addresses" placeholder="https://app.example.com, then Enter (optional)" leftSection={<IconWorld size={16} />}
        description="Browsers there may call this server."
        value={value.webOrigins} onChange={(v) => onChange({ ...value, webOrigins: v })} />
    </Stack>
  );
}

function AppFormDialog({ app, onClose }: { app: RegisteredApp | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<AppFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = value ?? (app ? { name: app.name, sdk: app.sdk, androidPackage: app.androidPackage, appleBundleId: app.appleBundleId, webOrigins: app.webOrigins } : EMPTY);
  const close = () => { setValue(null); setError(null); onClose(); };
  const save = async () => {
    if (!app) return;
    setBusy(true); setError(null);
    try { await api.updateApp(app.id, v); await qc.invalidateQueries({ queryKey: ["registered-apps"] }); close(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={!!app} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Edit {app?.name}</Text>}>
      <Stack gap="md">
        <AppFieldsForm value={v} onChange={setValue} />
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
      <div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--mantine-color-winche-0)", color: "var(--mantine-color-winche-6)",
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
            <Icon size={26} stroke={1.6} color={x.ready ? "var(--mantine-color-winche-6)" : surface.faint} />
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
 * Adding an app: pick its SDK, name it (and its package, bundle id, web addresses), then the steps to connect it with
 * its own options file. Used from Project settings and the setup wizard.
 */
export function AddAppDialog({ opened, baseUrl, snippet, onClose }: { opened: boolean; baseUrl: string; snippet: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [sdk, setSdk] = useState<string | null>(null);
  const [fields, setFields] = useState<AppFields>(EMPTY);
  const [appId, setAppId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setSdk(null); setFields(EMPTY); setAppId(null); setError(null); onClose(); };
  const register = async () => {
    setBusy(true); setError(null);
    try {
      const { id } = await api.registerApp({ ...fields, sdk: sdk ?? "flutter" });
      setAppId(id);
      await qc.invalidateQueries({ queryKey: ["registered-apps"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const title = appId ? `Connect ${fields.name.trim()}` : sdk ? "Register a Flutter app" : "Add an app";
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
          <AppFieldsForm value={fields} onChange={setFields} />
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="space-between">
            <Button variant="subtle" color="gray" onClick={() => setSdk(null)}>← Back</Button>
            <Button onClick={register} loading={busy} disabled={!fields.name.trim()}>Register app</Button>
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
