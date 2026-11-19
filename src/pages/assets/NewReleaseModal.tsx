import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, Progress, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorWithList } from "../../api/appAuth";
import { bytes, type AssetLiveFiles } from "../../api/assets";
import { surface } from "../../theme";

type Live = AssetLiveFiles["files"][number];

/** A file of the draft: kept from the release, added or replacing one (a file to upload, or one on a CDN), or taken out. */
type Draft =
  | { path: string; status: "kept" | "removed"; live: Live }
  | { path: string; status: "added" | "replaced"; upload: File; live?: Live }
  | { path: string; status: "added" | "replaced"; cdn: { url: string; hash: string; size: number; mimeType: string | null }; live?: Live };

const STATUS: Record<Draft["status"], { label: string; color: string }> = {
  kept: { label: "unchanged", color: "gray" }, added: { label: "added", color: "teal" }, replaced: { label: "replaced", color: "blue" }, removed: { label: "removed", color: "red" },
};

/** The SHA-256 of a file's bytes, in lowercase hex (what releases name contents by). */
async function sha256(file: Blob) {
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();   // in every browser, and in tests
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (p: string) => p.replace(/\\/g, "/").split("/").filter((s) => s && s !== "." && s !== "..").join("/");

/**
 * A release made in the console: it starts as the channel's release; files are added, replaced (uploaded, or named on a
 * CDN) or taken out, then published with a note, moving the channel to it if asked. Only contents the server doesn't
 * have are uploaded. It's marked as made in the console, so a deploy from the repository's folder says what it'd remove.
 */
export function NewReleaseModal({ opened, live, onClose }: { opened: boolean; live: AssetLiveFiles; onClose: () => void }) {
  const qc = useQueryClient();
  const start = () => new Map<string, Draft>(live.files.map((f) => [f.path, { path: f.path, status: "kept", live: f }]));
  const [draft, setDraft] = useState<Map<string, Draft>>(start);
  const [folder, setFolder] = useState("");
  const [cdnPath, setCdnPath] = useState("");
  const [cdnUrl, setCdnUrl] = useState("");
  const [note, setNote] = useState("");
  const [move, setMove] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<{ step: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const dir = useRef<HTMLInputElement>(null);

  const reset = () => { setDraft(start()); setFolder(""); setCdnPath(""); setCdnUrl(""); setNote(""); setMove(true); setSearch(""); setError(null); setBusy(null); };
  const close = () => { if (busy) return; reset(); onClose(); };

  const put = (entries: Draft[]) => setDraft((d) => { const next = new Map(d); for (const e of entries) next.set(e.path, e); return next; });
  const addFiles = (list: FileList | File[], relative: boolean) => {
    const prefix = clean(folder);
    put([...list].map((f) => {
      const rel = clean(relative && (f as File & { webkitRelativePath?: string }).webkitRelativePath ? (f as File & { webkitRelativePath: string }).webkitRelativePath : f.name);
      const path = prefix ? `${prefix}/${rel}` : rel;
      const was = draft.get(path);
      const liveFile = was && "live" in was ? was.live : undefined;
      return { path, status: liveFile ? "replaced" : "added", upload: f, live: liveFile };
    }));
  };
  const addCdn = async () => {
    const path = clean(cdnPath);
    setError(null);
    try {
      const [seen] = (await api.inspectAssetCdnFiles([cdnUrl.trim()])).files;
      if (!seen || seen.error || !seen.hash) { setError(seen?.error ?? "The CDN file couldn't be read."); return; }
      const was = draft.get(path);
      const liveFile = was && "live" in was ? was.live : undefined;
      put([{ path, status: liveFile ? "replaced" : "added", cdn: { url: seen.url, hash: seen.hash, size: seen.size, mimeType: seen.mimeType }, live: liveFile }]);
      setCdnPath(""); setCdnUrl("");
    } catch (e) { setError(errorWithList(e)); }
  };
  const toggle = (e: Draft) => {
    if (e.status === "kept") put([{ ...e, status: "removed" }]);
    else if (e.status === "removed") put([{ ...e, status: "kept" }]);
    else if (e.live) put([{ path: e.path, status: "kept", live: e.live }]);   // back to the release's
    else setDraft((d) => { const next = new Map(d); next.delete(e.path); return next; });
  };

  const all = useMemo(() => [...draft.values()].sort((a, b) => a.path.localeCompare(b.path)), [draft]);
  const changes = all.filter((e) => e.status !== "kept");
  const shown = all.filter((e) => !search.trim() || e.path.toLowerCase().includes(search.trim().toLowerCase()));
  const kept = all.filter((e) => e.status !== "removed");

  const publish = async () => {
    setError(null);
    try {
      const out: Record<string, { hash: string; size: number; mimeType: string; url?: string | null }> = {};
      const uploads: { path: string; file: File; hash: string }[] = [];
      const toHash = kept.filter((e): e is Extract<Draft, { upload: File }> => "upload" in e);
      for (const [i, e] of toHash.entries()) {
        setBusy({ step: `Reading ${e.path}`, done: i, total: toHash.length });
        uploads.push({ path: e.path, file: e.upload, hash: await sha256(e.upload) });
      }
      for (const e of kept) {
        if ("upload" in e) { const u = uploads.find((x) => x.path === e.path)!; out[e.path] = { hash: u.hash, size: e.upload.size, mimeType: "" }; }
        else if ("cdn" in e) out[e.path] = { hash: e.cdn.hash, size: e.cdn.size, mimeType: "", url: e.cdn.url };
        else out[e.path] = { hash: e.live.hash, size: e.live.size, mimeType: e.live.mimeType, url: e.live.url ?? null };
      }
      // Only contents the server doesn't have yet are sent.
      const missing = new Set(uploads.length ? (await api.assetsMissing([...new Set(uploads.map((u) => u.hash))])).missing : []);
      const sending = uploads.filter((u) => missing.delete(u.hash));
      const total = sending.reduce((a, u) => a + u.file.size, 0);
      let sent = 0;
      for (const u of sending) {
        setBusy({ step: `Uploading ${u.path}`, done: sent, total });
        await api.putAssetContent(u.hash, u.file);
        sent += u.file.size;
      }
      setBusy({ step: "Publishing", done: 1, total: 1 });
      await api.publishAssetRelease(out, note.trim(), move ? live.channel : null);
      for (const key of [["assets"], ["asset-live", live.channel]]) await qc.invalidateQueries({ queryKey: key });
      setBusy(null);
      reset();
      onClose();
    } catch (e) {
      setBusy(null);
      setError(errorWithList(e));
    }
  };

  return (
    <Modal opened={opened} onClose={close} radius="lg" size="xl" title={<Text fw={700}>New release</Text>}
      styles={{
        // The dialog fits the window: its controls and Publish stay put, only the file list scrolls.
        content: { display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 2 * var(--modal-y-offset, 5dvh))" },
        body: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" },
      }}>
      <Stack gap="sm" data-testid="new-release" style={{ flex: "1 1 auto", minHeight: 0 }}>
        <Text size="sm" c="dimmed">Starts from {live.channel}'s release #{live.release}. Add or replace files, take some out, then publish.</Text>

        <Paper withBorder radius="md" p="sm"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, false); }}
          style={{ borderStyle: "dashed" }} data-testid="new-release-drop">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput size="xs" label="Into folder" placeholder="audio/de" value={folder} onChange={(e) => setFolder(e.currentTarget.value)} w={200} />
            <Button size="xs" variant="default" leftSection={<IconUpload size={14} />} onClick={() => files.current?.click()}>Add files</Button>
            <Button size="xs" variant="default" onClick={() => dir.current?.click()}>Add a folder</Button>
            <Text size="xs" c="dimmed">or drop files here. A file at a path the release has replaces it.</Text>
          </Group>
          <input ref={files} type="file" multiple hidden data-testid="new-release-files"
            onChange={(e) => { if (e.currentTarget.files) addFiles(e.currentTarget.files, false); e.currentTarget.value = ""; }} />
          <input ref={dir} type="file" multiple hidden {...{ webkitdirectory: "", directory: "" }}
            onChange={(e) => { if (e.currentTarget.files) addFiles(e.currentTarget.files, true); e.currentTarget.value = ""; }} />
          <Group gap="sm" align="flex-end" wrap="wrap" mt="sm">
            <TextInput size="xs" label="On a CDN: path" placeholder="videos/bvm.mp4" value={cdnPath} onChange={(e) => setCdnPath(e.currentTarget.value)} w={200} />
            <TextInput size="xs" label="Address" placeholder="https://cdn.example.com/app/bvm.mp4" value={cdnUrl} onChange={(e) => setCdnUrl(e.currentTarget.value)} style={{ flex: 1, minWidth: 220 }} />
            <Button size="xs" variant="default" disabled={!clean(cdnPath) || !cdnUrl.trim()} onClick={addCdn}>Add</Button>
          </Group>
        </Paper>

        <Group justify="space-between" gap="xs">
          <Text size="sm" fw={500}>{kept.length.toLocaleString()} files{changes.length ? ` · ${changes.length} change${changes.length === 1 ? "" : "s"}` : ""}</Text>
          <TextInput size="xs" placeholder="Search paths" aria-label="Search the draft" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={200} />
        </Group>
        <div style={{ flex: "1 1 auto", minHeight: 120, overflow: "auto", border: `1px solid ${surface.subtle}`, borderRadius: 8 }}>
          <Table fz="xs" verticalSpacing={3} data-testid="new-release-files-list">
            <Table.Tbody>
              {shown.map((e) => (
                <Table.Tr key={e.path} data-testid="draft-file">
                  <Table.Td><Text size="xs" ff="monospace" td={e.status === "removed" ? "line-through" : undefined}>{e.path}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Badge size="xs" variant="light" color={STATUS[e.status].color}>{STATUS[e.status].label}</Badge>
                      {("cdn" in e || (e.status === "kept" && e.live.url)) && <Badge size="xs" variant="light">CDN</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right"><Text size="xs" c={surface.muted}>{bytes("upload" in e ? e.upload.size : "cdn" in e ? e.cdn.size : e.live.size)}</Text></Table.Td>
                  <Table.Td ta="right" w={90}>
                    <Button size="compact-xs" variant="subtle" color={e.status === "kept" ? "red" : "gray"} onClick={() => toggle(e)} disabled={!!busy}>
                      {e.status === "kept" ? "Remove" : e.status === "removed" ? "Keep" : "Undo"}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>

        <TextInput label="What changed" placeholder="German audio" value={note} onChange={(e) => setNote(e.currentTarget.value)} disabled={!!busy} />
        <Checkbox label={`Point ${live.channel} at it (apps get it on their next sync)`} checked={move} onChange={(e) => setMove(e.currentTarget.checked)} disabled={!!busy} />
        <Text size="xs" c="dimmed">A deploy from your repository's folder later publishes the folder as it is: it lists what it would take out of this release and asks first.</Text>
        {busy && (
          <Stack gap={4}>
            <Text size="xs">{busy.step}…</Text>
            <Progress value={busy.total ? (busy.done / busy.total) * 100 : 100} size="sm" />
          </Stack>
        )}
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close} disabled={!!busy}>Cancel</Button>
          <Button onClick={publish} loading={!!busy} disabled={!note.trim() || changes.length === 0 || kept.length === 0}>Publish</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
