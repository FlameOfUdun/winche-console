import { Alert, Badge, Group, List, NumberInput, Paper, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconAlertTriangle, IconCoin, IconPuzzle } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluginCondition, PluginManifest, PluginSecretInfo, PluginSettingInfo } from "../../api/functions";
import { surface } from "../../theme";

/** Settings as a form holds them: every manifest setting, set or not. */
export type Values = Record<string, unknown>;

/** The project secret a plugin secret is for the copy installed as `id`: SMS__AUTH_TOKEN. */
export const secretFor = (id: string, name: string) => `${id.toUpperCase().replace(/-/g, "_")}__${name}`;

export const ID_RULE = /^[a-z](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/** An id to suggest for a package: its last part, without a "plugin" prefix or suffix ("@acme/winche-plugin-sms" → "sms"). */
export function suggestId(pkg: string) {
  const last = pkg.split("/").pop() ?? pkg;
  const bare = last.replace(/^(winche-)?plugin-/, "").replace(/-(winche-)?plugin$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^[^a-z]+/, "");
  return bare.slice(0, 30).replace(/-+$/, "") || "plugin";
}

/** Whether a condition holds with these settings (none: always). */
export function holds(c: PluginCondition | null | undefined, values: Values): boolean {
  if (!c) return true;
  const v = values[c.setting];
  if (c.set === true || c.set === false) {
    const set = v !== null && v !== undefined && v !== "" && v !== false;
    if (set !== c.set) return false;
  }
  if (c.is === undefined || c.is === null) return true;
  return Array.isArray(c.is) ? c.is.some((x) => x === v) : c.is === v;
}

/** Starting values: what's set, else the default (so the form shows what will be used). */
export function startValues(settings: PluginSettingInfo[], set: Values = {}): Values {
  return Object.fromEntries(settings.map((s) => [s.name, set[s.name] ?? s.default ?? (s.type === "boolean" ? false : null)]));
}

/** Values to send: unset ones left out (their default). An emptied text field is sent empty: that feature off. */
export const toSend = (v: Values) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined));

/** The required settings shown and still empty. */
export const missingSettings = (settings: PluginSettingInfo[], values: Values) =>
  settings.filter((s) => s.required && holds(s.showIf, values) && (values[s.name] === null || values[s.name] === "" || values[s.name] === undefined));

/** The secrets asked for with these settings. */
export const shownSecrets = (secrets: PluginSecretInfo[], values: Values) => secrets.filter((s) => holds(s.showIf, values));

/**
 * A setup step with its placeholders filled in: {{function:x}} → that function's address, {{setting:X}} → its value,
 * {{secret:X}} → the copy's project secret, {{id}} → the copy's id.
 */
export function fillStep(text: string, id: string, functionsUrl: string | null | undefined, values: Values) {
  return text.replace(/\{\{(function|setting|secret):([A-Za-z0-9_]+)\}\}|\{\{id\}\}/g, (_all, kind: string | undefined, what: string | undefined) => {
    if (!kind) return id;
    if (kind === "function") return functionsUrl ? `${functionsUrl}/${id}.${what}` : `…/functions/v1/http/${id}.${what}`;
    if (kind === "secret") return secretFor(id, what!);
    const v = values[what!];
    return v === null || v === undefined || v === "" ? `(${what} isn't set)` : String(v);
  });
}

/** Markdown from a package (its README, its setup steps): no raw HTML, links open in a new tab. */
export function Markdown({ children, size = "sm" }: { children: string; size?: "xs" | "sm" }) {
  return (
    <div className="winche-markdown" data-size={size}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer noopener">{c}</a> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function PluginIcon({ size = 36 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
      background: "var(--w-accent-soft)", color: "var(--w-accent)" }}>
      <IconPuzzle size={size * 0.55} stroke={1.7} />
    </div>
  );
}

