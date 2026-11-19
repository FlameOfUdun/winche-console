import { useState, type ReactNode } from "react";
import { NumberInput, Textarea } from "@mantine/core";
import {
  Alert, Badge, Group, Loader, Paper, Switch, Text, Timeline, Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowBackUp, IconCheck, IconClockHour4, IconHistory, IconServer, IconShieldLock,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { type ServerSettings } from "../../api/server";
import { ConsoleSignInMethods } from "./ConsoleProviders";
import { PageBand } from "../../components/NavPageHeader";
import { CardsPage, EditCard, HistoryButton, OnOff } from "../../components/EditCard";
import { Navigate, useParams } from "react-router-dom";
import { SERVER_SECTIONS, sectionPath } from "./sections";
import { ConsoleAccountsScope } from "../authentication/authScope";
import { UsersView } from "../authentication/UsersView";
import { EmailTemplatesView } from "../authentication/EmailTemplatesView";
import { AuthSettingsCards } from "../authentication/SignInSettings";
import { KeycloakSyncView } from "../authentication/KeycloakSyncView";
import { SettingsCard } from "../../components/SettingRows";
import { EmptyState } from "../../components/EmptyState";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";


const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A setting: its name, its control, and where its value comes from — the deployment's (Winche__…), or changed here
 * (with the deployment's value, and a way back to it).
 */
function Setting({ icon: Icon, label, value, deployed, onReset, children }: {
  icon: React.ElementType; label: string; value: unknown; deployed: unknown; onReset: () => void; children: ReactNode;
}) {
  const fromDeployment = same(value, deployed);
  const shown = Array.isArray(deployed) ? (deployed.length ? deployed.join(", ") : "none") : deployed === null || deployed === "" ? "none" : String(deployed);
  return (
    <Group justify="space-between" wrap="wrap" gap="md" px="md" py={12} className="winche-setting-row">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0,
          background: "var(--w-accent-soft)", color: "var(--w-accent)" }}>
          <Icon size={17} stroke={1.8} />
        </div>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={500}>{label}</Text>
          {fromDeployment ? (
            <Text size="xs" c={surface.faint}>From the deployment</Text>
          ) : (
            <Group gap={6}>
              <Text size="xs" c="winche.7">Changed here · deployment: <Text span ff="monospace" fz="xs">{shown}</Text></Text>
              <Tooltip label="Use the deployment's value" withArrow>
                <UnstyledButton onClick={onReset} aria-label={`Use the deployment's ${label.toLowerCase()}`} style={{ display: "flex" }}>
                  <IconArrowBackUp size={14} color="var(--w-accent)" />
                </UnstyledButton>
              </Tooltip>
            </Group>
          )}
        </div>
      </Group>
      <div style={{ flex: "0 1 360px", minWidth: 200 }}>{children}</div>
    </Group>
  );
}

/** Where a value comes from, under its name: the deployment's, or changed here (with the deployment's). */
function source(value: unknown, deployed: unknown) {
  if (same(value, deployed)) return "From the deployment";
  const shown = Array.isArray(deployed) ? (deployed.length ? deployed.join(", ") : "none") : deployed === null || deployed === "" ? "none" : String(deployed);
  return <Text span size="xs" c="var(--w-accent)">Changed here · deployment: <Text span ff="monospace" fz="xs">{shown}</Text></Text>;
}

/**
 * The server's own settings, for server admins, as tabs of cards: each card shows what's set and where
 * it comes from, and is edited in place and saved with a reason.
 */
