import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Code, CopyButton, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, UnstyledButton } from "@mantine/core";
import { IconBraces, IconChevronDown, IconChevronRight, IconFile, IconFolder, IconFolderOpen, IconMovie, IconMusic, IconPackage, IconPhoto, IconSearch, IconWorld } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { bytes, type AssetLiveFiles } from "../../api/assets";
import { EmptyState } from "../../components/EmptyState";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";
import { useSession } from "../../auth/session";
import { NewReleaseModal } from "./NewReleaseModal";

type LiveFile = AssetLiveFiles["files"][number];


/** Up to this size a file is previewed in the console (fetched whole). */
const PREVIEW_MAX = 50 * 1024 * 1024;

/** A folder of the release: its subfolders and files, with how many files and bytes are under it. */
interface Folder { name: string; path: string; folders: Folder[]; files: LiveFile[]; count: number; size: number }

/** The files as a tree of folders (sorted: folders first, then files). */
function treeOf(files: LiveFile[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], files: [], count: 0, size: 0 };
  for (const f of files) {
    let at = root;
    const parts = f.path.split("/");
    at.count++; at.size += f.size;
    for (const part of parts.slice(0, -1)) {
      let next = at.folders.find((x) => x.name === part);
      if (!next) { next = { name: part, path: at.path ? `${at.path}/${part}` : part, folders: [], files: [], count: 0, size: 0 }; at.folders.push(next); }
      at = next;
      at.count++; at.size += f.size;
    }
    at.files.push(f);
  }
  const sort = (d: Folder) => { d.folders.sort((a, b) => a.name.localeCompare(b.name)); d.files.sort((a, b) => a.path.localeCompare(b.path)); d.folders.forEach(sort); };
  sort(root);
  return root;
}

/** What a type is, in a word: json, audio, video, image, html… */
const kindOf = (mime: string) =>
  mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image"
  : mime === "text/html" ? "html" : mime.includes("json") ? "json" : mime.startsWith("text/") ? "text" : mime.split("/").pop() ?? mime;

/**
 * Assets → Files: what apps get on a channel now (the release it points at) as a folder tree, with when each file's
 * content arrived; a file opens with its details and a preview.
 */
