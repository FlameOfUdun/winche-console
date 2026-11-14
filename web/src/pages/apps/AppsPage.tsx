import { useState, type ReactNode } from "react";
import {
  ActionIcon, Alert, Anchor, Button, Code, CopyButton, Group, Loader, Modal, Paper, SimpleGrid, Stack, Table, Text, Title, Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBrandAndroid, IconBrandApple, IconBrandUbuntu, IconBrandWindows, IconCheck, IconCopy, IconDeviceDesktop, IconDownload, IconWorld,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { PLATFORM_LABEL } from "../../api/apps";
import { surface } from "../../theme";

const PLATFORM_ICON: Record<string, typeof IconWorld> = {
  android: IconBrandAndroid, ios: IconBrandApple, macos: IconDeviceDesktop, web: IconWorld, windows: IconBrandWindows, linux: IconBrandUbuntu,
};

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

function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" align="flex-start" gap="sm" mb="sm" wrap="wrap">
        <div>
          <Title order={2} fz={16}>{title}</Title>
          {description && <Text size="sm" c={surface.faint} mt={2}>{description}</Text>}
        </div>
        {action}
      </Group>
      {children}
    </Paper>
  );
}

/** Project settings → General: the project's details, and adding an app to it (Firebase's "Your apps"). */
export function GeneralSettings() {
  const page = useQuery({ queryKey: ["apps", "android,ios,web"], queryFn: () => api.apps(["android", "ios", "web"]) });
  const [adding, setAdding] = useState<string | null>(null);
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

      <Section title="Your apps" description="Connect a Flutter or Dart app to this project. Pick its platform for the steps.">
        <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="sm">
          {page.data.platforms.map((p) => {
            const Icon = PLATFORM_ICON[p] ?? IconWorld;
            return (
              <UnstyledButton key={p} onClick={() => setAdding(p)} aria-label={`Add a ${PLATFORM_LABEL[p] ?? p} app`}
                style={{ border: `1px solid ${surface.border}`, borderRadius: 12, padding: "16px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <Icon size={26} stroke={1.6} color="var(--mantine-color-winche-6)" />
                <Text size="sm" fw={600}>{PLATFORM_LABEL[p] ?? p}</Text>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      </Section>

      <Section title="What apps see"
        description={<>Public, nothing secret: apps and <Code>winche configure</Code> read it from <Anchor href={`${setup.baseUrl}/.well-known/winche`} target="_blank" ff="monospace" size="sm">/.well-known/winche</Anchor>.</>}>
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

      <AddAppDialog platform={adding} baseUrl={setup.baseUrl} snippet={page.data.snippet} onClose={() => setAdding(null)} />
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

/** The steps to connect an app on one platform: packages, the options file (by the CLI, or downloaded), main(). */
function AddAppDialog({ platform, baseUrl, snippet, onClose }: { platform: string | null; baseUrl: string; snippet: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const label = platform ? PLATFORM_LABEL[platform] ?? platform : "";
  const download = async () => {
    if (!platform) return;
    setBusy(true);
    try {
      const data = await api.apps([platform]);
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
    <Modal opened={platform !== null} onClose={onClose} title={<Text fw={700} fz={18}>Add a {label} app</Text>} size="lg" radius="lg">
      <Stack gap="xl" pt="xs">
        <Step n={1} title="Add the packages">
          <Command value="flutter pub add winche_flutter" />
          <Text size="sm" c={surface.faint}>Then the ones you use: winche_database, winche_storage, winche_auth, winche_functions.</Text>
        </Step>
        <Step n={2} title="Add lib/winche_options.dart">
          <Text size="sm" c={surface.muted}>In your app's folder:</Text>
          <Command value={`winche configure --url ${baseUrl} --platforms ${platform ?? ""}`} />
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
