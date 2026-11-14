import { Alert, Anchor, Button, Code, Group, Loader, Stack, Table, Text } from "@mantine/core";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { SavedQuery } from "../../api/logs";
import { fromSpec, queryText, rangeFrom } from "./explorerQuery";
import { EmptyState } from "../../components/EmptyState";
import { IconBookmark } from "@tabler/icons-react";

/** Saved queries, shared by every admin of this console, with how many entries each matched in the last 24 hours. */
export function SavedQueriesView({ onOpen }: { onOpen: (q: SavedQuery) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["log-queries"], queryFn: api.logQueries });
  const queries = list.data?.queries ?? [];
  const counts = useQueries({
    queries: queries.map((sq) => ({
      queryKey: ["log-query-count", sq.id, sq.query],
      queryFn: () => {
        const s = fromSpec(sq.query);
        return api.logHistogram("app", { resource: s.resource, level: s.level, filters: s.filters, q: s.q, from: rangeFrom("24h"), buckets: 1 });
      },
    })),
  });

  const remove = async (sq: SavedQuery) => {
    if (!window.confirm(`Delete the saved query "${sq.name}"?`)) return;
    await api.deleteLogQuery(sq.id);
    await qc.invalidateQueries({ queryKey: ["log-queries"] });
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">Shared with every admin of this console. Open one to load it in the explorer.</Text>
        <Text size="xs" c="dimmed">Matches: last 24 hours</Text>
      </Group>
      {list.isLoading && <Loader size="sm" />}
      {list.isError && <Alert color="red">Couldn't load the saved queries: {String((list.error as Error).message)}</Alert>}
      {queries.length > 0 && (
        <Table verticalSpacing={6} fz="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Name</Table.Th><Table.Th>Query</Table.Th><Table.Th>Saved by</Table.Th><Table.Th>Matches</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {queries.map((sq, i) => (
              <Table.Tr key={sq.id} data-testid="saved-query">
                <Table.Td><Anchor size="sm" component="button" onClick={() => onOpen(sq)}>{sq.name}</Anchor></Table.Td>
                <Table.Td><Code fz="xs">{queryText(fromSpec(sq.query))}</Code></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{sq.createdBy ?? "built in"}</Text></Table.Td>
                <Table.Td><Text size="sm">{counts[i]?.data ? counts[i].data!.total.toLocaleString() : "…"}</Text></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="light" onClick={() => onOpen(sq)}>Open</Button>
                    {sq.createdBy !== null && <Button size="xs" variant="subtle" color="red" onClick={() => remove(sq)}>Delete</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {list.data && queries.length === 0 && (
        <EmptyState icon={IconBookmark} title="No saved queries" description={<>In the explorer, set up your filters and choose “Save this query”.</>} />
      )}
    </Stack>
  );
}