export function LiveFilesView() {
  const page = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  const channels = page.data?.channels ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const channel = chosen ?? channels.find((c) => c.name === "production")?.name ?? channels[0]?.name ?? null;
  const live = useQuery({ queryKey: ["asset-live", channel], queryFn: () => api.assetChannelFiles(channel!), enabled: !!channel });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<LiveFile | null>(null);
  const [drafting, setDrafting] = useState(false);
  const admin = useSession().user?.role === "Admin";

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const query = search.trim().toLowerCase();
  const tree = useMemo(() => treeOf((live.data?.files ?? []).filter((f) => !query || f.path.toLowerCase().includes(query))), [live.data, query]);
  // Searching opens every folder with a match; otherwise folders open as they're clicked.
  const isOpen = (path: string) => !!query || expanded.has(path);
  const flip = (path: string) => setExpanded((e) => { const n = new Set(e); if (n.has(path)) n.delete(path); else n.add(path); return n; });

  if (page.isLoading) return <Loader size="sm" />;
  if (page.isError || !page.data) return <Alert color="red">Couldn't load assets: {errorMessage(page.error)}</Alert>;
  if (!channel)
    return (
      <EmptyState icon={IconPackage} title="No assets yet"
        description="Published files show here." />
    );
  const d = live.data;
  return (
    <Stack gap="md" data-testid="asset-live" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap={8}>
          <Text fw={600}>Live</Text>
          {d && <Badge variant="light" color="teal" tt="none">release #{d.release}</Badge>}
          {d?.source === "console" && <Badge variant="light" color="grape" tt="none">made in the console</Badge>}
          {d && <Text size="sm" c="dimmed">{d.files.length.toLocaleString()} files · {bytes(d.size)} · published {when(d.publishedAt)}{d.by ? ` by ${d.by}` : ""}</Text>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <TextInput size="xs" placeholder="Search paths" aria-label="Search paths" leftSection={<IconSearch size={14} />} value={search}
            onChange={(e) => setSearch(e.currentTarget.value)} w={220} />
          {admin && d && <Button size="xs" onClick={() => setDrafting(true)}>New release</Button>}
          {channels.length > 1 && (
            <Select size="xs" aria-label="Channel" w={160} allowDeselect={false} value={channel}
              data={channels.map((c) => ({ value: c.name, label: `${c.name} (#${c.release})` }))} onChange={(v) => setChosen(v)} />
          )}
        </Group>
      </Group>

      {/* One scrolling list (the page around it doesn't scroll): the release's folders, opened as they're clicked. */}
      <Paper withBorder radius="md" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }} data-testid="asset-live-scroll">
        {live.isLoading && <Loader size="sm" m="md" />}
        {live.isError && <Alert color="red" m="md">Couldn't load {channel}'s files: {errorMessage(live.error)}</Alert>}
        {d && tree.count === 0 && <Text size="sm" c="dimmed" p="md">No files match “{search}”.</Text>}
        {d && tree.count > 0 && (
          <Table fz="sm" verticalSpacing={4} highlightOnHover data-testid="asset-tree" style={{ tableLayout: "auto" }}>
            <Table.Tbody>
              <FolderRows folder={tree} depth={0} isOpen={isOpen} flip={flip} release={d.release} onOpen={setOpen} />
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <FileDialog file={open} release={d?.release ?? 0} onClose={() => setOpen(null)} />
      {d && <NewReleaseModal key={`${d.channel}-${d.release}`} opened={drafting} live={d} onClose={() => setDrafting(false)} />}
    </Stack>
  );
}

/** An icon for a kind of file. */
function KindIcon({ kind }: { kind: string }) {
  const props = { size: 15, stroke: 1.6, color: surface.muted };
  switch (kind) {
    case "audio": return <IconMusic {...props} />;
    case "video": return <IconMovie {...props} />;
    case "image": return <IconPhoto {...props} />;
    case "json": return <IconBraces {...props} />;
    case "html": return <IconWorld {...props} />;
    default: return <IconFile {...props} />;
  }
}

const nowrap = { whiteSpace: "nowrap" as const };

/** A folder's rows: its subfolders (each a row that opens it) and its files, indented by depth. */
function FolderRows({ folder, depth, isOpen, flip, release, onOpen }: {
  folder: Folder; depth: number; isOpen: (path: string) => boolean; flip: (path: string) => void; release: number; onOpen: (f: LiveFile) => void;
}) {
  return (
    <>
      {folder.folders.map((sub) => {
        const open = isOpen(sub.path);
        return [
          <Table.Tr key={`d:${sub.path}`} style={{ cursor: "pointer", background: "var(--w-hover)" }}
            onClick={() => flip(sub.path)} data-testid="asset-folder" aria-expanded={open}>
            <Table.Td colSpan={3} style={{ paddingLeft: 12 + depth * 22 }}>
              <UnstyledButton aria-label={`${open ? "Close" : "Open"} ${sub.path}`} onClick={(e) => { e.stopPropagation(); flip(sub.path); }}>
                <Group gap={8} wrap="nowrap">
                  {open ? <IconChevronDown size={14} color={surface.muted} /> : <IconChevronRight size={14} color={surface.muted} />}
                  {open ? <IconFolderOpen size={17} color={surface.accent} stroke={1.6} /> : <IconFolder size={17} color={surface.accent} stroke={1.6} />}
                  <Text size="sm" fw={600}>{sub.name}</Text>
                </Group>
              </UnstyledButton>
            </Table.Td>
            <Table.Td ta="right" style={nowrap}><Text size="xs" c={surface.faint}>{sub.count.toLocaleString()} {sub.count === 1 ? "file" : "files"} · {bytes(sub.size)}</Text></Table.Td>
          </Table.Tr>,
          open && <FolderRows key={`c:${sub.path}`} folder={sub} depth={depth + 1} isOpen={isOpen} flip={flip} release={release} onOpen={onOpen} />,
        ];
      })}
      {folder.files.map((f) => {
        const kind = kindOf(f.mimeType);
        return (
          <Table.Tr key={f.path} style={{ cursor: "pointer" }} onClick={() => onOpen(f)} data-testid="asset-live-file">
            <Table.Td style={{ paddingLeft: 12 + depth * 22 + 22, maxWidth: 0, width: "100%" }}>
              <UnstyledButton aria-label={f.path} onClick={(e) => { e.stopPropagation(); onOpen(f); }} style={{ maxWidth: "100%" }}>
                <Group gap={8} wrap="nowrap">
                  <KindIcon kind={kind} />
                  <Text size="sm" truncate="end" title={f.path}>{f.path.split("/").pop()}</Text>
                  {f.url && <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>CDN</Badge>}
                </Group>
              </UnstyledButton>
            </Table.Td>
            <Table.Td style={nowrap}><Text size="xs" c={surface.muted}>{kind}</Text></Table.Td>
            <Table.Td style={nowrap}>
              {f.since === release
                ? <Badge size="xs" variant="light" color="teal" title="New in this release">new</Badge>
                : <Text size="xs" c={surface.faint} title={`Unchanged since release #${f.since}`}>since #{f.since}</Text>}
            </Table.Td>
            <Table.Td ta="right" style={nowrap}><Text size="xs" c={surface.muted}>{bytes(f.size)}</Text></Table.Td>
          </Table.Tr>
        );
      })}
    </>
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