export function ServerSettingsPage() {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["server-settings"], queryFn: api.serverSettings, retry: false });
  const { section: slug, tab: tabSlug } = useParams();
  const current = SERVER_SECTIONS.find((s) => s.id === slug);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServerSettings | null>(null);

  if (!current) return <Navigate to={sectionPath(SERVER_SECTIONS[0])} replace />;
  // A section with tabs is always on one of them; one without has none.
  if (current.tabs.length ? !current.tabs.some((t) => t.id === tabSlug) : tabSlug) return <Navigate to={sectionPath(current)} replace />;
  const tab = tabSlug ?? current.id;
  const band = (
    <PageBand title={current.label}
      tabs={current.tabs.length ? current.tabs.map((x) => ({ label: x.label, to: `/server/${current.id}/${x.id}`, active: x.id === tab })) : undefined} />
  );
  // Users, Templates and Settings: Authentication's own pages, over the console's accounts.
  if (tab !== "sign-in") return (
    <>
      {band}
      <ConsoleAccountsScope>
        <div style={{ paddingBottom: 28 }}>
          {tab === "users" && <UsersView />}
          {tab === "templates" && <EmailTemplatesView />}
          {tab === "settings" && <AuthSettingsCards wincheAuth />}
        </div>
      </ConsoleAccountsScope>
    </>
  );
  if (page.isLoading) return <>{band}<Loader size="sm" /></>;
  if (page.isError || !page.data) return <>{band}<Alert color="red">Couldn't load the server's settings: {errorMessage(page.error)}</Alert></>;
  const d = page.data;
  const s = d.settings;
  const dep = d.deployment;
  const x = draft ?? s;
  const set = (patch: Partial<ServerSettings>) => draft && setDraft({ ...draft, ...patch });
  const reset = <K extends keyof ServerSettings>(key: K) => set({ [key]: dep[key] } as Partial<ServerSettings>);
  const cancel = () => { setEditing(null); setDraft(null); };
  const card = (id: string) => ({
    editing: editing === id,
    onEdit: () => { setDraft(structuredClone(s)); setEditing(id); },
    onCancel: cancel,
    onSave: async (reason: string) => {
      await api.saveServerSettings({ ...draft!, publicUrl: dep.publicUrl, pluginCatalog: (draft!.pluginCatalog ?? []).filter((p) => p.length > 0) }, reason, d.version?.number ?? 0);   // the deployment's, always
      await qc.invalidateQueries({ queryKey: ["server-settings"] });
      await qc.invalidateQueries({ queryKey: ["server-settings-history"] });
      cancel();
    },
  });
  const providersOn = (s.consoleProviders ?? []).some((p) => p.enabled);
  // Like Authentication's pages: the version in force, and Change history beside it.
  const intro = d.version
    ? `Version ${d.version.number}, ${when(d.version.at)}${d.version.by ? ` by ${d.version.by}` : ""}${d.version.reason ? ` — ${d.version.reason}` : ""}. Changes apply within seconds; each save is kept as a version, with who made it and why.`
    : "The deployment's values are in force. Changes apply within seconds; each save is kept as a version, with who made it and why.";

  return (
    <>
      {band}
      <CardsPage intro={intro} history={<HistoryButton subtitle="Server settings"><ServerHistory /></HistoryButton>}>
        <ConsoleSignInMethods page={d} />
        <EditCard title="Changing settings" description="What it takes to change a project's or the server's settings." {...card("sessions")}
          rows={[{ label: "Two-step sign-in to change settings", hint: <>{source(s.requireTwoFactorForSettings, dep.requireTwoFactorForSettings)}
            {providersOn && <> · a provider's own two-step counts where it's trusted</>}</>,
            value: <OnOff on={s.requireTwoFactorForSettings} onLabel="Required" offLabel="Not required" /> }]}
          form={draft && (
            <SettingsCard>
              <Setting icon={IconShieldLock} label="Two-step sign-in to change settings" value={x.requireTwoFactorForSettings}
                deployed={dep.requireTwoFactorForSettings} onReset={() => reset("requireTwoFactorForSettings")}>
                <Group justify="flex-end">
                  <Switch aria-label="Two-step sign-in to change settings" checked={x.requireTwoFactorForSettings}
                    onChange={(e) => set({ requireTwoFactorForSettings: e.currentTarget.checked })} />
                </Group>
              </Setting>
            </SettingsCard>
          )} />
        <EditCard title="Functions" description={<>What a project's functions may use at most on this server; projects choose their defaults and each function's own up to this.
          {d.functionsMemory && <> Functions' processes may hold {d.functionsMemory.totalMb} MB in all ({d.functionsMemory.source === "set" ? "set by WINCHE_FUNCTIONS_MEMORY_MB"
            : `60% of the ${d.functionsMemory.source}'s memory`}); {d.functionsMemory.usedMb} MB is taken now.</>}</>} {...card("functions")}
          rows={[
            { label: "Longest run", hint: source(s.functionsMaxMinutes, dep.functionsMaxMinutes), value: `${s.functionsMaxMinutes} min` },
            { label: "Most memory a function may ask for", hint: source(s.functionsMaxMemoryMb, dep.functionsMaxMemoryMb), value: `${s.functionsMaxMemoryMb} MB` },
            { label: "Runs at once per project", hint: source(s.functionsMaxConcurrency, dep.functionsMaxConcurrency), value: `${s.functionsMaxConcurrency}` },
            { label: "Shared process's limit", hint: source(s.functionsSharedProcessMb, dep.functionsSharedProcessMb), value: `${s.functionsSharedProcessMb} MB per run` },
            { label: "Processes per project", hint: source(s.functionsMaxProcesses, dep.functionsMaxProcesses), value: `${s.functionsMaxProcesses}` },
          ]}
          form={draft && (
            <SettingsCard>
              <Setting icon={IconClockHour4} label="Longest run" value={x.functionsMaxMinutes} deployed={dep.functionsMaxMinutes} onReset={() => reset("functionsMaxMinutes")}>
                <Group justify="flex-end">
                  <NumberInput aria-label="Longest run in minutes" w={140} min={1} max={60} suffix=" min" value={x.functionsMaxMinutes}
                    onChange={(v) => set({ functionsMaxMinutes: typeof v === "number" ? v : 9 })} />
                </Group>
              </Setting>
              {([
                ["functionsMaxMemoryMb", "Most memory a function may ask for", " MB", 64, d.functionsMemory?.totalMb, 1024],
                ["functionsMaxConcurrency", "Runs at once per project", "", 1, 256, 16],
                ["functionsSharedProcessMb", "Shared process's limit", " MB", 128, d.functionsMemory?.totalMb, 1024],
                ["functionsMaxProcesses", "Processes per project", "", 1, 16, 4],
              ] as const).map(([key, label, suffix, min, max, fallback]) => (
                <Setting key={key} icon={IconServer} label={label} value={x[key]} deployed={dep[key]} onReset={() => reset(key)}>
                  <Group justify="flex-end">
                    <NumberInput aria-label={label} w={140} min={min} max={max} suffix={suffix} value={x[key]}
                      onChange={(v) => set({ [key]: typeof v === "number" ? Math.round(v) : fallback })} />
                  </Group>
                </Setting>
              ))}
              <Text size="xs" c="dimmed" mt="xs">
                A run past the shared process's limit stops that process and every run in it; a function asking for more memory runs in a
                process of its own when the functions memory has room. The shared process's limit applies when it next starts.
              </Text>
              <Text size="xs" c="dimmed" mt="xs">A run that long still ends if the server restarts: long work should save its progress as it goes.</Text>
            </SettingsCard>
          )} />
        <EditCard title="Plugins" description="The plugin packages (npm) the console offers projects: the ones you trust. A project's admins can still install others, warned first that nobody here vouched for them." {...card("plugins")}
          rows={[{ label: "Catalog", hint: (s.pluginCatalog ?? []).length === 0 ? "none: projects see only the search for a package" : undefined,
            value: (s.pluginCatalog ?? []).length === 0 ? "—" : <Text size="sm" ff="monospace" style={{ whiteSpace: "pre-line", textAlign: "right" }}>{(s.pluginCatalog ?? []).join("\n")}</Text> }]}
          form={draft && (
            <SettingsCard>
              <div style={{ padding: 16 }}>
                <Textarea label="Packages" description="One npm package name per line, e.g. @acme/text-messages." autosize minRows={3} maxRows={12} ff="monospace"
                  value={(x.pluginCatalog ?? []).join("\n")}
                  onChange={(e) => set({ pluginCatalog: e.currentTarget.value.split("\n").map((l) => l.trim()).filter((l, i, all) => l.length > 0 || i === all.length - 1) })} />
              </div>
            </SettingsCard>
          )} />
        {s.consoleProviders.some((p) => p.keycloakSync) && <ConsoleAccountsScope><KeycloakSyncView /></ConsoleAccountsScope>}
      </CardsPage>
    </>
  );
}

