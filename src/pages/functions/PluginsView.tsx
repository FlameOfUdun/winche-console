import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Checkbox, Code, Group, List, Loader, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Tabs, Text,
  TextInput, UnstyledButton,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconArrowUp, IconKey, IconPlus, IconPuzzle, IconSearch, IconTrash } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { CatalogPlugin, InstalledPlugin, PluginManifest, PluginPackageInfo, PluginSettingInfo } from "../../api/functions";
import { secretTyped } from "../../api/secrets";
import { EmptyState } from "../../components/EmptyState";
import { SecretInput } from "../../components/SecretInput";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";

/** Settings as a form holds them: every manifest setting, set or not. */
type Values = Record<string, unknown>;

/** The project secret a plugin secret is for the copy installed as `id`: SMS__AUTH_TOKEN. */
export const secretFor = (id: string, name: string) => `${id.toUpperCase().replace(/-/g, "_")}__${name}`;

const ID_RULE = /^[a-z](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/** An id to suggest for a package: its last part, without a "plugin" prefix or suffix ("@acme/winche-plugin-sms" → "sms"). */
export function suggestId(pkg: string) {
  const last = pkg.split("/").pop() ?? pkg;
  const bare = last.replace(/^(winche-)?plugin-/, "").replace(/-(winche-)?plugin$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^[^a-z]+/, "");
  return bare.slice(0, 30).replace(/-+$/, "") || "plugin";
}

const refresh = async (qc: ReturnType<typeof useQueryClient>) => {
  await qc.invalidateQueries({ queryKey: ["plugins"] });
  await qc.invalidateQueries({ queryKey: ["functions"] });
  await qc.invalidateQueries({ queryKey: ["function-secrets"] });
};

/** Functions → Plugins: the copies installed, and adding one. */
export function PluginsTab() {
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.plugins });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (plugins.isLoading) return <Loader size="sm" />;
  if (plugins.isError || !plugins.data) return <Alert color="red">Couldn't load the plugins: {errorMessage(plugins.error)}</Alert>;
  const list = plugins.data.plugins;
  const shown = list.find((p) => p.id === open) ?? null;
  const add = <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add plugin</Button>;
  return (
    <Stack gap="sm">
      {list.length === 0 ? (
        <EmptyState icon={IconPuzzle} title="No plugins yet" action={add}
          description="Plugins are ready-made functions, such as an integration with another service: install one, give its settings and keys, and apps call its functions." />
      ) : (
        <>
          <Group justify="space-between">
            <Group gap={8}><Text fw={600}>Installed</Text><Text size="sm" c="dimmed">{list.length} {list.length === 1 ? "plugin" : "plugins"}</Text></Group>
            {add}
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {list.map((p) => <PluginCard key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}
          </SimpleGrid>
        </>
      )}
      <AddPluginModal opened={adding} onClose={() => setAdding(false)} taken={list.map((p) => p.id)} />
      <PluginDialog p={shown} onClose={() => setOpen(null)} />
    </Stack>
  );
}

