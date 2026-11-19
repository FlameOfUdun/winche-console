import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Code, CopyButton, Group, Loader, Modal, Paper, Stack, Table, Text, Timeline, Tooltip,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconArrowUp, IconCheck, IconCopy, IconHistory, IconKey, IconTrash } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorMessage, errorWithList } from "../../api/appAuth";
import type { InstalledPlugin } from "../../api/functions";
import { secretTyped } from "../../api/secrets";
import { PageBand } from "../../components/NavPageHeader";
import { EmptyState } from "../../components/EmptyState";
import { SecretInput } from "../../components/SecretInput";
import { when } from "../authentication/UsersView";
import {
  Access, Markdown, PluginIcon, SettingsFields, fillStep, holds, missingSettings, secretFor, shownSecrets, startValues, toSend, upgradeChanges, type Values,
} from "./shared";
import { packagePath } from "./PluginsPage";

type Tab = "overview" | "configuration" | "secrets" | "functions" | "history" | "version";

const refresh = async (qc: ReturnType<typeof useQueryClient>) => {
  await qc.invalidateQueries({ queryKey: ["plugins"] });
  await qc.invalidateQueries({ queryKey: ["functions"] });
  await qc.invalidateQueries({ queryKey: ["function-secrets"] });
  await qc.invalidateQueries({ queryKey: ["plugin-history"] });
};

/** One installed copy: what's left to set up, its configuration, secrets, functions, history and version. */
export function InstalledPluginPage() {
  const { id = "" } = useParams();
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.plugins });
  const [tab, setTab] = useState<Tab>("overview");
  const back = <Anchor component={Link} to="/plugins" size="sm"><Group gap={4}><IconArrowLeft size={14} />Plugins</Group></Anchor>;
  if (plugins.isLoading) return <><PageBand title={id}>{back}</PageBand><Loader size="sm" /></>;
  if (plugins.isError) return <><PageBand title={id}>{back}</PageBand><Alert color="red">Couldn't load the plugins: {errorMessage(plugins.error)}</Alert></>;
  const p = plugins.data?.plugins.find((x) => x.id === id);
  if (!p) return (
    <><PageBand title={id}>{back}</PageBand>
      <EmptyState icon={IconHistory} title={`There's no plugin installed as ${id}`} description="It may have been removed, or its functions version rolled back."
        action={<Button component={Link} to="/plugins">All plugins</Button>} /></>
  );
  const needs = p.secretsNeeded.length;
  return (
    <>
      <PageBand
        title={<Group gap={12} wrap="nowrap"><PluginIcon size={40} /><span>{p.manifest.title}</span><Badge variant="light" tt="none" ff="monospace" size="lg">{p.id}</Badge></Group>}
        description={p.manifest.description ?? undefined}
        tabs={([
          ["overview", "Overview"], ["configuration", "Configuration"], ["secrets", needs ? `Secrets (${needs} needed)` : "Secrets"],
          ["functions", "Functions"], ["history", "History"], ["version", p.update ? `Version (${p.latest} is out)` : "Version"],
        ] as const).map(([t, label]) => ({ label, active: tab === t, onClick: () => setTab(t) }))}>
        <Group gap="md" mt="sm" wrap="wrap">
          {back}
          <Anchor component={Link} to={packagePath(p.package, p.version)} size="sm" ff="monospace">{p.package} {p.version}</Anchor>
          {p.source === "deploy" && <Badge color="gray" variant="light" tt="none">From winche.json</Badge>}
          {!p.curated && <Badge color="yellow" variant="light" tt="none">Not in the catalog</Badge>}
        </Group>
      </PageBand>
      <div style={{ paddingBottom: 28, maxWidth: 960 }}>
        {p.source === "deploy" && tab !== "overview" && tab !== "functions" && tab !== "history" && (
          <Alert color="gray" variant="light" mb="md">
            Installed by a deploy from winche.json. A change made here is undone by the next deploy unless winche.json says the same; the CLI asks before it does.
          </Alert>
        )}
        {tab === "overview" && <Overview p={p} functionsUrl={plugins.data?.functionsUrl ?? null} goTo={setTab} />}
        {tab === "configuration" && <Configuration p={p} />}
        {tab === "secrets" && <Secrets p={p} />}
        {tab === "functions" && <Functions p={p} />}
        {tab === "history" && <History p={p} />}
        {tab === "version" && <Version p={p} />}
      </div>
    </>
  );
}

