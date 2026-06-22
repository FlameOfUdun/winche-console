import { ActionIcon, Box, Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { type EditValue, type FieldEntry, type ValueType, defaultValue, valueTypeOptions } from "./fields";

/** Editor for a single value (recurses for array items and map entries). Read-only hides all edit controls. */
function ValueEditor({ value, onChange, readOnly }: { value: EditValue; onChange: (v: EditValue) => void; readOnly?: boolean }) {
  const typeSelect = (
    <Select
      size="xs" w={150} allowDeselect={false} data={valueTypeOptions} value={value.type} disabled={readOnly}
      onChange={(v) => onChange(defaultValue((v as ValueType) ?? "string"))}
    />
  );

  const scalar = (props: { placeholder?: string; inputMode?: "decimal" }) => (
    <TextInput
      size="xs" style={{ flex: 1 }} placeholder={props.placeholder} inputMode={props.inputMode} readOnly={readOnly}
      value={value.text ?? ""} onChange={(e) => onChange({ ...value, text: e.currentTarget.value })}
    />
  );

  switch (value.type) {
    case "boolean":
      return (
        <Group gap={6} style={{ flex: 1 }} wrap="nowrap">
          {typeSelect}
          <Select size="xs" w={120} allowDeselect={false} disabled={readOnly}
            data={[{ value: "true", label: "true" }, { value: "false", label: "false" }]}
            value={value.bool ? "true" : "false"} onChange={(v) => onChange({ ...value, bool: v === "true" })} />
        </Group>
      );
    case "geopoint":
      return (
        <Group gap={6} style={{ flex: 1 }} wrap="nowrap">
          {typeSelect}
          <TextInput size="xs" w={110} placeholder="latitude" readOnly={readOnly} value={value.lat ?? ""} onChange={(e) => onChange({ ...value, lat: e.currentTarget.value })} />
          <TextInput size="xs" w={110} placeholder="longitude" readOnly={readOnly} value={value.lng ?? ""} onChange={(e) => onChange({ ...value, lng: e.currentTarget.value })} />
        </Group>
      );
    case "null":
      return <Group gap={6} style={{ flex: 1 }} wrap="nowrap">{typeSelect}<Text size="xs" c="dimmed">null</Text></Group>;
    case "array":
      return (
        <Stack gap={6} style={{ flex: 1 }}>
          <Group gap={6}>{typeSelect}<Text size="xs" c="dimmed">{(value.items ?? []).length} item(s)</Text></Group>
          <Box pl="md" style={{ borderLeft: "2px solid #e0e0e0" }}>
            <Stack gap={6}>
              {(value.items ?? []).map((it, i) => (
                <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                  <ValueEditor value={it} readOnly={readOnly} onChange={(nv) => onChange({ ...value, items: (value.items ?? []).map((x, xi) => (xi === i ? nv : x)) })} />
                  {!readOnly && (
                    <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove item"
                      onClick={() => onChange({ ...value, items: (value.items ?? []).filter((_, xi) => xi !== i) })}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
              {!readOnly && (
                <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} w="fit-content"
                  onClick={() => onChange({ ...value, items: [...(value.items ?? []), defaultValue("string")] })}>
                  Add item
                </Button>
              )}
            </Stack>
          </Box>
        </Stack>
      );
    case "map":
      return (
        <Stack gap={6} style={{ flex: 1 }}>
          <Group gap={6}>{typeSelect}<Text size="xs" c="dimmed">{(value.entries ?? []).length} field(s)</Text></Group>
          <Box pl="md" style={{ borderLeft: "2px solid #e0e0e0" }}>
            <Stack gap={6}>
              {(value.entries ?? []).map((en, i) => (
                <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                  <TextInput size="xs" w={140} placeholder="key" readOnly={readOnly} value={en.name}
                    onChange={(e) => onChange({ ...value, entries: (value.entries ?? []).map((x, xi) => (xi === i ? { ...x, name: e.currentTarget.value } : x)) })} />
                  <ValueEditor value={en.value} readOnly={readOnly} onChange={(nv) => onChange({ ...value, entries: (value.entries ?? []).map((x, xi) => (xi === i ? { ...x, value: nv } : x)) })} />
                  {!readOnly && (
                    <ActionIcon variant="subtle" color="red" size="sm" aria-label="Remove map field"
                      onClick={() => onChange({ ...value, entries: (value.entries ?? []).filter((_, xi) => xi !== i) })}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
              {!readOnly && (
                <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} w="fit-content"
                  onClick={() => onChange({ ...value, entries: [...(value.entries ?? []), { name: "", value: defaultValue("string") }] })}>
                  Add field
                </Button>
              )}
            </Stack>
          </Box>
        </Stack>
      );
    default: // string / integer / double / timestamp / reference
      return (
        <Group gap={6} style={{ flex: 1 }} wrap="nowrap">
          {typeSelect}
          {scalar({
            placeholder: value.type === "reference" ? "users/alice" : value.type === "timestamp" ? "2026-01-01T00:00:00Z" : "value",
            inputMode: value.type === "integer" || value.type === "double" ? "decimal" : undefined,
          })}
        </Group>
      );
  }
}

export function FieldsEditor({ entries, onChange, readOnly }: { entries: FieldEntry[]; onChange: (e: FieldEntry[]) => void; readOnly?: boolean }) {
  const set = (i: number, patch: Partial<FieldEntry>) => onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  return (
    <Stack gap={8}>
      {entries.length === 0 && <Text size="xs" c="dimmed">No fields.</Text>}
      {entries.map((e, i) => (
        <Group key={i} gap={6} wrap="nowrap" align="flex-start">
          <TextInput size="xs" w={150} placeholder="field name" readOnly={readOnly} value={e.name} onChange={(ev) => set(i, { name: ev.currentTarget.value })} />
          <ValueEditor value={e.value} readOnly={readOnly} onChange={(v) => set(i, { value: v })} />
          {!readOnly && (
            <ActionIcon variant="subtle" color="red" aria-label="Remove field" onClick={() => onChange(entries.filter((_, idx) => idx !== i))}>
              <IconTrash size={16} />
            </ActionIcon>
          )}
        </Group>
      ))}
      {!readOnly && (
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content"
          onClick={() => onChange([...entries, { name: "", value: defaultValue("string") }])}>
          Add field
        </Button>
      )}
    </Stack>
  );
}
