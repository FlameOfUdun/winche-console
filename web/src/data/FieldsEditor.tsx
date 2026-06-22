import { useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Button, Collapse, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconCheck, IconChevronRight, IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { type EditValue, type FieldEntry, type ValueType, defaultValue, valueTypeOptions } from "./fields";

const KEY_COLOR = "#3c4043";
const VALUE_COLOR = "#0b8043";
const TYPE_COLOR = "#9aa0a6";
const CARET_W = 18;

/** Right-pointing caret that rotates down when open; the collapse toggle for maps & arrays. */
function Caret({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Box role="button" aria-label={open ? "Collapse" : "Expand"} onClick={onToggle}
      style={{ cursor: "pointer", width: CARET_W, display: "grid", placeItems: "center", flexShrink: 0 }}>
      <IconChevronRight size={15} color={TYPE_COLOR}
        style={{ transition: "transform 120ms ease", transform: open ? "rotate(90deg)" : "none" }} />
    </Box>
  );
}

/** Read-only preview of a scalar value, mirroring Firestore (strings quoted, geopoints bracketed). */
function valuePreview(v: EditValue): string {
  switch (v.type) {
    case "string": return `"${v.text ?? ""}"`;
    case "boolean": return v.bool ? "true" : "false";
    case "null": return "null";
    case "geopoint": return `[${v.lat ?? "0"}, ${v.lng ?? "0"}]`;
    default: return v.text ?? "";
  }
}

/** Editable input(s) for the value portion of a node while in edit mode. */
function ValueInput({ value, onChange, onEnter }: {
  value: EditValue; onChange: (v: EditValue) => void; onEnter: () => void;
}) {
  switch (value.type) {
    case "boolean":
      return (
        <Select size="xs" w={110} allowDeselect={false}
          data={[{ value: "true", label: "true" }, { value: "false", label: "false" }]}
          value={value.bool ? "true" : "false"} onChange={(v) => onChange({ ...value, bool: v === "true" })} />
      );
    case "geopoint":
      return (
        <Group gap={6} wrap="nowrap">
          <TextInput size="xs" w={100} placeholder="latitude" value={value.lat ?? ""} onChange={(e) => onChange({ ...value, lat: e.currentTarget.value })} />
          <TextInput size="xs" w={100} placeholder="longitude" value={value.lng ?? ""} onChange={(e) => onChange({ ...value, lng: e.currentTarget.value })} />
        </Group>
      );
    case "null":
      return <Text size="xs" c="dimmed">null</Text>;
    case "array":
    case "map":
      return <Text size="xs" c="dimmed">use ＋ to add {value.type === "array" ? "items" : "fields"}</Text>;
    default:
      return (
        <TextInput
          size="xs" style={{ flex: 1, minWidth: 180 }} value={value.text ?? ""}
          placeholder={value.type === "reference" ? "users/alice" : value.type === "timestamp" ? "2026-01-01T00:00:00Z" : "value"}
          inputMode={value.type === "integer" || value.type === "double" ? "decimal" : undefined}
          onChange={(e) => onChange({ ...value, text: e.currentTarget.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }} />
      );
  }
}

interface FieldNodeProps {
  keyName: string;
  keyEditable: boolean;          // map fields & top-level: true; array items: false
  value: EditValue;
  readOnly?: boolean;
  autoEdit?: boolean;            // open in edit mode on mount (freshly added node)
  isNew?: boolean;               // cancelling a never-committed node removes it
  onChangeValue: (v: EditValue) => void;             // live value-only update (add child / child bubbling)
  onCommit: (name: string, value: EditValue) => void; // atomic name+value commit of a ✓ edit
  onDelete: () => void;
}

/** One node in the document field tree. Recurses for map entries and array items (Firestore-style). */
function FieldNode({ keyName, keyEditable, value, readOnly, autoEdit = false, isNew = false, onChangeValue, onCommit, onDelete }: FieldNodeProps) {
  const complex = value.type === "map" || value.type === "array";
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(autoEdit);
  const [fresh, setFresh] = useState(isNew);          // captured once at mount
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState<{ name: string; value: EditValue }>({ name: keyName, value });
  const [autoChild, setAutoChild] = useState<number | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && keyEditable) keyRef.current?.focus(); }, [editing, keyEditable]);

  const beginEdit = () => { setDraft({ name: keyName, value }); setEditing(true); };
  const cancel = () => { setEditing(false); if (fresh) onDelete(); setFresh(false); };
  const commit = () => {
    const typeChanged = draft.value.type !== value.type;
    const complexUnchanged = !typeChanged && complex;
    // Apply name + value in ONE update so neither clobbers the other. For an unchanged map/array keep the
    // live value (its children may have been edited since this node entered edit mode).
    onCommit(keyEditable ? draft.name : keyName, complexUnchanged ? value : draft.value);
    if (typeChanged && (draft.value.type === "map" || draft.value.type === "array")) setExpanded(true);
    setEditing(false);
    setFresh(false);
  };

  const addChild = () => {
    if (value.type === "map") {
      const entries = value.entries ?? [];
      onChangeValue({ ...value, entries: [...entries, { name: "", value: defaultValue("string") }] });
      setAutoChild(entries.length);
    } else if (value.type === "array") {
      const items = value.items ?? [];
      onChangeValue({ ...value, items: [...items, defaultValue("string")] });
      setAutoChild(items.length);
    }
    setExpanded(true);
  };

  const childNodes = value.type === "map"
    ? (value.entries ?? []).map((en, i) => (
        <FieldNode
          key={i} keyName={en.name} keyEditable value={en.value} readOnly={readOnly}
          autoEdit={i === autoChild} isNew={i === autoChild}
          onChangeValue={(v) => onChangeValue({ ...value, entries: (value.entries ?? []).map((x, xi) => (xi === i ? { ...x, value: v } : x)) })}
          onCommit={(name, v) => onChangeValue({ ...value, entries: (value.entries ?? []).map((x, xi) => (xi === i ? { name, value: v } : x)) })}
          onDelete={() => onChangeValue({ ...value, entries: (value.entries ?? []).filter((_, xi) => xi !== i) })} />
      ))
    : value.type === "array"
    ? (value.items ?? []).map((it, i) => (
        <FieldNode
          key={i} keyName={String(i)} keyEditable={false} value={it} readOnly={readOnly}
          autoEdit={i === autoChild} isNew={i === autoChild}
          onChangeValue={(v) => onChangeValue({ ...value, items: (value.items ?? []).map((x, xi) => (xi === i ? v : x)) })}
          onCommit={(_n, v) => onChangeValue({ ...value, items: (value.items ?? []).map((x, xi) => (xi === i ? v : x)) })}
          onDelete={() => onChangeValue({ ...value, items: (value.items ?? []).filter((_, xi) => xi !== i) })} />
      ))
    : null;

  return (
    <Box>
      {editing ? (
        <Group gap={6} wrap="nowrap" px={4} py={3} align="center">
          <Box style={{ width: CARET_W, flexShrink: 0 }} />
          {keyEditable
            ? <TextInput ref={keyRef} size="xs" w={150} placeholder="field name" value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.currentTarget.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }} />
            : <Text size="sm" ff="monospace" c={KEY_COLOR} w={36}>{keyName}</Text>}
          <Select size="xs" w={140} allowDeselect={false} data={valueTypeOptions} value={draft.value.type}
            onChange={(v) => setDraft((d) => ({ ...d, value: defaultValue((v as ValueType) ?? "string") }))} />
          <ValueInput value={draft.value} onChange={(v) => setDraft((d) => ({ ...d, value: v }))} onEnter={commit} />
          <ActionIcon size="sm" variant="subtle" color="green" aria-label="Confirm" onClick={commit}><IconCheck size={15} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Cancel" onClick={cancel}><IconX size={15} /></ActionIcon>
        </Group>
      ) : (
        <Box
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px", borderRadius: 4, background: hovered ? "#f8f9fa" : undefined }}>
          {complex
            ? <Caret open={expanded} onToggle={() => setExpanded((o) => !o)} />
            : <Box style={{ width: CARET_W, flexShrink: 0 }} />}
          <Box onClick={readOnly ? undefined : beginEdit}
            style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, cursor: readOnly ? "default" : "pointer" }}>
            <Text size="sm" ff="monospace" fw={500} c={KEY_COLOR} style={{ flexShrink: 0 }}>
              {keyName || <Text span c="dimmed">(empty)</Text>}
            </Text>
            {!complex && (
              <>
                <Text size="sm" c="#5f6368" style={{ flexShrink: 0 }}>:</Text>
                <Text size="sm" ff="monospace" c={VALUE_COLOR} truncate style={{ minWidth: 0 }}>{valuePreview(value)}</Text>
              </>
            )}
            <Text size="xs" c={TYPE_COLOR} style={{ flexShrink: 0 }}>({value.type})</Text>
          </Box>
          {!readOnly && (
            <Group gap={2} wrap="nowrap"
              style={{ opacity: hovered ? 1 : 0, transition: "opacity 100ms", pointerEvents: hovered ? "auto" : "none" }}>
              {complex && <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Add child" onClick={addChild}><IconPlus size={14} /></ActionIcon>}
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Edit field" onClick={beginEdit}><IconPencil size={14} /></ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="red" aria-label="Delete field" onClick={onDelete}><IconTrash size={14} /></ActionIcon>
            </Group>
          )}
        </Box>
      )}

      {complex && (
        <Collapse in={expanded}>
          <Box ml={8} pl={12} style={{ borderLeft: "1px solid #e8eaed" }}>
            {childNodes}
            {!readOnly && (
              <Box role="button" onClick={addChild} style={{ cursor: "pointer", padding: "3px 4px" }}>
                <Group gap={4} c="#1a73e8" wrap="nowrap">
                  <IconPlus size={13} /><Text size="xs">Add {value.type === "array" ? "item" : "field"}</Text>
                </Group>
              </Box>
            )}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

export function FieldsEditor({ entries, onChange, readOnly }: { entries: FieldEntry[]; onChange: (e: FieldEntry[]) => void; readOnly?: boolean }) {
  const [autoIndex, setAutoIndex] = useState<number | null>(null);

  const addField = () => {
    const at = entries.length;
    onChange([...entries, { name: "", value: defaultValue("string") }]);
    setAutoIndex(at);
  };

  return (
    <Stack gap={1}>
      {entries.length === 0 && <Text size="xs" c="dimmed">No fields.</Text>}
      {entries.map((e, i) => (
        <FieldNode
          key={i} keyName={e.name} keyEditable value={e.value} readOnly={readOnly}
          autoEdit={i === autoIndex} isNew={i === autoIndex}
          onChangeValue={(v) => onChange(entries.map((x, xi) => (xi === i ? { ...x, value: v } : x)))}
          onCommit={(name, v) => onChange(entries.map((x, xi) => (xi === i ? { name, value: v } : x)))}
          onDelete={() => onChange(entries.filter((_, xi) => xi !== i))} />
      ))}
      {!readOnly && (
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content" mt={6} onClick={addField}>
          Add field
        </Button>
      )}
    </Stack>
  );
}