function ServerHistory() {
  const history = useQuery({ queryKey: ["server-settings-history"], queryFn: api.serverSettingsHistory });
  if (history.isLoading) return <Loader size="sm" />;
  const versions = history.data?.versions ?? [];
  if (versions.length === 0)
    return <EmptyState icon={IconHistory} title="No changes yet" description="The deployment's values are in force. Saved changes show up here: who made them, when and why." />;
  return (
    <Paper withBorder radius="md" p="lg">
      <Timeline active={versions.findIndex((v) => v.current)} color="teal" bulletSize={26} lineWidth={2}>
        {versions.map((v) => (
          <Timeline.Item key={v.id} bullet={v.current ? <IconCheck size={14} /> : <IconServer size={14} />} data-testid="server-version"
            title={<Group gap={8}><Text fw={600} size="sm">Version {v.number}</Text>{v.current && <Badge size="xs" variant="light" color="teal" tt="none">In use</Badge>}</Group>}>
            <Text size="xs" c="dimmed">{when(v.at)}{v.by ? ` · ${v.by}` : ""}</Text>
            {v.reason && <Text size="sm" mt={4} style={{ fontStyle: "italic" }}>“{v.reason}”</Text>}
          </Timeline.Item>
        ))}
      </Timeline>
    </Paper>
  );
}
