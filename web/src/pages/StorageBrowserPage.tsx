import { useEffect, useState } from "react";
import {
  ActionIcon, Anchor, Box, Button, Code, Group, Menu, Modal, Stack, Table, Text, Textarea, TextInput,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import {
  IconDots, IconDownload, IconEdit, IconFile, IconFolder, IconFolderPlus, IconInfoCircle, IconTrash, IconUpload,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import type { FileRecord } from "../api/types";

export function StorageBrowserPage() {
  return <FilesView />;
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

  const browse = useQuery({ queryKey: ["browse", path], queryFn: () => api.browseStorage(path) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["browse", path] });
  const remove = useMutation({ mutationFn: (p: string) => api.deleteFile(p), onSuccess: refresh });

  const download = async (p: string) => {
    const { downloadUrl } = await api.downloadUrl(p);
    window.open(downloadUrl, "_blank", "noopener");
  };

  const segments = path ? path.split("/") : [];
  const goTo = (i: number) => setPath(segments.slice(0, i + 1).join("/"));
  const folders = browse.data?.folders ?? [];
  const files = browse.data?.files ?? [];
  const empty = !browse.isLoading && folders.length === 0 && files.length === 0;

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
                <Table.Th>Last modified</Table.Th><Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {folders.map((f) => (
                <Table.Tr key={`d:${f}`} style={{ cursor: "pointer" }} onClick={() => setPath(path ? `${path}/${f}` : f)}>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap"><IconFolder size={18} color="#5f6368" /><Text size="sm" fw={500}>{f}</Text></Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">—</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">Folder</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">—</Text></Table.Td>
                  <Table.Td />
                </Table.Tr>
              ))}
              {files.map((f) => (
                <Table.Tr key={`f:${f.path}`}>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap"><IconFile size={18} color="#5f6368" /><Text size="sm" ff="monospace">{f.path.split("/").pop()}</Text></Group>
                  </Table.Td>
                  <Table.Td><Text size="sm">{humanSize(f.sizeBytes)}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{f.mimeType}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{f.updatedAt ? new Date(f.updatedAt).toLocaleString() : "—"}</Text></Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="File menu"><IconDots size={18} /></ActionIcon></Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => download(f.path)}>Download</Menu.Item>
                        <Menu.Item leftSection={<IconInfoCircle size={16} />} onClick={() => setDetails(f)}>Details</Menu.Item>
                        {canWrite && <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditMeta(f)}>Edit metadata</Menu.Item>}
                        {canWrite && (
                          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => remove.mutate(f.path)}>Delete</Menu.Item>
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

      <UploadModal opened={uploadOpen} dir={path} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <NewFolderModal opened={newFolderOpen} parent={path} onClose={() => setNewFolderOpen(false)}
        onCreate={(p) => { setPath(p); setNewFolderOpen(false); setUploadOpen(true); }} />
      {editMeta && <MetadataModal file={editMeta} onClose={() => setEditMeta(null)} onSaved={refresh} />}
    </Stack>
  );
}

function UploadModal({ opened, dir, onClose, onUploaded }: {
  opened: boolean; dir: string; onClose: () => void; onUploaded: () => void;
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
      onUploaded();
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

  const submit = () => {
    const n = name.trim().replace(/^\/+|\/+$/g, "");
    if (!n) return;
    onCreate(parent ? `${parent}/${n}` : n);
  };

  return (
    <Modal opened={opened} onClose={onClose} title="New folder">
      <Stack>
        <Text size="xs" c="dimmed">
          Object storage has no empty folders — this opens the folder and the upload dialog so the folder
          is created when you add the first file.
        </Text>
        <TextInput label="Folder name" placeholder="reports" value={name} data-autofocus
          onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <Text size="xs" c="dimmed">Will be created under: <b>{parent ? `${parent}/` : "/"}</b></Text>
        <Button onClick={submit} disabled={!name.trim()}>Create &amp; add files</Button>
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