function PluginCard({ p, onOpen }: { p: InstalledPlugin; onOpen: () => void }) {
  return (
    <UnstyledButton onClick={onOpen} data-testid="plugin" aria-label={`${p.manifest.title} (${p.id})`}>
      <Paper withBorder p="lg" className="winche-card-link" h="100%" style={{ display: "flex", flexDirection: "column" }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <PluginIcon />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} fz={16} truncate>{p.manifest.title}</Text>
            <Group gap={6} wrap="nowrap" mt={2}>
              <Badge variant="light" tt="none" ff="monospace" size="sm" style={{ flexShrink: 0, maxWidth: "60%" }}>{p.id}</Badge>
              <Text size="xs" c="dimmed" ff="monospace" truncate>{p.package} {p.version}</Text>
            </Group>
          </div>
        </Group>
        {p.manifest.description && <Text size="sm" mt={10} lineClamp={2}>{p.manifest.description}</Text>}
        <Group gap={6} mt={10}>
          {p.secretsNeeded.length > 0 && <Badge color="orange" variant="light" tt="none" leftSection={<IconKey size={12} />}>Needs {p.secretsNeeded.length === 1 ? "a secret" : `${p.secretsNeeded.length} secrets`}</Badge>}
          {p.update && <Badge color="blue" variant="light" tt="none" leftSection={<IconArrowUp size={12} />}>{p.latest} is out</Badge>}
          {p.source === "deploy" && <Badge color="gray" variant="light" tt="none">From winche.json</Badge>}
          {!p.curated && <Badge color="yellow" variant="light" tt="none">Not in the catalog</Badge>}
        </Group>
        <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap" style={{ marginTop: "auto", paddingTop: 16 }}>
          <Text size="xs" c="dimmed">{p.functions.length} {p.functions.length === 1 ? "function" : "functions"}</Text>
          <Group gap={4} c={surface.accent} wrap="nowrap"><Text size="sm" fw={600}>Open</Text><IconArrowRight size={15} /></Group>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

function PluginIcon({ size = 36 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
      background: "var(--w-accent-soft)", color: "var(--w-accent)" }}>
      <IconPuzzle size={size * 0.55} stroke={1.7} />
    </div>
  );
}

/** What the plugin says it does: shown before installing, upgrading, and on its page. */
function Access({ manifest, curated }: { manifest: PluginManifest; curated: boolean }) {
  return (
    <Paper withBorder radius="md" p="md" bg={surface.card}>
      <Text size="sm" fw={600} mb={6}>What it does</Text>
      {manifest.access.length > 0
        ? <List size="sm" spacing={4}>{manifest.access.map((a) => <List.Item key={a}>{a}</List.Item>)}</List>
        : <Text size="sm" c="dimmed">It doesn't say.</Text>}
      <Text size="xs" c="dimmed" mt={8}>
        Its functions run with the server's rights, like the project's own: they can read and change the project's data. This list is what the plugin says; it isn't enforced.
      </Text>
      {!curated && (
        <Alert color="yellow" variant="light" mt="sm" icon={<IconAlertTriangle size={16} />} title="Not in this server's catalog">
          Nobody running this server has vouched for it. Install it only if you trust who publishes it.
        </Alert>
      )}
    </Paper>
  );
}

/** Starting values: what's set, else the default (so the form shows what will be used). */
function startValues(settings: PluginSettingInfo[], set: Values = {}): Values {
  return Object.fromEntries(settings.map((s) => [s.name, set[s.name] ?? s.default ?? (s.type === "boolean" ? false : null)]));
}

/** Values to send: empty ones left out (the default, or "needed"). */
const toSend = (v: Values) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== "" && x !== undefined));

/** A plugin's settings as fields, by their types. */
function SettingsFields({ settings, values, onChange, only }: {
  settings: PluginSettingInfo[]; values: Values; onChange: (v: Values) => void; only?: string[];
}) {
  const shown = only ? settings.filter((s) => only.includes(s.name)) : settings;
  if (shown.length === 0) return <Text size="sm" c="dimmed">It has no settings.</Text>;
  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });
  return (
    <Stack gap="sm">
      {shown.map((s) => {
        const common = { label: s.label, description: s.description ?? undefined, withAsterisk: s.required };
        const hint = <Text span size="xs" c="dimmed" ff="monospace"> {s.name}</Text>;
        if (s.type === "boolean")
          return <Switch key={s.name} label={<>{s.label}{hint}</>} description={s.description ?? undefined} checked={!!values[s.name]}
            onChange={(e) => set(s.name, e.currentTarget.checked)} />;
        if (s.type === "select")
          return <Select key={s.name} {...common} label={<>{s.label}{hint}</>} data={s.options ?? []} value={(values[s.name] as string) ?? null}
            onChange={(v) => set(s.name, v)} clearable={!s.required} />;
        if (s.type === "number" || s.type === "integer")
          return <NumberInput key={s.name} {...common} label={<>{s.label}{hint}</>} allowDecimal={s.type === "number"} value={(values[s.name] as number) ?? ""}
            onChange={(v) => set(s.name, typeof v === "number" ? v : null)} />;
        return <TextInput key={s.name} {...common} label={<>{s.label}{hint}</>} value={(values[s.name] as string) ?? ""}
          onChange={(e) => set(s.name, e.currentTarget.value)} />;
      })}
    </Stack>
  );
}

