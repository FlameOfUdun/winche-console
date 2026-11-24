import { useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBroadcast, IconList, IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { bytes } from "../../api/assets";
import type { RealtimeList } from "../../api/realtime";
import { useSession } from "../../auth/session";
import { ConfirmModal } from "../../components/ConfirmModal";
import { EmptyState } from "../../components/EmptyState";
import { ScrollDialog } from "../../components/ScrollDialog";
import { when } from "../authentication/UsersView";
import { SubsystemTabs } from "../rules/SubsystemTabs";
import { surface } from "../../theme";

const LISTS_PAGE = 50;
const ITEMS_PAGE = 100;

/**
 * Realtime: ordered lists devices write to and follow live, channels and presence. Here: the lists (open and closed)
 * and their items; Presence, Rules and Settings are its other pages.
 */
export function RealtimePage() {
  return (
    <SubsystemTabs subsystem="realtime" primaryLabel="Lists" basePath="/realtime">
      <ListsView />
    </SubsystemTabs>
  );
}

type StateFilter = "all" | "open" | "closed";

/** Realtime → Lists: by path, filtered by a path prefix and open/closed, paged by path. */
export function ListsView() {
  const qc = useQueryClient();
  const admin = useSession().user?.role === "Admin";
  const [prefixTyped, setPrefix] = useState("");
  const [prefix] = useDebouncedValue(prefixTyped.trim(), 250);
  const [state, setState] = useState<StateFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [closing, setClosing] = useState<RealtimeList | null>(null);
  const [deleting, setDeleting] = useState<RealtimeList | null>(null);

  const lists = useInfiniteQuery({
    queryKey: ["realtime-lists", prefix, state],
    queryFn: ({ pageParam }) => api.realtimeLists({ prefix, state: state === "all" ? null : state, after: pageParam, limit: LISTS_PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 15_000,
  });
  const rows = lists.data?.pages.flatMap((p) => p.lists) ?? [];
  const filtered = !!prefix || state !== "all";
  const refresh = () => qc.invalidateQueries({ queryKey: ["realtime-lists"] });

  return (
    <Stack gap="md" data-testid="realtime-lists">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <TextInput size="xs" w={260} placeholder="Path starts with" aria-label="Path starts with" leftSection={<IconSearch size={14} />}
          value={prefixTyped} onChange={(e) => setPrefix(e.currentTarget.value)} styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} />
        <SegmentedControl size="xs" value={state} onChange={(v) => setState(v as StateFilter)} aria-label="State"
          data={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} />
      </Group>

      {lists.isLoading ? <Loader size="sm" /> : lists.isError ? (
        <Alert color="red">Couldn't load the lists: {errorMessage(lists.error)}</Alert>
      ) : rows.length === 0 ? (
        filtered
          ? <EmptyState compact icon={IconSearch} title="No lists match" description="Try another path or state." />
          : <EmptyState icon={IconBroadcast} title="No lists yet" description="Lists show here once apps write to them." />
      ) : (
        <Paper withBorder radius="md">
          <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
            <Title order={5}>Lists</Title>
            <Text size="xs" c={surface.faint}>{rows.length.toLocaleString()}{lists.hasNextPage ? "+" : ""} shown</Text>
          </Group>
          <ScrollArea>
            <Table fz="sm" verticalSpacing={8} highlightOnHover miw={720}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Path</Table.Th><Table.Th>State</Table.Th><Table.Th>Items</Table.Th><Table.Th>Size</Table.Th>
                  <Table.Th>Opened</Table.Th><Table.Th>Closed</Table.Th>{admin && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((l) => (
                  <Table.Tr key={l.path} style={{ cursor: "pointer" }} onClick={() => setOpen(l.path)} data-testid="realtime-list">
                    <Table.Td><Text size="sm" ff="monospace" truncate maw={320}>{l.path}</Text></Table.Td>
                    <Table.Td><StateBadge state={l.state} /></Table.Td>
                    <Table.Td><Text size="sm" c={surface.muted}>{l.count.toLocaleString()}</Text></Table.Td>
                    <Table.Td><Text size="sm" c={surface.muted}>{bytes(l.bytes)}</Text></Table.Td>
                    <Table.Td><Text size="sm" c={surface.muted}>{when(l.openedAt)}</Text></Table.Td>
                    <Table.Td><Text size="sm" c={surface.muted}>{l.closedAt ? when(l.closedAt) : "—"}</Text></Table.Td>
                    {admin && (
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          {l.state === "open"
                            ? <Button size="xs" variant="subtle" px={8} onClick={() => setClosing(l)}>Close</Button>
                            : <Button size="xs" variant="subtle" color="red" px={8} onClick={() => setDeleting(l)}>Delete</Button>}
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {lists.hasNextPage && (
            <Group justify="center" py="xs" style={{ borderTop: `1px solid ${surface.subtle}` }}>
              <Button size="xs" variant="subtle" loading={lists.isFetchingNextPage} onClick={() => void lists.fetchNextPage()}>Load more</Button>
            </Group>
          )}
        </Paper>
      )}

      <ListDialog path={open} onClose={() => setOpen(null)} />
      <ConfirmModal opened={!!closing} title="Close the list" confirmLabel="Close" confirmColor="blue"
        message={<>Nothing more can be added to <b>{closing?.path}</b>. It can still be read.</>}
        action={async () => { await api.closeRealtimeList(closing!.path); await refresh(); }}
        onCancel={() => setClosing(null)} />
      <ConfirmModal opened={!!deleting} title="Delete the list" confirmLabel="Delete"
        message={<><b>{deleting?.path}</b> and its {deleting?.count.toLocaleString()} items are deleted for good.</>}
        action={async () => { await api.deleteRealtimeList(deleting!.path); await refresh(); }}
        onCancel={() => setDeleting(null)} />
    </Stack>
  );
}

function StateBadge({ state }: { state: RealtimeList["state"] }) {
  return <Badge size="sm" variant="light" color={state === "open" ? "teal" : "gray"} tt="none">{state}</Badge>;
}

/** A list's items, oldest first, a page at a time; the payload as text where it is. */
function ListDialog({ path, onClose }: { path: string | null; onClose: () => void }) {
  const items = useInfiniteQuery({
    queryKey: ["realtime-items", path],
    queryFn: ({ pageParam }) => api.realtimeItems(path!, pageParam, ITEMS_PAGE),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.items.length === ITEMS_PAGE ? last.items[last.items.length - 1].position : undefined),
    enabled: !!path,
  });
  const list = items.data?.pages[0]?.list;
  const rows = items.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <ScrollDialog opened={!!path} onClose={onClose} size="xl" height={620} testId="realtime-list-dialog" ariaLabel={path ?? undefined}
      title={<Text fw={700} fz={18} ff="monospace" truncate>{path}</Text>}
      top={list && (
        <Group gap="xs" pb="xs">
          <StateBadge state={list.state} />
          <Text size="sm" c={surface.muted}>
            {list.count.toLocaleString()} items · {bytes(list.bytes)} · opened {when(list.openedAt)}{list.closedAt ? ` · closed ${when(list.closedAt)}` : ""}
          </Text>
        </Group>
      )}
      footer={items.hasNextPage && (
        <Button variant="default" loading={items.isFetchingNextPage} onClick={() => void items.fetchNextPage()}>Load more</Button>
      )}>
      {items.isLoading ? <Loader size="sm" /> : items.isError ? <Alert color="red">{errorMessage(items.error)}</Alert> : rows.length === 0 ? (
        <EmptyState compact bordered={false} icon={IconList} title="No items yet" description="Items show here as they're added." />
      ) : (
        <Table fz="xs" verticalSpacing={6} data-testid="realtime-items" style={{ tableLayout: "fixed" }}>
          <Table.Thead>
            <Table.Tr><Table.Th w={60}>#</Table.Th><Table.Th w={140}>Key</Table.Th><Table.Th w={120}>By</Table.Th><Table.Th w={150}>Time</Table.Th><Table.Th>Content</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((i) => (
              <Table.Tr key={i.position} data-testid="realtime-item">
                <Table.Td><Text size="xs" c={surface.muted}>{i.position}</Text></Table.Td>
                <Table.Td><Text size="xs" ff="monospace" truncate>{i.key ?? "—"}</Text></Table.Td>
                <Table.Td><Text size="xs" truncate>{i.by ?? "—"}</Text></Table.Td>
                <Table.Td><Text size="xs" c={surface.muted}>{when(i.at)}</Text></Table.Td>
                <Table.Td>
                  {i.text != null
                    ? <Text size="xs" ff="monospace" lineClamp={2} title={i.text} style={{ wordBreak: "break-all" }}>{i.text}</Text>
                    : <Text size="xs" c={surface.faint}>Binary · {bytes(i.size)}</Text>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </ScrollDialog>
  );
}
