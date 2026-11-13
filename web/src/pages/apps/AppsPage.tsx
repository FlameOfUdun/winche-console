import { useState } from "react";
import { Alert, Button, Chip, Code, Group, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { PLATFORM_LABEL } from "../../api/apps";

/** Apps: how a Flutter or Dart app connects to this server — the options file and the lines for main(). */
export function AppsPage() {
  const [platforms, setPlatforms] = useState<string[]>(["android", "ios", "web"]);
  const page = useQuery({ queryKey: ["apps", platforms.join(",")], queryFn: () => api.apps(platforms) });

  const download = () => {
    if (!page.data) return;
    const url = URL.createObjectURL(new Blob([page.data.file], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "winche_options.dart";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>Apps</Title>
        <Text size="sm" c="dimmed">Connect a Flutter or Dart app to this server, the way you would add an app to a Firebase project.</Text>
      </div>
      {page.isLoading && <Loader size="sm" />}
      {page.error && <Alert color="red">{String(page.error)}</Alert>}
      {page.data && (
        <>
          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text fw={600}>1. Add the packages</Text>
              <Code block>{"flutter pub add winche_flutter winche_core"}</Code>
              <Text size="sm" c="dimmed">
                Then the ones you use: winche_database, winche_storage, winche_auth, winche_functions.
              </Text>
            </Stack>
          </Paper>

          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text fw={600}>2. Add lib/winche_options.dart</Text>
              <Text size="sm" c="dimmed">
                Run <Code>winche configure --url {page.data.setup.baseUrl}</Code> in your app's folder, or download it here.
              </Text>
              <Chip.Group multiple value={platforms} onChange={(v) => setPlatforms(v.length ? v : platforms)}>
                <Group gap="xs">
                  {page.data.platforms.map((p) => <Chip key={p} value={p} size="sm">{PLATFORM_LABEL[p] ?? p}</Chip>)}
                </Group>
              </Chip.Group>
              <Code block data-testid="options-file" style={{ maxHeight: 360, overflow: "auto" }}>{page.data.file}</Code>
              <Group>
                <Button leftSection={<IconDownload size={16} />} onClick={download}>Download winche_options.dart</Button>
              </Group>
            </Stack>
          </Paper>

          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text fw={600}>3. Start Winche in main()</Text>
              <Code block>{page.data.snippet}</Code>
            </Stack>
          </Paper>

          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text fw={600}>This server</Text>
              <Table withRowBorders={false} verticalSpacing={4}>
                <Table.Tbody>
                  <Table.Tr><Table.Td w={160}>Project</Table.Td><Table.Td><Code>{page.data.setup.projectId}</Code></Table.Td></Table.Tr>
                  <Table.Tr><Table.Td>Address</Table.Td><Table.Td><Code>{page.data.setup.baseUrl}</Code></Table.Td></Table.Tr>
                  {page.data.setup.services.map((s) => (
                    <Table.Tr key={s.id}>
                      <Table.Td>{s.id[0].toUpperCase() + s.id.slice(1)}</Table.Td>
                      <Table.Td><Code>{s.path}</Code>{s.livePath && <> · live <Code>{s.livePath}</Code></>}</Table.Td>
                    </Table.Tr>
                  ))}
                  {page.data.setup.providers.map((p) => (
                    <Table.Tr key={p.name}>
                      <Table.Td>Sign in with {p.displayName}</Table.Td>
                      <Table.Td>{p.clientIds.map((id) => <Code key={id} mr={4}>{id}</Code>)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed">Public: apps read the same from <Code>{page.data.setup.baseUrl}/.well-known/winche</Code>.</Text>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}
