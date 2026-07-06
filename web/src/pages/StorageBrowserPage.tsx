import { useEffect, useState } from "react";
import {
  ActionIcon, Anchor, Badge, Box, Button, Code, Group, Menu, Modal, Stack, Table, Text, Textarea, TextInput, Tooltip,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import {
  IconDots, IconDownload, IconEdit, IconFile, IconFolder, IconFolderPlus, IconInfoCircle, IconTrash, IconUpload,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { ConfirmModal } from "../components/ConfirmModal";
import type { FileRecord } from "../api/types";
import { SubsystemTabs } from "./rules/SubsystemTabs";

export function StorageBrowserPage() {
  return (
    <SubsystemTabs subsystem="storage" primaryLabel="Files" basePath="/storage">
      <FilesView />
    </SubsystemTabs>
  );
}

// Upload lifecycle from Winche.Storage: "pending" (record created, bytes not yet confirmed),
// "complete" (confirmed), "failed". Anything unexpected falls back to a neutral badge.
const STATUS_COLORS: Record<string, string> = { complete: "green", pending: "yellow", failed: "red" };
function StatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLORS[status] ?? "gray"} variant="light" size="sm" tt="capitalize">{status}</Badge>;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function FilesView() {
  const qc = useQueryClient();
  const { user } = useSession();
  const canWrite = user?.role !== "Viewer";
  const [path, setPath] = useState("");
  const [details, setDetails] = useState<FileRecord | null>(null);
  const [editMeta, setEditMeta] = useState<FileRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null);
  const [deleteFile, setDeleteFile] = useState<string | null>(null);
  // Object storage has no empty folders, so a freshly created folder lives here in memory (full paths)
  // until a file is uploaded into it. Session-only — gone on refresh.
  const [ephemeral, setEphemeral] = useState<ReadonlySet<string>>(new Set());

  const browse = useQuery({ queryKey: ["browse", path], queryFn: () => api.browseStorage(path) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["browse", path] });
  const remove = useMutation({
    mutationFn: (p: string) => api.deleteFile(p),
    onSuccess: () => { setDeleteFile(null); refresh(); },
  });
  const removeFolder = useMutation({
    mutationFn: (p: string) => api.deleteDirectory(p),
    onSuccess: () => { setDeleteFolder(null); refresh(); },
  });

  const download = async (p: string) => {
    const { downloadUrl } = await api.downloadUrl(p);
    window.open(downloadUrl, "_blank", "noopener");
  };

  // Once a file materializes a folder server-side, drop that folder (and its newly-real ancestors)
  // from the in-memory set so it stops being marked "empty".
  const dropEphemeral = (paths: string[]) =>
    setEphemeral((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const p of paths) if (next.delete(p)) changed = true;
      return changed ? next : prev;
    });

  // Safety net: any in-memory folder that now shows up as a real server folder is no longer ephemeral.
  useEffect(() => {
    const serverFolders = browse.data?.folders;
    if (!serverFolders?.length) return;
    dropEphemeral(serverFolders.map((name) => (path ? `${path}/${name}` : name)));
  }, [browse.data, path]);

  const onUploaded = (uploadedPath: string) => {
    const dir = uploadedPath.includes("/") ? uploadedPath.slice(0, uploadedPath.lastIndexOf("/")) : "";
    if (dir) {
      const segs = dir.split("/");
      dropEphemeral(segs.map((_, i) => segs.slice(0, i + 1).join("/")));
    }
    refresh();
  };

  const segments = path ? path.split("/") : [];
  const goTo = (i: number) => setPath(segments.slice(0, i + 1).join("/"));
  const files = browse.data?.files ?? [];
  const serverFolders = browse.data?.folders ?? [];
  const ephemeralChildren = [...ephemeral]
    .filter((e) => (e.includes("/") ? e.slice(0, e.lastIndexOf("/")) : "") === path)
    .map((e) => e.split("/").pop()!);
  const folderNames = Array.from(new Set([...serverFolders, ...ephemeralChildren])).sort((a, b) => a.localeCompare(b));
  const empty = !browse.isLoading && folderNames.length === 0 && files.length === 0;

  const deletingEphemeral = !!deleteFolder && ephemeral.has(deleteFolder);
  const confirmDeleteFolder = () => {
    if (!deleteFolder) return;
    if (ephemeral.has(deleteFolder)) {
      // Discard the in-memory folder and anything nested under it; nothing was persisted.
      setEphemeral((prev) => {
        const next = new Set<string>();
        for (const e of prev) if (e !== deleteFolder && !e.startsWith(`${deleteFolder}/`)) next.add(e);
        return next;
      });
      setDeleteFolder(null);
    } else {
      removeFolder.mutate(deleteFolder);
    }
  };

  return (
    <Stack gap="sm" h="calc(100vh - 4rem)">
      <Group justify="space-between">
        <Group gap={6} c="#5f6368">
          <IconFolder size={18} />
          <Anchor size="sm" fw={500} c={path ? "#1a73e8" : "#5f6368"} onClick={() => setPath("")}>Files</Anchor>
          {segments.map((s, i) => (
            <Group key={i} gap={6}>
              <Text size="sm" c="dimmed">/</Text>
              <Anchor size="sm" ff="monospace" c={i === segments.length - 1 ? "#5f6368" : "#1a73e8"} onClick={() => goTo(i)}>{s}</Anchor>
            </Group>
          ))}
        </Group>
        {canWrite && (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconFolderPlus size={15} />} onClick={() => setNewFolderOpen(true)}>New folder</Button>
            <Button size="xs" leftSection={<IconUpload size={15} />} onClick={() => setUploadOpen(true)}>Upload</Button>
          </Group>
        )}
      </Group>

      <Box style={{ flex: 1, minHeight: 0, border: "1px solid #e0e0e0", borderRadius: 8, background: "#fff", overflow: "auto" }}>
        {browse.isLoading && <Text size="sm" p="md">Loading…</Text>}
        {empty && <Text size="sm" c="dimmed" p="md">This folder is empty.</Text>}
        {!empty && (
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
              <Table.Tr>
                <Table.Th>Name</Table.Th><Table.Th>Size</Table.Th><Table.Th>Type</Table.Th>
                <Table.Th>Status</Table.Th><Table.Th>Last modified</Table.Th><Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {folderNames.map((name) => {
                const full = path ? `${path}/${name}` : name;
                const eph = !serverFolders.includes(name);
                return (
                  <Table.Tr key={`d:${name}`} style={{ cursor: "pointer" }} onClick={() => setPath(full)}>
                    <Table.Td>
                      <Group gap={8} wrap="nowrap">
                        <IconFolder size={18} color={eph ? "#b0b0b0" : "#5f6368"} />
                        <Text size="sm" fw={500} c={eph ? "dimmed" : undefined}>{name}</Text>
                        {eph && (
                          <Tooltip label="Empty folder kept in memory — upload a file here to save it." withArrow>
                            <Badge size="xs" variant="light" color="gray">empty</Badge>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">—</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">Folder</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">—</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">—</Text></Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                      {canWrite && (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="Folder menu"><IconDots size={18} /></ActionIcon></Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item color="red" leftSection={<IconTrash size={16} />}
                              onClick={() => setDeleteFolder(full)}>Delete folder</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {files.map((f) => (
                <Table.Tr key={`f:${f.path}`}>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap"><IconFile size={18} color="#5f6368" /><Text size="sm" ff="monospace">{f.path.split("/").pop()}</Text></Group>
                  </Table.Td>
                  <Table.Td><Text size="sm">{humanSize(f.sizeBytes)}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{f.mimeType}</Text></Table.Td>
                  <Table.Td><StatusBadge status={f.uploadStatus} /></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{f.updatedAt ? new Date(f.updatedAt).toLocaleString() : "—"}</Text></Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="File menu"><IconDots size={18} /></ActionIcon></Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => download(f.path)}>Download</Menu.Item>
                        <Menu.Item leftSection={<IconInfoCircle size={16} />} onClick={() => setDetails(f)}>Details</Menu.Item>
                        {canWrite && <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditMeta(f)}>Edit metadata</Menu.Item>}
                        {canWrite && (
                          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setDeleteFile(f.path)}>Delete</Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Box>

      <Modal opened={!!details} onClose={() => setDetails(null)} title={details?.path} size="lg">
        <Code block>{JSON.stringify(details, null, 2)}</Code>
      </Modal>

      <UploadModal opened={uploadOpen} dir={path} onClose={() => setUploadOpen(false)} onUploaded={onUploaded} />
      <NewFolderModal opened={newFolderOpen} parent={path} onClose={() => setNewFolderOpen(false)}
        onCreate={(p) => { setEphemeral((prev) => new Set(prev).add(p)); setNewFolderOpen(false); }} />
      {editMeta && <MetadataModal file={editMeta} onClose={() => setEditMeta(null)} onSaved={refresh} />}

      <ConfirmModal
        opened={!!deleteFolder} title="Delete folder" confirmLabel="Delete folder"
        loading={removeFolder.isPending} error={removeFolder.isError ? "Delete failed. Please try again." : null}
        message={deletingEphemeral
          ? <>Remove the empty folder <b>{deleteFolder?.split("/").pop()}</b>? It hasn't been saved yet, so this just clears it from view.</>
          : <>Delete <b>{deleteFolder?.split("/").pop()}</b> and <b>all files inside it</b>? This cannot be undone.</>}
        onConfirm={confirmDeleteFolder} onCancel={() => setDeleteFolder(null)} />

      <ConfirmModal
        opened={!!deleteFile} title="Delete file" confirmLabel="Delete file"
        loading={remove.isPending} error={remove.isError ? "Delete failed. Please try again." : null}
        message={<>Delete <b>{deleteFile?.split("/").pop()}</b>? This can't be undone.</>}
        onConfirm={() => deleteFile && remove.mutate(deleteFile)} onCancel={() => setDeleteFile(null)} />
    </Stack>
  );
}

function UploadModal({ opened, dir, onClose, onUploaded }: {
  opened: boolean; dir: string; onClose: () => void; onUploaded: (uploadedPath: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState(dir);
  const [metaText, setMetaText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the destination to the folder you're viewing each time the dialog opens.
  useEffect(() => { if (opened) { setFolder(dir); setFile(null); setMetaText("{}"); setError(null); } }, [opened, dir]);

  const close = () => { onClose(); };

  const submit = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    let metadata: Record<string, unknown>;
    try { metadata = metaText.trim() ? JSON.parse(metaText) : {}; }
    catch { setError("Metadata is not valid JSON."); setBusy(false); return; }
    try {
      const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
      const path = cleanFolder ? `${cleanFolder}/${file.name}` : file.name;
      const contentType = file.type || "application/octet-stream";
      const { uploadUrl } = await api.uploadUrl(path, contentType, file.size, metadata);
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      if (!put.ok) throw new Error(`Object store rejected the upload (HTTP ${put.status}).`);
      await api.confirmUpload(path);
      onUploaded(path);
      close();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); }
  };

  return (
    <Modal opened={opened} onClose={close} title="Upload file" size="lg">
      <Stack>
        <Dropzone onDrop={(files) => setFile(files[0] ?? null)} maxFiles={1} multiple={false}>
          <Group justify="center" gap="md" mih={120} style={{ pointerEvents: "none" }}>
            <Dropzone.Idle><IconUpload size={36} color="#9aa0a6" /></Dropzone.Idle>
            <div>
              <Text size="sm">Drag a file here or click to browse</Text>
              <Text size="xs" c="dimmed">A single file is uploaded to the destination folder below.</Text>
            </div>
          </Group>
        </Dropzone>
        {file && <Text size="sm">Selected: <b>{file.name}</b> ({humanSize(file.size)}, {file.type || "unknown type"})</Text>}
        <TextInput label="Destination folder" placeholder="(root)" value={folder}
          description="Slash-separated path; created automatically if it doesn't exist."
          onChange={(e) => setFolder(e.currentTarget.value)} styles={{ input: { fontFamily: "monospace" } }} />
        <Textarea label="Metadata (JSON)" autosize minRows={3} value={metaText}
          onChange={(e) => setMetaText(e.currentTarget.value)} styles={{ input: { fontFamily: "monospace" } }} />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Button onClick={submit} loading={busy} disabled={!file}>Upload</Button>
      </Stack>
    </Modal>
  );
}

function NewFolderModal({ opened, parent, onClose, onCreate }: {
  opened: boolean; parent: string; onClose: () => void; onCreate: (path: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => { if (opened) setName(""); }, [opened]);

  // One level at a time — strip any slashes so a name is always a single segment.
  const submit = () => {
    const n = name.trim().replace(/\//g, "");
    if (!n) return;
    onCreate(parent ? `${parent}/${n}` : n);
  };

  return (
    <Modal opened={opened} onClose={onClose} title="New folder">
      <Stack>
        <Text size="xs" c="dimmed">
          Object storage has no empty folders, so the folder is kept in memory and saved automatically when
          you upload the first file into it. Create subfolders by opening a folder and adding another.
        </Text>
        <TextInput label="Folder name" placeholder="reports" value={name} data-autofocus
          onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <Text size="xs" c="dimmed">Created under: <b>{parent ? `${parent}/` : "/"}</b></Text>
        <Button onClick={submit} disabled={!name.trim()}>Create</Button>
      </Stack>
    </Modal>
  );
}

function MetadataModal({ file, onClose, onSaved }: { file: FileRecord; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify(file.metadata ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setError(null);
    let metadata: Record<string, unknown>;
    try { metadata = text.trim() ? JSON.parse(text) : {}; }
    catch { setError("Not valid JSON."); setBusy(false); return; }
    try { await api.updateFileMetadata(file.path, metadata); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
  };

  return (
    <Modal opened onClose={onClose} title={`Metadata — ${file.path}`} size="lg">
      <Stack>
        <Textarea autosize minRows={6} value={text} onChange={(e) => setText(e.currentTarget.value)}
          styles={{ input: { fontFamily: "monospace" } }} />
        {error && <Text c="red" size="sm">{error}</Text>}
        <Button onClick={save} loading={busy}>Save metadata</Button>
      </Stack>
    </Modal>
  );
}
