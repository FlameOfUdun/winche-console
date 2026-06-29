import { Fragment, useEffect, useRef, useState } from "react";
import {
  ActionIcon, Anchor, Box, Button, Divider, Group, Stack, Text, TextInput, Tooltip,
} from "@mantine/core";
import { IconChevronRight, IconDatabase, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { ConfirmModal } from "../components/ConfirmModal";
import { FieldsEditor } from "../data/FieldsEditor";
import { parseFields, serializeFields, type FieldEntry } from "../data/fields";

export function DataBrowserPage() {
  return <DataView />;
}

const COL_W = 270;
const DOC_W = 560;
const segCount = (p: string) => p.split("/").filter(Boolean).length;
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const autoId = () => Array.from({ length: 20 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join("");

function PanelHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Group h={44} px="sm" justify="space-between" style={{ borderBottom: "1px solid #e0e0e0", background: "#fafafa", flexShrink: 0 }}>
      <Text size="sm" fw={500} c="#5f6368" truncate>{title}</Text>
      {children}
    </Group>
  );
}

function Column({ children, width = COL_W }: { children: React.ReactNode; width?: number }) {
  return (
    <Box w={width} style={{ borderRight: "1px solid #e0e0e0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {children}
    </Box>
  );
}

function Row({ active, onClick, label, onDelete, deleteLabel }: {
  active?: boolean; onClick: () => void; label: string; onDelete?: () => void; deleteLabel?: string;
}) {
  const { user } = useSession();
  const showDelete = onDelete && user?.role !== "Viewer";
  return (
    <Box
      role="button" onClick={onClick} px="sm" py={8}
      style={{
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
        background: active ? "#e8f0fe" : undefined, borderLeft: active ? "3px solid #1a73e8" : "3px solid transparent",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#f5f5f5"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = ""; }}
    >
      <Text size="sm" ff="monospace" truncate style={{ flex: 1 }}>{label}</Text>
      {showDelete && (
        <ActionIcon size="xs" variant="subtle" color="red" aria-label={deleteLabel ?? "Delete"}
          onClick={(e) => { e.stopPropagation(); onDelete!(); }}><IconTrash size={13} /></ActionIcon>
      )}
      <IconChevronRight size={14} color="#9aa0a6" />
    </Box>
  );
}

function AddInline({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (value: string) => void }) {
  const { user } = useSession();
  const [value, setValue] = useState("");
  const submit = () => { onAdd(value.trim()); setValue(""); };
  if (user?.role === "Viewer") return null;
  return (
    <Group gap={6} p="sm" style={{ borderBottom: "1px solid #f1f3f4" }}>
      <TextInput size="xs" placeholder={placeholder} value={value}
        onChange={(e) => setValue(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} style={{ flex: 1 }} />
      <Button size="xs" variant="light" onClick={submit}>{label}</Button>
    </Group>
  );
}

function DocumentsColumn({ collection, selectedDoc, onSelect, onAdd }: {
  collection: string; selectedDoc: string | null; onSelect: (docId: string) => void; onAdd: (docId: string) => void;
}) {
  const docs = useQuery({ queryKey: ["data", collection], queryFn: () => api.queryDocuments(collection) });
  return (
    <Column>
      <PanelHeader title={collection.split("/").pop()} />
      <AddInline placeholder="Document ID (optional)" label="Add" onAdd={onAdd} />
      <Box style={{ overflow: "auto" }}>
        {docs.isLoading && <Text size="sm" p="sm">Loading…</Text>}
        {docs.data?.documents.length === 0 && <Text size="sm" c="dimmed" p="sm">No documents.</Text>}
        {docs.data?.documents.map((d) => <Row key={d.path} active={d.id === selectedDoc} onClick={() => onSelect(d.id)} label={d.id} />)}
      </Box>
    </Column>
  );
}

function DocumentColumn({ docPath, added, activeSub, onOpenSub, onAddSub, onDeleteSub, onDelete }: {
  docPath: string; added: string[]; activeSub: string | null;
  onOpenSub: (cid: string) => void; onAddSub: (cid: string) => void; onDeleteSub: (collection: string) => void; onDelete: (path: string) => void;
}) {
  const qc = useQueryClient();
  const { user } = useSession();
  const canWrite = user?.role !== "Viewer";
  // Subcollections of this document, fetched lazily via the library's collection lister, merged with
  // any locally-added (not-yet-persisted) subcollections.
  const subsQuery = useQuery({ queryKey: ["subcollections", docPath], queryFn: () => api.listCollections(docPath) });
  const subs = Array.from(new Set([
    ...(subsQuery.data ?? []),
    ...added.filter((c) => c.startsWith(docPath + "/") && segCount(c) === segCount(docPath) + 1),
  ]));
  const doc = useQuery({ queryKey: ["doc", docPath], queryFn: () => api.getDocument(docPath) });
  const [entries, setEntries] = useState<FieldEntry[]>([]);
  useEffect(() => { if (doc.data) setEntries(parseFields(doc.data.fields)); }, [doc.data]);

  const save = useMutation({
    mutationFn: (fields: Record<string, unknown>) => api.putDocument(docPath, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doc", docPath] });
      qc.invalidateQueries({ queryKey: ["data", docPath.split("/").slice(0, -1).join("/")] });
    },
  });

  // Edits persist immediately. Every field-tree change (a ✓ commit, add, or delete) PUTs the whole
  // document when its serialized form differs from what the server currently has. Adding an empty field
  // is a no-op here (serializeFields drops blank-named fields) until you confirm it with a name.
  const handleChange = (next: FieldEntry[]) => {
    setEntries(next);
    if (canWrite && doc.data && JSON.stringify(serializeFields(next)) !== JSON.stringify(doc.data.fields)) {
      save.mutate(serializeFields(next));
    }
  };

  return (
    <Column width={DOC_W}>
      <PanelHeader title={docPath.split("/").pop()}>
        {canWrite && (
          <Tooltip label="Delete document">
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Delete document" onClick={() => onDelete(docPath)}><IconTrash size={16} /></ActionIcon>
          </Tooltip>
        )}
      </PanelHeader>

      <Box style={{ overflow: "auto" }}>
        <Text size="xs" fw={600} c="#5f6368" px="sm" pt="sm">COLLECTIONS</Text>
        <AddInline placeholder="Collection ID" label="Add" onAdd={onAddSub} />
        {subs.length === 0 && <Text size="xs" c="dimmed" px="sm" py={6}>No collections.</Text>}
        {subs.map((s) => (
          <Row key={s} active={s === activeSub} onClick={() => onOpenSub(s)} label={s.split("/").pop() ?? s}
            onDelete={() => onDeleteSub(s)} deleteLabel="Delete collection" />
        ))}

        <Divider my={4} />

        <Group justify="space-between" px="sm" pt="xs" mih={26}>
          <Text size="xs" fw={600} c="#5f6368">FIELDS</Text>
          {save.isPending && <Text size="xs" c="dimmed">Saving…</Text>}
          {save.isError && <Text size="xs" c="red">Save failed</Text>}
        </Group>
        <Box p="sm">
          {doc.isLoading ? <Text size="sm">Loading…</Text>
            : <FieldsEditor entries={entries} onChange={handleChange} readOnly={!canWrite} />}
        </Box>
      </Box>
    </Column>
  );
}

interface Level { collection: string; doc: string | null }

function DataView() {
  const qc = useQueryClient();
  const [added, setAdded] = useState<string[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [confirm, setConfirm] = useState<{ kind: "document" | "collection"; path: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    const raf = requestAnimationFrame(() => el.scrollTo({ left: el.scrollWidth, behavior: "smooth" }));
    return () => cancelAnimationFrame(raf);
  }, [levels]);

  // Root collections from the library's collection lister (parent = root).
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: () => api.listCollections() });
  const roots = Array.from(new Set([...(collectionsQuery.data ?? []), ...added.filter((c) => segCount(c) === 1)]));

  const openRoot = (c: string) => setLevels([{ collection: c, doc: null }]);
  const selectDoc = (i: number, docId: string) => setLevels(levels.slice(0, i + 1).map((l, idx) => (idx === i ? { ...l, doc: docId } : l)));
  const openSub = (i: number, sub: string) => setLevels([...levels.slice(0, i + 1), { collection: sub, doc: null }]);

  const addRoot = (raw: string) => {
    const c = raw || autoId();
    if (!roots.includes(c)) setAdded([...added, c]);
    openRoot(c);
  };

  const createDoc = useMutation({
    mutationFn: (v: { collection: string; docId: string }) => api.putDocument(`${v.collection}/${v.docId}`, {}),
  });
  const addDoc = async (i: number, raw: string) => {
    const docId = raw || autoId();
    await createDoc.mutateAsync({ collection: levels[i].collection, docId });
    qc.invalidateQueries({ queryKey: ["data", levels[i].collection] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["subcollections"] });
    selectDoc(i, docId);
  };
  const addSub = (i: number, raw: string) => {
    if (!levels[i].doc) return;
    const sub = `${levels[i].collection}/${levels[i].doc}/${raw || autoId()}`;
    if (!added.includes(sub)) setAdded([...added, sub]);
    openSub(i, sub);
  };

  const remove = useMutation({
    mutationFn: (path: string) => api.deleteDocument(path),
    onSuccess: (_r, path) => {
      setConfirm(null);
      setLevels((ls) => ls.map((l) => (`${l.collection}/${l.doc}` === path ? { ...l, doc: null } : l)));
      qc.invalidateQueries({ queryKey: ["data", path.split("/").slice(0, -1).join("/")] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["subcollections"] });
    },
  });
  const deleteCollection = useMutation({
    mutationFn: (collection: string) => api.deleteCollection(collection),
    onSuccess: (_r, collection) => {
      setConfirm(null);
      setAdded((a) => a.filter((c) => c !== collection && !c.startsWith(collection + "/")));
      setLevels((ls) => ls.filter((l) => l.collection !== collection && !l.collection.startsWith(collection + "/")));
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["subcollections"] });
      qc.invalidateQueries({ queryKey: ["data", collection] });
    },
  });

  // Destructive deletes go through a confirmation dialog; the trash buttons just stage the target here.
  const confirmDelete = () => {
    if (!confirm) return;
    if (confirm.kind === "document") remove.mutate(confirm.path);
    else deleteCollection.mutate(confirm.path);
  };
  const confirmName = confirm?.path.split("/").pop();

  const crumbs: { label: string; nav: () => void }[] = [];
  levels.forEach((l, i) => {
    crumbs.push({ label: l.collection.split("/").pop()!, nav: () => setLevels([...levels.slice(0, i), { collection: l.collection, doc: null }]) });
    if (l.doc) crumbs.push({ label: l.doc, nav: () => setLevels(levels.slice(0, i + 1)) });
  });

  return (
    <Stack gap="sm" h="calc(100vh - 4rem)">
      <Group gap={6} c="#5f6368">
        <IconDatabase size={18} />
        <Anchor size="sm" fw={500} c="#5f6368" onClick={() => setLevels([])}>Database</Anchor>
        {crumbs.map((cr, i) => (
          <Fragment key={i}>
            <IconChevronRight size={14} />
            <Anchor size="sm" ff="monospace" onClick={cr.nav}>{cr.label}</Anchor>
          </Fragment>
        ))}
      </Group>

      <Box ref={scrollRef} style={{ flex: 1, minHeight: 0, border: "1px solid #e0e0e0", borderRadius: 8, background: "#fff", display: "flex", overflow: "auto" }}>
        <Column>
          <PanelHeader title="Collections" />
          <AddInline placeholder="Collection ID" label="Add" onAdd={addRoot} />
          <Box style={{ overflow: "auto" }}>
            {collectionsQuery.isLoading && <Text size="sm" c="dimmed" p="sm">Loading…</Text>}
            {!collectionsQuery.isLoading && roots.length === 0 && <Text size="sm" c="dimmed" p="sm">No collections yet. Add one above.</Text>}
            {roots.map((c) => (
              <Row key={c} active={levels[0]?.collection === c} onClick={() => openRoot(c)} label={c}
                onDelete={() => setConfirm({ kind: "collection", path: c })} deleteLabel="Delete collection" />
            ))}
          </Box>
        </Column>

        {levels.map((lvl, i) => (
          <Fragment key={`${i}-${lvl.collection}`}>
            <DocumentsColumn collection={lvl.collection} selectedDoc={lvl.doc}
              onSelect={(docId) => selectDoc(i, docId)} onAdd={(docId) => addDoc(i, docId)} />
            {lvl.doc && (
              <DocumentColumn
                docPath={`${lvl.collection}/${lvl.doc}`}
                added={added} activeSub={levels[i + 1]?.collection ?? null}
                onOpenSub={(sub) => openSub(i, sub)} onAddSub={(cid) => addSub(i, cid)}
                onDeleteSub={(collection) => setConfirm({ kind: "collection", path: collection })}
                onDelete={(path) => setConfirm({ kind: "document", path })}
              />
            )}
          </Fragment>
        ))}

        {levels.length === 0 && <Box p="lg"><Text size="sm" c="dimmed">Select a collection to browse documents.</Text></Box>}
      </Box>

      <ConfirmModal
        opened={!!confirm}
        title={confirm?.kind === "collection" ? "Delete collection" : "Delete document"}
        confirmLabel={confirm?.kind === "collection" ? "Delete collection" : "Delete document"}
        loading={confirm?.kind === "collection" ? deleteCollection.isPending : remove.isPending}
        error={(confirm?.kind === "collection" ? deleteCollection.isError : remove.isError) ? "Delete failed. Please try again." : null}
        message={confirm?.kind === "collection"
          ? <>Delete collection <b>{confirmName}</b> and <b>all documents in it</b>? This can't be undone.</>
          : <>Delete document <b>{confirmName}</b> and its fields? This can't be undone.</>}
        onConfirm={confirmDelete} onCancel={() => setConfirm(null)} />
    </Stack>
  );
}
