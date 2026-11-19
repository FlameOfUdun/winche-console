import { useState } from "react";
import { Alert, Badge, Button, Code, Collapse, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { HistoryDrawer } from "../../components/EditCard";
import { IconChevronDown, IconChevronRight, IconPackage, IconRoute } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { bytes, type AssetChannel, type AssetReleaseSummary } from "../../api/assets";
import { useSession } from "../../auth/session";
import { ConfirmModal } from "../../components/ConfirmModal";
import { EmptyState } from "../../components/EmptyState";
import { when } from "../authentication/UsersView";
import { SubsystemTabs } from "../rules/SubsystemTabs";
import { LiveFilesView } from "./LiveFilesView";
import { surface } from "../../theme";

/**
 * Assets: content apps download and keep offline, published from the CLI as numbered releases. Here: the channels
 * apps follow (moving one back is a rollback), the releases and what changed in each. Rules, Webhooks and Settings
 * are its other pages.
 */
export function AssetsPage() {
  return (
    <SubsystemTabs subsystem="assets" primaryLabel="Files" basePath="/assets">
      <LiveFilesView />
    </SubsystemTabs>
  );
}

const PUBLISH = `winche assets deploy assets --channel production -m "What changed"`;

export function ReleasesView() {
  const data = useQuery({ queryKey: ["assets"], queryFn: api.assets, refetchInterval: 15_000 });
  const [open, setOpen] = useState<number | null>(null);
  const { user } = useSession();
  const admin = user?.role === "Admin";
  if (data.isLoading) return <Loader size="sm" />;
  if (data.isError || !data.data) return <Alert color="red">Couldn't load assets: {errorMessage(data.error)}</Alert>;
  const d = data.data;

  if (d.releases.length === 0)
    return (
      <EmptyState icon={IconPackage} title="No releases yet"
        description="Assets are a folder of your app's content (translations, pages, images, videos), published from your terminal or CI. Each publish is a release; channels point apps at one."
        action={<Code block ta="left">{PUBLISH}</Code>} />
    );

  const channelsOf = (n: number) => d.channels.filter((c) => c.release === n);
  return (
    <Stack gap="lg" data-testid="assets-page">
      {d.moving && (
        <Alert color={d.moving.error ? "red" : "blue"} p="sm">
          {d.moving.error ? `Moving to ${d.moving.to} stopped: ${d.moving.error}` : `Moving to ${d.moving.to}: ${d.moving.copied.toLocaleString()} of ${d.moving.total.toLocaleString()} copied.`}
        </Alert>
      )}
      <ChannelsCard channels={d.channels} releases={d.releases} admin={admin} />

      <Paper withBorder radius="md">
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
          <Title order={5}>Releases</Title>
          <Text size="xs" c={surface.faint}>Kept in {d.location}</Text>
        </Group>
        <ScrollArea>
          <Table fz="sm" verticalSpacing={8} highlightOnHover miw={640}>
            <Table.Thead>
              <Table.Tr><Table.Th>Release</Table.Th><Table.Th>Note</Table.Th><Table.Th>Files</Table.Th><Table.Th>Published</Table.Th><Table.Th>Channels</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.releases.map((r) => (
                <Table.Tr key={r.number} style={{ cursor: "pointer" }} onClick={() => setOpen(r.number)} data-testid="asset-release">
                  <Table.Td><Text fw={600}>#{r.number}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" lineClamp={1}>{r.note ?? ""}</Text>
                      {r.source === "console" && <Badge size="xs" variant="light" color="grape" tt="none">console</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c={surface.muted}>{r.files.toLocaleString()} · {bytes(r.size)}</Text></Table.Td>
                  <Table.Td><Text size="sm" c={surface.muted}>{when(r.at)}{r.by ? ` by ${r.by}` : ""}</Text></Table.Td>
                  <Table.Td><Group gap={4}>{channelsOf(r.number).map((c) => <Badge key={c.name} variant="light" tt="none">{c.name}</Badge>)}</Group></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        {d.releases.length >= 20 && <Text size="xs" c={surface.faint} px="md" py="xs">The newest 20 releases.</Text>}
      </Paper>
      <ReleaseModal number={open} previous={open ? d.releases.find((r) => r.number < open)?.number ?? null : null} onClose={() => setOpen(null)} />
    </Stack>
  );
}

function ChannelsCard({ channels, releases, admin }: { channels: AssetChannel[]; releases: AssetReleaseSummary[]; admin: boolean }) {
  const qc = useQueryClient();
  const [moving, setMoving] = useState<AssetChannel | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!removing) return;
    setBusy(true); setError(null);
    try { await api.removeAssetChannel(removing); setRemoving(null); await qc.invalidateQueries({ queryKey: ["assets"] }); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Paper withBorder radius="md">
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
        <Title order={5}>Channels</Title>
        <Text size="xs" c={surface.faint}>Apps follow a channel; pointing it at an older release rolls back.</Text>
      </Group>
      {channels.length === 0 ? (
        <EmptyState compact bordered={false} icon={IconRoute} title="No channels yet"
          description={<>Publish with <Code>--channel production</Code> to make one, or point one at a release from the CLI.</>} />
      ) : (
        <Table fz="sm" verticalSpacing={8}>
          <Table.Tbody>
            {channels.map((c) => (
              <Table.Tr key={c.name} data-testid="asset-channel">
                <Table.Td><Text fw={600}>{c.name}</Text></Table.Td>
                <Table.Td><Badge variant="light" tt="none">#{c.release}</Badge></Table.Td>
                <Table.Td><Text size="sm" c={surface.muted}>{when(c.updatedAt)}{c.by ? ` by ${c.by}` : ""}</Text></Table.Td>
                <Table.Td>
                  <Group gap={6} justify="flex-end" wrap="nowrap">
                    <Button size="xs" variant="subtle" px={8} onClick={() => setHistory(c.name)}>History</Button>
                    {admin && <Button size="xs" variant="default" onClick={() => setMoving(c)}>Move…</Button>}
                    {admin && <Button size="xs" variant="subtle" color="red" px={8} onClick={() => setRemoving(c.name)}>Remove</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <MoveChannelModal channel={moving} releases={releases} onClose={() => setMoving(null)} />
      <ChannelHistoryModal name={history} onClose={() => setHistory(null)} />
      <ConfirmModal opened={!!removing} title="Remove the channel" confirmLabel="Remove" confirmColor="red" loading={busy} error={error}
        message={<Text size="sm">Apps following <b>{removing}</b> stop getting assets until it's made again. Its releases stay.</Text>}
        onConfirm={remove} onCancel={() => { setRemoving(null); setError(null); }} />
    </Paper>
  );
}

function MoveChannelModal({ channel, releases, onClose }: { channel: AssetChannel | null; releases: AssetReleaseSummary[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = to ? Number(to) : null;
  const diff = useQuery({
    queryKey: ["asset-diff", channel?.release, target], queryFn: () => api.assetDiff(channel!.release, target!),
    enabled: !!channel && !!target && target !== channel.release,
  });
  const close = () => { setTo(null); setError(null); onClose(); };
  const move = async () => {
    if (!channel || !target) return;
    setBusy(true); setError(null);
    try { await api.moveAssetChannel(channel.name, target); await qc.invalidateQueries({ queryKey: ["assets"] }); close(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal opened={!!channel} onClose={close} title={channel ? `Move ${channel.name}` : ""} centered>
      {channel && (
        <Stack gap="sm">
          <Text size="sm">It points at #{channel.release}. Apps pick up the change the next time they sync.</Text>
          <Select label="Release" placeholder="Choose a release" value={to} onChange={setTo} allowDeselect={false}
            data={releases.filter((r) => r.number !== channel.release).map((r) => ({ value: String(r.number), label: `#${r.number}${r.note ? ` · ${r.note}` : ""}` }))} />
          {diff.data && <DiffList diff={diff.data} />}
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button loading={busy} disabled={!target} onClick={move}>{target && target < channel.release ? "Roll back" : "Move"}</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function ChannelHistoryModal({ name, onClose }: { name: string | null; onClose: () => void }) {
  const h = useQuery({ queryKey: ["asset-channel-history", name], queryFn: () => api.assetChannelHistory(name!), enabled: !!name });
  return (
    <HistoryDrawer opened={!!name} onClose={onClose} subtitle={name ? `The channel ${name}: which release it pointed at, and when` : undefined}>
      {h.isLoading ? <Loader size="sm" /> : h.isError ? <Alert color="red">{errorMessage(h.error)}</Alert> : (
        <Table fz="sm" verticalSpacing={6}>
          <Table.Tbody>
            {h.data?.moves.map((m, i) => (
              <Table.Tr key={i}>
                <Table.Td>{m.from == null ? `Made at #${m.to}` : `#${m.from} → #${m.to}`}</Table.Td>
                <Table.Td><Text size="sm" c={surface.muted}>{when(m.at)}{m.by ? ` by ${m.by}` : ""}</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </HistoryDrawer>
  );
}

function ReleaseModal({ number, previous, onClose }: { number: number | null; previous: number | null; onClose: () => void }) {
  const release = useQuery({ queryKey: ["asset-release", number], queryFn: () => api.assetRelease(number!), enabled: number != null });
  const diff = useQuery({ queryKey: ["asset-diff", previous, number], queryFn: () => api.assetDiff(previous!, number!), enabled: number != null && previous != null });
  const r = release.data;
  return (
    <Modal opened={number != null} onClose={onClose} title={number != null ? `Release #${number}` : ""} size="xl" centered>
      {release.isLoading ? <Loader size="sm" /> : release.isError || !r ? <Alert color="red">{errorMessage(release.error)}</Alert> : (
        <Stack gap="md">
          <Text size="sm" c={surface.muted}>{r.note ?? "No note"} · {when(r.at)}{r.by ? ` by ${r.by}` : ""} · {r.files.length.toLocaleString()} files, {bytes(r.size)}</Text>
          {previous != null && diff.data && <ChangesSection previous={previous} diff={diff.data} />}
          <ScrollArea.Autosize mah={360}>
            <Table fz="xs" verticalSpacing={4} data-testid="asset-files">
              <Table.Tbody>
                {r.files.map((f) => (
                  <Table.Tr key={f.path}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" ff="monospace">{f.path}</Text>
                        {f.url && <Badge size="xs" variant="light" title={f.url} data-testid="asset-file-cdn">CDN</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="xs" c={surface.muted}>{f.mimeType}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs" c={surface.muted}>{bytes(f.size)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Modal>
  );
}

/** "Changes from #n", closed until clicked; its counts show while it's closed. */
function ChangesSection({ previous, diff }: { previous: number; diff: { added: string[]; changed: string[]; removed: string[] } }) {
  const [open, setOpen] = useState(false);
  const counts = [[diff.added.length, "added"], [diff.changed.length, "changed"], [diff.removed.length, "removed"]]
    .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(" · ") || "the same files";
  return (
    <Paper withBorder radius="md" px="sm" py={6}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Changes from #${previous}`} style={{ width: "100%" }}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={6} wrap="nowrap">
            {open ? <IconChevronDown size={14} color={surface.muted} /> : <IconChevronRight size={14} color={surface.muted} />}
            <Text fw={600} size="sm">Changes from #{previous}</Text>
          </Group>
          <Text size="xs" c={surface.muted}>{counts}</Text>
        </Group>
      </UnstyledButton>
      <Collapse in={open}><div style={{ paddingTop: 8 }}><DiffList diff={diff} /></div></Collapse>
    </Paper>
  );
}

function DiffList({ diff }: { diff: { added: string[]; changed: string[]; removed: string[] } }) {
  const rows = [
    ...diff.added.map((p) => ({ p, kind: "added", color: "teal" })),
    ...diff.changed.map((p) => ({ p, kind: "changed", color: "blue" })),
    ...diff.removed.map((p) => ({ p, kind: "removed", color: "red" })),
  ];
  if (rows.length === 0) return <Text size="sm" c={surface.muted}>The same files.</Text>;
  return (
    <ScrollArea.Autosize mah={200}>
      <Stack gap={2} data-testid="asset-diff">
        {rows.map((r) => (
          <Group key={r.kind + r.p} gap="xs" wrap="nowrap">
            <Badge size="xs" variant="light" color={r.color} tt="none" w={64}>{r.kind}</Badge>
            <Text size="xs" ff="monospace" truncate>{r.p}</Text>
          </Group>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}
