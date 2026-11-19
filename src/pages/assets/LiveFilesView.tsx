import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Code, CopyButton, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { IconFolder, IconPackage, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { bytes, type AssetLiveFiles } from "../../api/assets";
import { EmptyState } from "../../components/EmptyState";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";

type LiveFile = AssetLiveFiles["files"][number];

const PUBLISH = `winche assets deploy assets --channel production -m "What changed"`;

/** Up to this size a file is previewed in the console (fetched whole). */
const PREVIEW_MAX = 50 * 1024 * 1024;

/** "translations" for "translations/en.json"; files at the top are in "". */
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "");

/** What a type is, in a word: json, audio, video, image, html… */
const kindOf = (mime: string) =>
  mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image"
  : mime === "text/html" ? "html" : mime.includes("json") ? "json" : mime.startsWith("text/") ? "text" : mime.split("/").pop() ?? mime;

/**
 * Assets → Files: what apps get on a channel now (the release it points at), by folder, with when each file's content
 * arrived; a file opens with its details and a preview.
 */
export function LiveFilesView() {
  const page = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const channels = page.data?.channels ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const channel = chosen ?? channels.find((c) => c.name === "production")?.name ?? channels[0]?.name ?? null;
  const live = useQuery({ queryKey: ["asset-live", channel], queryFn: () => api.assetChannelFiles(channel!), enabled: !!channel });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<LiveFile | null>(null);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const files = (live.data?.files ?? []).filter((f) => !q || f.path.toLowerCase().includes(q));
    const map = new Map<string, LiveFile[]>();
    for (const f of files) map.set(folderOf(f.path), [...(map.get(folderOf(f.path)) ?? []), f]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [live.data, search]);

  if (page.isLoading) return <Loader size="sm" />;
  if (page.isError || !page.data) return <Alert color="red">Couldn't load assets: {errorMessage(page.error)}</Alert>;
  if (!channel)
    return (
      <EmptyState icon={IconPackage} title="No assets yet"
        description="Assets are a folder of your app's content (translations, pages, audio, videos), published from your terminal or CI. Apps get the release their channel points at: its files show here."
        action={<Code block ta="left">{PUBLISH}</Code>} />
    );
  const d = live.data;
  return (
    <Stack gap="md" data-testid="asset-live">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap={8}>
          <Text fw={600}>Live</Text>
          {d && <Badge variant="light" color="teal" tt="none">release #{d.release}</Badge>}
          {d && <Text size="sm" c="dimmed">{d.files.length.toLocaleString()} files · {bytes(d.size)} · published {when(d.publishedAt)}{d.by ? ` by ${d.by}` : ""}</Text>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <TextInput size="xs" placeholder="Search paths" aria-label="Search paths" leftSection={<IconSearch size={14} />} value={search}
            onChange={(e) => setSearch(e.currentTarget.value)} w={220} />
          {channels.length > 1 && (
            <Select size="xs" aria-label="Channel" w={160} allowDeselect={false} value={channel}
              data={channels.map((c) => ({ value: c.name, label: `${c.name} (#${c.release})` }))} onChange={(v) => setChosen(v)} />
          )}
        </Group>
      </Group>

      {live.isLoading && <Loader size="sm" />}
      {live.isError && <Alert color="red">Couldn't load {channel}'s files: {errorMessage(live.error)}</Alert>}
      {d && groups.length === 0 && <Text size="sm" c="dimmed">No files match “{search}”.</Text>}

      {groups.map(([folder, files]) => (
        <Paper key={folder} withBorder radius="md" data-testid="asset-folder">
          <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid ${surface.subtle}` }}>
            <Group gap={8}>
              <IconFolder size={16} color={surface.muted} />
              <Title order={5} ff="monospace">{folder || "/"}</Title>
            </Group>
            <Text size="xs" c={surface.faint}>{files.length.toLocaleString()} files · {bytes(files.reduce((a, f) => a + f.size, 0))}</Text>
          </Group>
          <ScrollArea>
            <Table fz="sm" verticalSpacing={6} highlightOnHover miw={560}>
              <Table.Tbody>
                {files.map((f) => (
                  <Table.Tr key={f.path} style={{ cursor: "pointer" }} onClick={() => setOpen(f)} data-testid="asset-live-file">
                    <Table.Td>
                      <UnstyledButton aria-label={f.path} onClick={(e) => { e.stopPropagation(); setOpen(f); }}>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" ff="monospace">{folder ? f.path.slice(folder.length + 1) : f.path}</Text>
                          {f.url && <Badge size="xs" variant="light">CDN</Badge>}
                        </Group>
                      </UnstyledButton>
                    </Table.Td>
                    <Table.Td><Badge size="sm" variant="default" tt="none">{kindOf(f.mimeType)}</Badge></Table.Td>
                    <Table.Td><Text size="xs" c={surface.muted}>{f.since === d!.release ? "new in this release" : `since #${f.since}`}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs" c={surface.muted}>{bytes(f.size)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      ))}

      <FileDialog file={open} release={d?.release ?? 0} onClose={() => setOpen(null)} />
    </Stack>
  );
}

/** One file: what it is, where its content came in, and a look at it (text, image, audio, video, a page). */
function FileDialog({ file, release, onClose }: { file: LiveFile | null; release: number; onClose: () => void }) {
  return (
    <Modal opened={!!file} onClose={onClose} radius="lg" size="xl"
      title={file && <Group gap={8}><Text fw={700} ff="monospace">{file.path}</Text>{file.url && <Badge variant="light">CDN</Badge>}</Group>}>
      {file && (
        <Stack gap="md">
          <Table fz="sm" verticalSpacing={4} data-testid="asset-file-details">
            <Table.Tbody>
              <Table.Tr><Table.Td c="dimmed" w={150}>Type</Table.Td><Table.Td>{file.mimeType}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td c="dimmed">Size</Table.Td><Table.Td>{bytes(file.size)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td c="dimmed">Content</Table.Td><Table.Td>{file.since === release ? `new in release #${release}` : `unchanged since release #${file.since}`}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td c="dimmed">SHA-256</Table.Td><Table.Td>
                <CopyButton value={file.hash}>{({ copied, copy }) => (
                  <Text size="xs" ff="monospace" style={{ cursor: "pointer" }} onClick={copy} title="Copy">{copied ? "Copied" : file.hash}</Text>
                )}</CopyButton>
              </Table.Td></Table.Tr>
              {file.url && <Table.Tr><Table.Td c="dimmed">On the CDN</Table.Td><Table.Td>
                <Text size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>{file.url}</Text>
                <Text size="xs" c="dimmed">Apps never see this address: they get links it accepts for a few minutes.</Text>
              </Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
          <Preview file={file} release={release} />
        </Stack>
      )}
    </Modal>
  );
}

/** A blob's text (FileReader: in every browser, and in tests). */
const readText = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ""));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

function Preview({ file, release }: { file: LiveFile; release: number }) {
  const kind = kindOf(file.mimeType);
  const previewable = ["audio", "video", "image", "html", "json", "text"].includes(kind) && file.size <= PREVIEW_MAX;
  const content = useQuery({
    queryKey: ["asset-content", release, file.path], enabled: previewable, staleTime: Infinity,
    queryFn: () => api.assetContent(release, file.path),
  });
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!content.data) return;
    if (kind === "json" || kind === "text" || kind === "html") { void readText(content.data).then(setText); return; }
    const u = URL.createObjectURL(content.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [content.data, kind]);

  if (!previewable) return <Text size="sm" c="dimmed">{file.size > PREVIEW_MAX ? "Too large to preview here." : "No preview for this type."}</Text>;
  if (content.isLoading) return <Loader size="sm" />;
  if (content.isError) return <Alert color="red" p="xs">Couldn't load it: {errorMessage(content.error)}</Alert>;
  if (kind === "audio" && url) return <audio controls src={url} style={{ width: "100%" }} data-testid="asset-preview-audio" />;
  if (kind === "video" && url) return <video controls src={url} style={{ width: "100%", maxHeight: 420 }} data-testid="asset-preview-video" />;
  if (kind === "image" && url) return <img src={url} alt={file.path} style={{ maxWidth: "100%", maxHeight: 420 }} />;
  if (kind === "html" && text !== null)
    return <iframe title={file.path} sandbox="" srcDoc={text} style={{ width: "100%", height: 420, border: `1px solid ${surface.subtle}`, borderRadius: 8, background: "white" }} />;
  if (text !== null) {
    let shown = text;
    if (kind === "json") { try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* as it is */ } }
    return <ScrollArea.Autosize mah={420}><Code block data-testid="asset-preview-text">{shown}</Code></ScrollArea.Autosize>;
  }
  return null;
}