// ── Adding one ──────────────────────────────────────────────────────────────────────────────────────────────────

function AddPluginModal({ opened, onClose, taken }: { opened: boolean; onClose: () => void; taken: string[] }) {
  const [chosen, setChosen] = useState<{ info: PluginPackageInfo; curated: boolean } | null>(null);
  const close = () => { setChosen(null); onClose(); };
  return (
    <Modal opened={opened} onClose={close} radius="lg" size="lg" title={<Text fw={700} fz={18}>{chosen ? `Install ${chosen.info.manifest.title}` : "Add a plugin"}</Text>}>
      {chosen
        ? <InstallForm info={chosen.info} curated={chosen.curated} taken={taken} onBack={() => setChosen(null)} onDone={close} />
        : <ChoosePlugin onChosen={(info, curated) => setChosen({ info, curated })} />}
    </Modal>
  );
}

function ChoosePlugin({ onChosen }: { onChosen: (info: PluginPackageInfo, curated: boolean) => void }) {
  const catalog = useQuery({ queryKey: ["plugin-catalog"], queryFn: api.pluginCatalog, staleTime: 60_000 });
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offered = catalog.data?.plugins ?? [];
  const look = async (pkg: string, v: string | null) => {
    setBusy(pkg); setError(null);
    try { onChosen(await api.pluginPackage(pkg, v), offered.some((c) => c.package === pkg)); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(null); }
  };
  return (
    <Stack gap="md">
      <div>
        <Text fw={600} size="sm" mb={6}>From this server's catalog</Text>
        {catalog.isLoading ? <Loader size="sm" /> : offered.length === 0
          ? <Text size="sm" c="dimmed">The server offers none yet: its admins list the ones they trust in Server settings → Plugins.</Text>
          : (
            <Stack gap={8}>
              {offered.map((c: CatalogPlugin) => (
                <Paper key={c.package} withBorder radius="md" p="sm">
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
                      <PluginIcon size={32} />
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>{c.title}</Text>
                        <Text size="xs" c="dimmed" ff="monospace" truncate>{c.package}{c.version ? ` ${c.version}` : ""}</Text>
                        {c.description && <Text size="xs" mt={2} lineClamp={2}>{c.description}</Text>}
                        {c.problem && <Text size="xs" c="red" mt={2}>{c.problem}</Text>}
                      </div>
                    </Group>
                    <Button size="xs" variant="light" disabled={!!c.problem} loading={busy === c.package} onClick={() => look(c.package, null)}>Choose</Button>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
      </div>
      <div>
        <Text fw={600} size="sm" mb={2}>Another package</Text>
        <Text size="xs" c="dimmed" mb={8}>Any npm package with a winche-plugin.json. You'll see what it says it does before installing it.</Text>
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <TextInput aria-label="Package" placeholder="@acme/text-messages" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
          <TextInput aria-label="Version" placeholder="newest" w={110} value={version} onChange={(e) => setVersion(e.currentTarget.value)} />
          <Button variant="default" leftSection={<IconSearch size={15} />} disabled={!name.trim()} loading={busy === name.trim()}
            onClick={() => look(name.trim(), version.trim() || null)}>Look up</Button>
        </Group>
      </div>
      {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
    </Stack>
  );
}

function InstallForm({ info, curated, taken, onBack, onDone }: {
  info: PluginPackageInfo; curated: boolean; taken: string[]; onBack: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const m = info.manifest;
  const [id, setId] = useState(() => {
    const base = suggestId(info.package);
    let n = 2, candidate = base;
    while (taken.includes(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  });
  const [values, setValues] = useState<Values>(() => startValues(m.settings));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [trusted, setTrusted] = useState(curated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idProblem = !ID_RULE.test(id) ? "Lowercase letters, digits and -, starting with a letter (up to 30)."
    : taken.includes(id) ? "A plugin is already installed with this id." : null;
  const missing = m.settings.filter((s) => s.required && (values[s.name] === null || values[s.name] === "" || values[s.name] === undefined));
  const install = async () => {
    setBusy(true); setError(null);
    try {
      await api.installPlugin({ id, package: info.package, version: info.version, settings: toSend(values) });
      for (const s of m.secrets) if (secretTyped(secrets[s.name])) await api.setFunctionSecret(secretFor(id, s.name), secrets[s.name]);
      await refresh(qc);
      onDone();
    } catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="md">
      <Group gap={10} wrap="nowrap">
        <PluginIcon />
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>{m.title}</Text>
          <Text size="xs" c="dimmed" ff="monospace">{info.package} {info.version}</Text>
        </div>
      </Group>
      {m.description && <Text size="sm">{m.description}</Text>}
      <Access manifest={m} curated={curated} />
      <TextInput label="Install as" withAsterisk value={id} onChange={(e) => setId(e.currentTarget.value.trim())} styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} error={id && idProblem}
        description={<>Its functions are called <Code>{id || "id"}.name</Code>; install it again under another id for a second copy.</>} />
      {m.settings.length > 0 && (
        <div>
          <Text fw={600} size="sm" mb={6}>Settings</Text>
          <SettingsFields settings={m.settings} values={values} onChange={setValues} />
        </div>
      )}
      {m.secrets.length > 0 && (
        <div>
          <Text fw={600} size="sm" mb={2}>Secrets</Text>
          <Text size="xs" c="dimmed" mb={8}>Kept encrypted and never shown again. You can set them later, on its Secrets tab.</Text>
          <Stack gap="sm">
            {m.secrets.map((s) => (
              <SecretInput key={s.name} label={`${s.label} (${secretFor(id || "id", s.name)})`} description={s.description ?? undefined}
                value={secrets[s.name] ?? ""} onChange={(v) => setSecrets((x) => ({ ...x, [s.name]: v }))} />
            ))}
          </Stack>
        </div>
      )}
      {!curated && <Checkbox checked={trusted} onChange={(e) => setTrusted(e.currentTarget.checked)}
        label="I trust this package: its functions will act with the server's rights." />}
      {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
      <Group justify="space-between">
        <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={15} />} onClick={onBack}>Back</Button>
        <Button onClick={install} loading={busy} disabled={!!idProblem || missing.length > 0 || !trusted}>Install</Button>
      </Group>
    </Stack>
  );
}

// ── One installed copy ──────────────────────────────────────────────────────────────────────────────────────────

function PluginDialog({ p, onClose }: { p: InstalledPlugin | null; onClose: () => void }) {
  const [tab, setTab] = useState<string | null>("overview");
  const close = () => { setTab("overview"); onClose(); };
  return (
    <Modal opened={!!p} onClose={close} radius="lg" size="xl"
      title={p && <Group gap={10} wrap="nowrap"><PluginIcon size={30} /><Text fw={700} fz={18}>{p.manifest.title}</Text>
        <Badge variant="light" tt="none" ff="monospace">{p.id}</Badge></Group>}>
      {p && (
        <Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="settings">Settings</Tabs.Tab>
            <Tabs.Tab value="secrets" rightSection={p.secretsNeeded.length > 0 ? <Badge size="xs" color="orange" circle>{p.secretsNeeded.length}</Badge> : undefined}>Secrets</Tabs.Tab>
            <Tabs.Tab value="version" rightSection={p.update ? <Badge size="xs" color="blue" variant="light" tt="none">{p.latest}</Badge> : undefined}>Version</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview"><Overview p={p} onRemoved={close} /></Tabs.Panel>
          <Tabs.Panel value="settings"><SettingsTab p={p} /></Tabs.Panel>
          <Tabs.Panel value="secrets"><SecretsTab p={p} /></Tabs.Panel>
          <Tabs.Panel value="version"><VersionTab p={p} /></Tabs.Panel>
        </Tabs>
      )}
    </Modal>
  );
}

function FromWincheJson({ p }: { p: InstalledPlugin }) {
  if (p.source !== "deploy") return null;
  return (
    <Alert color="gray" variant="light">
      Installed by a deploy from winche.json. A change made here is undone by the next deploy unless winche.json says the same; the CLI asks before it does.
    </Alert>
  );
}

function Overview({ p, onRemoved }: { p: InstalledPlugin; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const row = (label: string, value: React.ReactNode) => (
    <Group gap="md" wrap="nowrap" align="flex-start"><Text size="sm" c="dimmed" w={110} style={{ flexShrink: 0 }}>{label}</Text><div style={{ minWidth: 0 }}>{value}</div></Group>
  );
  const sample = p.functions[0];
  return (
    <Stack gap="md">
      {p.manifest.description && <Text size="sm">{p.manifest.description}</Text>}
      <Stack gap="xs">
        {row("Package", <Text size="sm" ff="monospace">{p.package} {p.version}</Text>)}
        {row("Installed", <Text size="sm">{when(p.at)}{p.by ? ` by ${p.by}` : ""}{p.source === "deploy" ? " (from winche.json)" : ""}</Text>)}
        {row("Functions", p.functions.length === 0 ? <Text size="sm" c="dimmed">none</Text>
          : <Group gap={6}>{p.functions.map((f) => <Badge key={f} variant="light" color="gray" tt="none" ff="monospace" fw={500}>{f}</Badge>)}</Group>)}
      </Stack>
      {sample && <Text size="xs" c="dimmed">Apps call its callables by name, e.g. <Code>functions.call("{sample}", …)</Code>; they're on the Dashboard tab with the project's own.</Text>}
      <Access manifest={p.manifest} curated={p.curated} />
      <Group justify="flex-end">
        <Button color="red" variant="light" leftSection={<IconTrash size={15} />} onClick={() => setRemoving(true)}>Remove plugin</Button>
      </Group>
      <RemoveModal p={p} opened={removing} onClose={() => setRemoving(false)} onRemoved={onRemoved} />
    </Stack>
  );
}

function RemoveModal({ p, opened, onClose, onRemoved }: { p: InstalledPlugin; opened: boolean; onClose: () => void; onRemoved: () => void }) {
  const qc = useQueryClient();
  const [secrets, setSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true); setError(null);
    try { await api.uninstallPlugin(p.id, secrets); await refresh(qc); onClose(); onRemoved(); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={onClose} radius="lg" title={<Text fw={700}>Remove {p.manifest.title} ({p.id})?</Text>}>
      <Stack gap="sm">
        <Text size="sm">Its {p.functions.length === 1 ? "function stops" : `${p.functions.length} functions stop`}: apps calling them get "not found". What it wrote to the project's data stays.</Text>
        {p.secrets.length > 0 && (
          <Checkbox checked={secrets} onChange={(e) => setSecrets(e.currentTarget.checked)}
            label={<>Also remove its secrets: {p.secrets.map((s) => <Code key={s.secret}>{s.secret}</Code>).reduce<React.ReactNode[]>((a, c, i) => i ? [...a, ", ", c] : [c], [])}</>} />
        )}
        <Text size="xs" c="dimmed">It's a new functions version: rolling back to the one before brings it back{secrets ? ", without its secrets" : ""}.</Text>
        <FromWincheJson p={p} />
        {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="red" onClick={remove} loading={busy}>Remove</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function SettingsTab({ p }: { p: InstalledPlugin }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Values>(() => startValues(p.manifest.settings, p.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { setValues(startValues(p.manifest.settings, p.settings)); }, [p]);
  const changed = JSON.stringify(toSend(values)) !== JSON.stringify(toSend(startValues(p.manifest.settings, p.settings)));
  const save = async () => {
    setBusy(true); setError(null); setSaved(null);
    try { const r = await api.configurePlugin(p.id, toSend(values)); setSaved(`Saved as functions version ${r.version}.`); await refresh(qc); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="md">
      <FromWincheJson p={p} />
      <SettingsFields settings={p.manifest.settings} values={values} onChange={(v) => { setValues(v); setSaved(null); }} />
      {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
      {p.manifest.settings.length > 0 && (
        <Group justify="space-between">
          <Text size="xs" c={saved ? "teal" : "dimmed"}>{saved ?? "Saving makes a new functions version; its functions use the new settings at once."}</Text>
          <Button onClick={save} loading={busy} disabled={!changed}>Save</Button>
        </Group>
      )}
    </Stack>
  );
}

function SecretsTab({ p }: { p: InstalledPlugin }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["function-secrets"], queryFn: api.functionSecrets });
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (p.secrets.length === 0) return <Text size="sm" c="dimmed">It needs no secrets.</Text>;
  const info = (name: string) => saved.data?.secrets.find((s) => s.name === name);
  const save = async (secret: string) => {
    setBusy(secret); setError(null);
    try { await api.setFunctionSecret(secret, typed[secret]); setTyped((t) => ({ ...t, [secret]: "" })); await refresh(qc); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(null); }
  };
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">This copy's own secrets, among the project's (the Secrets page lists them too). Values are kept encrypted and never shown again; a change applies from its functions' next run.</Text>
      {p.secrets.map(({ name, secret }) => {
        const s = p.manifest.secrets.find((x) => x.name === name);
        const now = info(secret);
        return (
          <Paper key={secret} withBorder radius="md" p="md">
            <Group justify="space-between" mb={8} wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>{s?.label ?? name}</Text>
                <Text size="xs" c="dimmed" ff="monospace">{secret}</Text>
              </div>
              {now?.isSet
                ? <Badge color="teal" variant="light" tt="none">Set {now.setAt ? when(now.setAt) : ""}</Badge>
                : <Badge color={s?.required === false ? "gray" : "orange"} variant="light" tt="none">{s?.required === false ? "Not set (optional)" : "Not set"}</Badge>}
            </Group>
            {s?.description && <Text size="xs" c="dimmed" mb={8}>{s.description}</Text>}
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <div style={{ flex: 1 }}>
                <SecretInput label={now?.isSet ? "New value" : "Value"} value={typed[secret] ?? ""} savedReference={now?.reference}
                  onChange={(v) => setTyped((t) => ({ ...t, [secret]: v }))} />
              </div>
              <Button onClick={() => save(secret)} loading={busy === secret} disabled={!secretTyped(typed[secret])}>{now?.isSet ? "Replace" : "Save"}</Button>
            </Group>
          </Paper>
        );
      })}
      {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
    </Stack>
  );
}

/** What moving to another version changes: settings and secrets added or gone, and what it says it does now. */
export function upgradeChanges(from: PluginManifest, to: PluginManifest) {
  const names = (l: { name: string }[]) => new Set(l.map((x) => x.name));
  const [fs, ts, fk, tk] = [names(from.settings), names(to.settings), names(from.secrets), names(to.secrets)];
  return {
    newSettings: to.settings.filter((s) => !fs.has(s.name)),
    goneSettings: from.settings.filter((s) => !ts.has(s.name)),
    newSecrets: to.secrets.filter((s) => !fk.has(s.name)),
    goneSecrets: from.secrets.filter((s) => !tk.has(s.name)),
    newAccess: to.access.filter((a) => !from.access.includes(a)),
    goneAccess: from.access.filter((a) => !to.access.includes(a)),
  };
}

function VersionTab({ p }: { p: InstalledPlugin }) {
  const qc = useQueryClient();
  const target = p.update ? p.latest : null;
  const next = useQuery({ queryKey: ["plugin-package", p.package, target], queryFn: () => api.pluginPackage(p.package, target), enabled: !!target });
  const changes = useMemo(() => next.data ? upgradeChanges(p.manifest, next.data.manifest) : null, [next.data, p.manifest]);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (next.data) setValues(startValues(next.data.manifest.settings.filter((s) => !(s.name in p.settings)))); }, [next.data, p.settings]);
  const missing = (changes?.newSettings ?? []).filter((s) => s.required && (values[s.name] === null || values[s.name] === "" || values[s.name] === undefined));
  const upgrade = async () => {
    setBusy(true); setError(null);
    try { await api.upgradePlugin(p.id, target, toSend(values)); await refresh(qc); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="md">
      <Text size="sm">This copy runs <Code>{p.package} {p.version}</Code>, and stays on it until it's upgraded here or by a deploy.</Text>
      {!p.latest && <Text size="sm" c="dimmed">Its newest version can't be found now (npm can't be reached, or the package is gone).</Text>}
      {p.latest && !p.update && <Text size="sm" c="dimmed">It's the newest version.</Text>}
      {target && next.isLoading && <Loader size="sm" />}
      {next.isError && <Alert color="red">Couldn't read {p.package} {target}: {errorMessage(next.error)}</Alert>}
      {target && next.data && changes && (
        <Paper withBorder radius="md" p="md">
          <Text fw={600} mb={8}>{target} is out</Text>
          <Stack gap={6}>
            {changes.newAccess.length + changes.goneAccess.length === 0 && changes.newSettings.length + changes.goneSettings.length + changes.newSecrets.length + changes.goneSecrets.length === 0
              && <Text size="sm" c="dimmed">Same settings, secrets and access: only its code changes.</Text>}
            {changes.newAccess.map((a) => <Text key={a} size="sm" c="orange">+ It now says: {a}</Text>)}
            {changes.goneAccess.map((a) => <Text key={a} size="sm" c="dimmed">− No longer: {a}</Text>)}
            {changes.newSecrets.map((s) => <Text key={s.name} size="sm">+ A new secret: {s.label} (<Code>{secretFor(p.id, s.name)}</Code>), set it after upgrading</Text>)}
            {changes.goneSecrets.map((s) => <Text key={s.name} size="sm" c="dimmed">− It no longer reads {secretFor(p.id, s.name)}</Text>)}
            {changes.goneSettings.map((s) => <Text key={s.name} size="sm" c="dimmed">− Setting {s.label} ({s.name}) is gone</Text>)}
          </Stack>
          {changes.newSettings.length > 0 && (
            <Stack gap={6} mt="sm">
              <Text size="sm" fw={600}>New settings</Text>
              <SettingsFields settings={next.data.manifest.settings} values={values} onChange={setValues} only={changes.newSettings.map((s) => s.name)} />
            </Stack>
          )}
          {error && <Alert color="red" mt="sm" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
          <Group justify="space-between" mt="md">
            <Text size="xs" c="dimmed">Its other settings are kept. Rolling back the functions version undoes it.</Text>
            <Button leftSection={<IconArrowUp size={15} />} onClick={upgrade} loading={busy} disabled={missing.length > 0}>Upgrade to {target}</Button>
          </Group>
        </Paper>
      )}
      <FromWincheJson p={p} />
    </Stack>
  );
}
