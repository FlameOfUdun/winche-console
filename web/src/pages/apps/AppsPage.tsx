import { useState, type ReactNode } from "react";
import {
  ActionIcon, Alert, Button, CopyButton, Group, Loader, Modal, Paper, SimpleGrid, Stack, Table, Text, Title, Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBrandAndroid, IconBrandApple, IconBrandFlutter, IconBrandUbuntu, IconBrandWindows, IconCheck, IconCopy, IconDeviceDesktop, IconDownload,
  IconWorld,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
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

/** One fact about the project: label, value (monospace when it's an id or address) and a copy button. */
function Fact({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <Group justify="space-between" gap="md" py={12} wrap="nowrap" style={{ borderTop: `1px solid ${surface.subtle}` }}>
      <Text size="sm" c={surface.muted} w={180} style={{ flexShrink: 0 }}>{label}</Text>
      <Group gap={4} wrap="nowrap" style={{ flex: 1, minWidth: 0 }} justify="flex-end">
        <Text size="sm" fw={500} ff={mono ? "monospace" : undefined} truncate>{value}</Text>
        <Copy value={value} label={label.toLowerCase()} />
      </Group>
    </Group>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper withBorder p="lg">
      <Title order={2} fz={16} mb="sm">{title}</Title>
      {children}
    </Paper>
  );
}

/** Project settings → General: the project's details, and adding an app to it. */
export function GeneralSettings() {
  const page = useQuery({ queryKey: ["apps", "android,ios,web"], queryFn: () => api.apps(["android", "ios", "web"]) });
  const [adding, setAdding] = useState(false);
  if (page.isLoading) return <Loader size="sm" />;
  if (page.error || !page.data) return <Alert color="red">Couldn't load the project: {String(page.error)}</Alert>;
  const { setup } = page.data;
  const consoleUrl = document.baseURI.replace(/\/$/, "");

  return (
    <Stack gap="lg" maw={900}>
      <Section title="Your project">
        <Fact label="Project name" value={setup.name ?? setup.projectId} mono={false} />
        <Fact label="Project id" value={setup.projectId} />
        <Fact label="Server address" value={setup.baseUrl} />
        <Fact label="Console" value={consoleUrl} />
      </Section>

      <Section title="Your apps">
        <SimpleGrid cols={{ base: 2, sm: 4, md: 7 }} spacing="sm">
          {SDKS.map((sdk) => {
            const Icon = sdk.icon;
            const tile = (
              <UnstyledButton key={sdk.id} disabled={!sdk.ready} onClick={() => setAdding(true)}
                aria-label={sdk.ready ? `Add a ${sdk.label} app` : `${sdk.label}: not available yet`}
                style={{ border: `1px solid ${surface.border}`, borderRadius: 12, padding: "16px 8px", display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 8, opacity: sdk.ready ? 1 : 0.45, cursor: sdk.ready ? "pointer" : "not-allowed",
                  background: sdk.ready ? surface.card : surface.page }}>
                <Icon size={26} stroke={1.6} color={sdk.ready ? "var(--mantine-color-winche-6)" : surface.faint} />
                <Text size="sm" fw={600}>{sdk.label}</Text>
              </UnstyledButton>
            );
            return sdk.ready ? tile : <Tooltip key={sdk.id} label="Not available yet" withArrow>{tile}</Tooltip>;
          })}
        </SimpleGrid>
      </Section>

      <Section title="What apps see">
        <Table verticalSpacing={8} fz="sm">
          <Table.Tbody>
            {setup.services.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td w={180} c={surface.muted}>{s.id[0].toUpperCase() + s.id.slice(1)}</Table.Td>
                <Table.Td ff="monospace">{s.path}{s.livePath && <Text span c={surface.faint} ff="monospace"> · live {s.livePath}</Text>}</Table.Td>
              </Table.Tr>
            ))}
            {setup.providers.map((p) => (
              <Table.Tr key={p.name}>
                <Table.Td c={surface.muted}>Sign in with {p.displayName}</Table.Td>
                <Table.Td ff="monospace">{p.clientIds.join(", ")}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>

      <AddAppDialog opened={adding} baseUrl={setup.baseUrl} snippet={page.data.snippet} onClose={() => setAdding(false)} />
    </Stack>
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

/** The steps to connect a Flutter app: packages, the options file (by the CLI, or downloaded), main(). */
function AddAppDialog({ opened, baseUrl, snippet, onClose }: { opened: boolean; baseUrl: string; snippet: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const data = await api.apps(ALL_PLATFORMS);
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
    <Modal opened={opened} onClose={onClose} title={<Text fw={700} fz={18}>Add a Flutter app</Text>} size="lg" radius="lg">
      <Stack gap="xl" pt="xs">
        <Step n={1} title="Add the packages">
          <Command value="flutter pub add winche_flutter winche_database winche_storage winche_auth winche_functions" />
        </Step>
        <Step n={2} title="Add lib/winche_options.dart">
          <Command value={`winche configure --url ${baseUrl}`} />
          <Group gap="xs">
            <Text size="sm" c={surface.faint}>or</Text>
            <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} loading={busy} onClick={download}>Download winche_options.dart</Button>
          </Group>
        </Step>
        <Step n={3} title="Start Winche in main()">
          <Command value={snippet} />
        </Step>
        <Group justify="flex-end"><Button onClick={onClose}>Done</Button></Group>
      </Stack>
    </Modal>
  );
}