function Overview({ p, functionsUrl, goTo }: { p: InstalledPlugin; functionsUrl: string | null; goTo: (t: Tab) => void }) {
  const [removing, setRemoving] = useState(false);
  const steps = (p.manifest.setup ?? []).filter((s) => holds(s.showIf, p.settings as Values));
  const addresses = p.functions.filter((f) => (p.manifest.setup ?? []).some((s) => s.text.includes(`{{function:${f.slice(p.id.length + 1)}}}`)));
  return (
    <Stack gap="lg">
      {p.secretsNeeded.length > 0 && (
        <Alert color="orange" variant="light" icon={<IconKey size={16} />} title="It needs its secrets">
          {p.secretsNeeded.join(", ")} {p.secretsNeeded.length === 1 ? "isn't" : "aren't"} set: its functions that read {p.secretsNeeded.length === 1 ? "it" : "them"} fail until then.{" "}
          <Anchor component="button" size="sm" onClick={() => goTo("secrets")}>Set {p.secretsNeeded.length === 1 ? "it" : "them"}</Anchor>
        </Alert>
      )}
      {steps.length > 0 && (
        <Paper withBorder radius="md" p="lg">
          <Text fw={600} mb={4}>Set it up</Text>
          <Text size="sm" c="dimmed" mb="md">What's left to do outside Winche, as the plugin explains it.</Text>
          <Timeline bulletSize={24} lineWidth={2} active={-1}>
            {steps.map((s, i) => (
              <Timeline.Item key={i} bullet={<Text size="xs" fw={700}>{i + 1}</Text>} data-testid="setup-step">
                <Markdown>{fillStep(s.text, p.id, functionsUrl, p.settings as Values)}</Markdown>
              </Timeline.Item>
            ))}
          </Timeline>
          {addresses.length > 0 && (
            <Stack gap={6} mt="sm">
              {addresses.map((f) => {
                const url = `${functionsUrl ?? ""}/${f}`;
                return (
                  <Group key={f} gap={6} wrap="nowrap">
                    <Code style={{ overflowX: "auto", whiteSpace: "nowrap", flex: 1 }}>{url}</Code>
                    <CopyButton value={url}>{({ copied, copy }) => (
                      <Tooltip label={copied ? "Copied" : "Copy"}><ActionIcon variant="subtle" onClick={copy} aria-label={`Copy ${f}'s address`}>{copied ? <IconCheck size={15} /> : <IconCopy size={15} />}</ActionIcon></Tooltip>
                    )}</CopyButton>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Paper>
      )}
      <Paper withBorder radius="md" p="lg">
        <Table withRowBorders={false} verticalSpacing={4}>
          <Table.Tbody>
            <Table.Tr><Table.Td c="dimmed" w={140}>Installed</Table.Td><Table.Td>{when(p.at)}{p.by ? ` by ${p.by}` : ""}{p.source === "deploy" ? " (from winche.json)" : ""}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td c="dimmed">Functions</Table.Td><Table.Td>
              <Group gap={6}>{p.functions.map((f) => <Badge key={f} variant="light" color="gray" tt="none" ff="monospace" fw={500}>{f}</Badge>)}</Group>
            </Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>
        {p.functions[0] && <Text size="xs" c="dimmed" mt="sm">Apps call its callables by name, e.g. <Code>functions.call("{p.functions[0]}", …)</Code>.</Text>}
      </Paper>
      <Access manifest={p.manifest} curated={p.curated} />
      <Paper withBorder radius="md" p="lg" style={{ borderColor: "var(--mantine-color-red-3)" }}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={600}>Remove this plugin</Text>
            <Text size="sm" c="dimmed">Its functions stop; what it wrote to the project's data stays.</Text>
          </div>
          <Button color="red" variant="light" leftSection={<IconTrash size={15} />} onClick={() => setRemoving(true)}>Remove</Button>
        </Group>
      </Paper>
      <RemoveModal p={p} opened={removing} onClose={() => setRemoving(false)} />
    </Stack>
  );
}

function RemoveModal({ p, opened, onClose }: { p: InstalledPlugin; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [secrets, setSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true); setError(null);
    try { await api.uninstallPlugin(p.id, secrets); await refresh(qc); onClose(); navigate("/plugins"); }
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
        {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="red" onClick={remove} loading={busy}>Remove</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Configuration({ p }: { p: InstalledPlugin }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Values>(() => startValues(p.manifest.settings, p.settings as Values));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { setValues(startValues(p.manifest.settings, p.settings as Values)); }, [p]);
  const changed = JSON.stringify(toSend(values)) !== JSON.stringify(toSend(startValues(p.manifest.settings, p.settings as Values)));
  const missing = missingSettings(p.manifest.settings, values);
  const save = async () => {
    setBusy(true); setError(null); setSaved(null);
    try { const r = await api.configurePlugin(p.id, toSend(values)); setSaved(`Saved as functions version ${r.version}.`); await refresh(qc); }
    catch (e) { setError(errorWithList(e)); }
    finally { setBusy(false); }
  };
  if (p.manifest.settings.length === 0) return <Text size="sm" c="dimmed">It has no settings.</Text>;
  return (
    <Paper withBorder radius="md" p="lg">
      <SettingsFields settings={p.manifest.settings} values={values} onChange={(v) => { setValues(v); setSaved(null); }} />
      {error && <Alert color="red" mt="md" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
      <Group justify="space-between" mt="lg">
        <Text size="xs" c={saved ? "teal" : "dimmed"}>{saved ?? "Saving makes a new functions version; its functions use the new settings at once."}</Text>
        <Button onClick={save} loading={busy} disabled={!changed || missing.length > 0}>Save</Button>
      </Group>
    </Paper>
  );
}

function Secrets({ p }: { p: InstalledPlugin }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["function-secrets"], queryFn: api.functionSecrets });
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = shownSecrets(p.manifest.secrets, p.settings as Values);
  if (asked.length === 0) return <Text size="sm" c="dimmed">It needs no secrets with its settings.</Text>;
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
      {asked.map((s) => {
        const secret = secretFor(p.id, s.name);
        const now = info(secret);
        return (
          <Paper key={secret} withBorder radius="md" p="md">
            <Group justify="space-between" mb={8} wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>{s.label}</Text>
                <Text size="xs" c="dimmed" ff="monospace">{secret}</Text>
              </div>
              {now?.isSet
                ? <Badge color="teal" variant="light" tt="none">Set {now.setAt ? when(now.setAt) : ""}</Badge>
                : <Badge color={s.required ? "orange" : "gray"} variant="light" tt="none">{s.required ? "Not set" : "Not set (optional)"}</Badge>}
            </Group>
            {s.description && <Text size="xs" c="dimmed" mb={8}>{s.description}</Text>}
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

function Functions({ p }: { p: InstalledPlugin }) {
  const page = useQuery({ queryKey: ["functions"], queryFn: api.functions });
  const fns = (page.data?.current?.functions ?? []).filter((f) => f.plugin === p.id);
  if (page.isLoading) return <Loader size="sm" />;
  return (
    <Paper withBorder radius="md">
      <Table verticalSpacing="sm" horizontalSpacing="md">
        <Table.Thead><Table.Tr><Table.Th>Function</Table.Th><Table.Th>Runs</Table.Th><Table.Th>What it does</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {fns.map((f) => (
            <Table.Tr key={f.name}>
              <Table.Td><Text size="sm" ff="monospace" fw={500}>{f.name}</Text></Table.Td>
              <Table.Td><Text size="sm" c="dimmed">{f.description}</Text></Table.Td>
              <Table.Td><Text size="sm">{f.about ?? ""}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" p="md" pt={0}>Run them, see their runs, instances and limits on <Anchor component={Link} to="/functions" size="xs">Functions</Anchor>, with the project's own.</Text>
    </Paper>
  );
}

function History({ p }: { p: InstalledPlugin }) {
  const history = useQuery({ queryKey: ["plugin-history", p.id], queryFn: () => api.pluginHistory(p.id) });
  if (history.isLoading) return <Loader size="sm" />;
  const list = history.data?.history ?? [];
  return (
    <Paper withBorder radius="md" p="lg">
      <Timeline bulletSize={22} lineWidth={2}>
        {list.map((h) => (
          <Timeline.Item key={h.version} bullet={<IconHistory size={12} />} data-testid="history-entry"
            title={<Group gap={8}><Text size="sm" fw={600}>{h.what}</Text><Badge size="xs" variant="light" color="gray" tt="none">version {h.version}</Badge>
              {h.rolledBackFrom && <Badge size="xs" variant="light" color="blue" tt="none">back to {h.rolledBackFrom}</Badge>}</Group>}>
            <Text size="xs" c="dimmed">{when(h.at)}{h.by ? ` · ${h.by}` : ""}</Text>
            {h.note && <Text size="sm" mt={2} style={{ fontStyle: "italic" }}>“{h.note}”</Text>}
          </Timeline.Item>
        ))}
      </Timeline>
      <Text size="xs" c="dimmed" mt="md">Each change is a functions version: roll back to one in Functions → Settings → Change history.</Text>
    </Paper>
  );
}

function Version({ p }: { p: InstalledPlugin }) {
  const qc = useQueryClient();
  const target = p.update ? p.latest : null;
  const next = useQuery({ queryKey: ["plugin-package", p.package, target], queryFn: () => api.pluginPackage(p.package, target), enabled: !!target });
  const changes = useMemo(() => next.data ? upgradeChanges(p.manifest, next.data.manifest) : null, [next.data, p.manifest]);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (next.data) setValues({ ...startValues(next.data.manifest.settings, p.settings as Values) });
  }, [next.data, p.settings]);
  const missing = next.data ? missingSettings(next.data.manifest.settings, values) : [];
  const upgrade = async () => {
    setBusy(true); setError(null);
    try {
      const fresh = Object.fromEntries(Object.entries(toSend(values)).filter(([k]) => changes?.newSettings.some((s) => s.name === k)));
      await api.upgradePlugin(p.id, target, fresh); await refresh(qc);
    }
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
        <Paper withBorder radius="md" p="lg">
          <Group justify="space-between" mb={8}>
            <Text fw={600}>{target} is out</Text>
            <Anchor component={Link} to={packagePath(p.package, target)} size="sm">What's in it</Anchor>
          </Group>
          <Stack gap={6}>
            {changes.newAccess.length + changes.goneAccess.length + changes.newSettings.length + changes.goneSettings.length + changes.newSecrets.length + changes.goneSecrets.length === 0
              && <Text size="sm" c="dimmed">Same settings, secrets and access: only its code changes.</Text>}
            {changes.newAccess.map((a) => <Text key={a} size="sm" c="orange">+ It now says: {a}</Text>)}
            {changes.goneAccess.map((a) => <Text key={a} size="sm" c="dimmed">− No longer: {a}</Text>)}
            {changes.newSecrets.map((s) => <Text key={s.name} size="sm">+ A new secret: {s.label} (<Code>{secretFor(p.id, s.name)}</Code>), set it after upgrading</Text>)}
            {changes.goneSecrets.map((s) => <Text key={s.name} size="sm" c="dimmed">− It no longer reads {secretFor(p.id, s.name)}</Text>)}
            {changes.goneSettings.map((s) => <Text key={s.name} size="sm" c="dimmed">− Setting {s.label} ({s.name}) is gone</Text>)}
            {changes.newSettings.length > 0 && <Text size="sm">+ New settings: {changes.newSettings.map((s) => s.label).join(", ")}</Text>}
          </Stack>
          {changes.newSettings.length > 0 && (
            <Stack gap={6} mt="md">
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
    </Stack>
  );
}