/** What the plugin says it does and may cost, and that it runs with the server's rights. */
export function Access({ manifest, curated, compact = false }: { manifest: PluginManifest; curated: boolean; compact?: boolean }) {
  return (
    <Paper withBorder radius="md" p="md" bg={surface.card}>
      <Text size="sm" fw={600} mb={6}>What it does</Text>
      {manifest.access.length > 0
        ? <List size="sm" spacing={4}>{manifest.access.map((a) => <List.Item key={a}>{a}</List.Item>)}</List>
        : <Text size="sm" c="dimmed">It doesn't say.</Text>}
      {manifest.billing && (
        <Group gap={6} mt={10} wrap="nowrap" align="flex-start">
          <IconCoin size={16} style={{ flexShrink: 0, marginTop: 2 }} color="var(--mantine-color-orange-6)" />
          <Text size="sm">{manifest.billing}</Text>
        </Group>
      )}
      {!compact && (
        <Text size="xs" c="dimmed" mt={8}>
          Its functions can read and change the project's data; this list isn't enforced.
        </Text>
      )}
      {!curated && (
        <Alert color="yellow" variant="light" mt="sm" icon={<IconAlertTriangle size={16} />} title="Not in this server's catalog">
          Nobody running this server has vouched for it. Install it only if you trust who publishes it.
        </Alert>
      )}
    </Paper>
  );
}

/** A plugin's settings as fields, by their types, grouped in their sections; those whose condition doesn't hold are hidden. */
export function SettingsFields({ settings, values, onChange, only }: {
  settings: PluginSettingInfo[]; values: Values; onChange: (v: Values) => void; only?: string[];
}) {
  const shown = (only ? settings.filter((s) => only.includes(s.name)) : settings).filter((s) => holds(s.showIf, values));
  if (shown.length === 0) return <Text size="sm" c="dimmed">Nothing to set.</Text>;
  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });
  const sections: { title: string | null; items: PluginSettingInfo[] }[] = [];
  for (const s of shown) {
    const title = s.section ?? null;
    const group = sections.find((g) => g.title === title) ?? (sections.push({ title, items: [] }), sections[sections.length - 1]);
    group.items.push(s);
  }
  const field = (s: PluginSettingInfo) => {
    const label = <>{s.label}<Text span size="xs" c="dimmed" ff="monospace"> {s.name}</Text></>;
    const common = { description: s.description ?? undefined, withAsterisk: s.required };
    if (s.type === "boolean")
      return <Switch key={s.name} label={label} description={s.description ?? undefined} checked={!!values[s.name]} onChange={(e) => set(s.name, e.currentTarget.checked)} />;
    if (s.type === "select")
      return <Select key={s.name} {...common} label={label} data={s.options ?? []} value={(values[s.name] as string) ?? null} onChange={(v) => set(s.name, v)} clearable={!s.required} />;
    if (s.type === "number" || s.type === "integer")
      return <NumberInput key={s.name} {...common} label={label} allowDecimal={s.type === "number"} value={(values[s.name] as number) ?? ""}
        onChange={(v) => set(s.name, typeof v === "number" ? v : null)} />;
    return <TextInput key={s.name} {...common} label={label} value={(values[s.name] as string) ?? ""} onChange={(e) => set(s.name, e.currentTarget.value)} />;
  };
  return (
    <Stack gap="lg">
      {sections.map((g) => (
        <Stack key={g.title ?? ""} gap="sm" data-testid="settings-section">
          {g.title && <Text fw={600} size="sm" c={surface.muted} tt="uppercase" fz={11} style={{ letterSpacing: "0.04em" }}>{g.title}</Text>}
          {g.items.map(field)}
        </Stack>
      ))}
    </Stack>
  );
}

/** "In this server's catalog" or not, as a badge. */
export function CatalogBadge({ curated }: { curated: boolean }) {
  return curated
    ? <Badge color="teal" variant="light" tt="none">In the catalog</Badge>
    : <Badge color="yellow" variant="light" tt="none">Not in the catalog</Badge>;
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
