import { useState } from "react";
import { Alert, Button, Group, Loader, Paper, ScrollArea, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconUsers, IconUserOff } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { EmptyState } from "../../components/EmptyState";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";

/** Its data on one line (JSON), or nothing. */
const compact = (data: unknown) => (data == null ? "" : typeof data === "string" ? data : JSON.stringify(data));

/** Realtime → Presence: who's present at a path now, with what they shared and since when. */
export function PresenceView() {
  const [typed, setTyped] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const members = useQuery({ queryKey: ["realtime-presence", path], queryFn: () => api.realtimePresence(path!), enabled: !!path, refetchInterval: 10_000 });
  const lookUp = () => { const p = typed.trim(); if (p) setPath(p); };

  return (
    <Stack gap="md" data-testid="realtime-presence">
      <form onSubmit={(e) => { e.preventDefault(); lookUp(); }}>
        <Group gap="xs" align="flex-end">
          <TextInput label="Path" placeholder="rooms/lobby" w={320} value={typed} onChange={(e) => setTyped(e.currentTarget.value)}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} />
          <Button type="submit" disabled={!typed.trim()}>Look up</Button>
        </Group>
      </form>

      {!path ? (
        <EmptyState icon={IconUsers} title="See who's here" description="Give a path to see who's present there now." />
      ) : members.isLoading ? <Loader size="sm" /> : members.isError || !members.data ? (
        <Alert color="red">Couldn't look up {path}: {errorMessage(members.error)}</Alert>
      ) : members.data.members.length === 0 ? (
        <EmptyState compact icon={IconUserOff} title="Nobody's here" description={<>No one is present at <Text span ff="monospace" fz="sm">{path}</Text>.</>} />
      ) : (
        <Paper withBorder radius="md">
          <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
            <Title order={5}>Present at <Text span ff="monospace" fz="inherit">{path}</Text></Title>
            <Text size="xs" c={surface.faint}>{members.data.members.length.toLocaleString()}</Text>
          </Group>
          <ScrollArea>
            <Table fz="sm" verticalSpacing={8} miw={560} style={{ tableLayout: "fixed" }}>
              <Table.Thead>
                <Table.Tr><Table.Th w={220}>User</Table.Th><Table.Th>Data</Table.Th><Table.Th w={180}>Since</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {members.data.members.map((m) => (
                  <Table.Tr key={m.uid} data-testid="presence-member">
                    <Table.Td><Text size="sm" ff="monospace" truncate>{m.uid}</Text></Table.Td>
                    <Table.Td><Text size="xs" ff="monospace" truncate title={compact(m.data)}>{compact(m.data) || "—"}</Text></Table.Td>
                    <Table.Td><Text size="sm" c={surface.muted}>{when(m.joinedAt)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}
