// Recursive, GUI-friendly model for document fields. Round-trips tagged wire values
// (incl. nested array/map) to/from an editable tree — no JSON entry required.

export type ValueType =
  | "string" | "integer" | "double" | "boolean" | "timestamp" | "reference" | "geopoint" | "null" | "array" | "map";

export interface EditValue {
  type: ValueType;
  text?: string;                                   // string/integer/double/timestamp/reference
  bool?: boolean;                                  // boolean
  lat?: string; lng?: string;                      // geopoint
  items?: EditValue[];                             // array
  entries?: { name: string; value: EditValue }[];  // map
}

export interface FieldEntry { name: string; value: EditValue; }

export const valueTypeOptions: { value: ValueType; label: string }[] = [
  { value: "string", label: "string" },
  { value: "integer", label: "number (integer)" },
  { value: "double", label: "number (double)" },
  { value: "boolean", label: "boolean" },
  { value: "timestamp", label: "timestamp" },
  { value: "reference", label: "reference" },
  { value: "geopoint", label: "geopoint" },
  { value: "null", label: "null" },
  { value: "array", label: "array" },
  { value: "map", label: "map" },
];

/** A short, one-line description of a value for the collapsed (preview) state of a field. */
export function summarizeValue(v: EditValue): string {
  switch (v.type) {
    case "array": return `array · ${(v.items ?? []).length} item(s)`;
    case "map": return `map · ${(v.entries ?? []).length} field(s)`;
    case "boolean": return `boolean · ${v.bool ? "true" : "false"}`;
    case "geopoint": return `geopoint · ${v.lat ?? "0"}, ${v.lng ?? "0"}`;
    case "null": return "null";
    default: {
      const t = v.text ?? "";
      const preview = t.length > 48 ? `${t.slice(0, 48)}…` : t;
      return preview ? `${v.type} · ${preview}` : v.type;
    }
  }
}

export function defaultValue(type: ValueType): EditValue {
  switch (type) {
    case "boolean": return { type, bool: false };
    case "geopoint": return { type, lat: "0", lng: "0" };
    case "array": return { type, items: [] };
    case "map": return { type, entries: [] };
    case "null": return { type };
    default: return { type, text: "" };
  }
}

export function parseValue(v: unknown): EditValue {
  const o = (v ?? {}) as Record<string, unknown>;
  if ("stringValue" in o) return { type: "string", text: String(o.stringValue ?? "") };
  if ("integerValue" in o) return { type: "integer", text: String(o.integerValue ?? "0") };
  if ("doubleValue" in o) return { type: "double", text: String(o.doubleValue ?? "0") };
  if ("booleanValue" in o) return { type: "boolean", bool: !!o.booleanValue };
  if ("timestampValue" in o) return { type: "timestamp", text: String(o.timestampValue ?? "") };
  if ("referenceValue" in o) return { type: "reference", text: String(o.referenceValue ?? "") };
  if ("geoPointValue" in o) {
    const g = o.geoPointValue as { latitude?: number; longitude?: number };
    return { type: "geopoint", lat: String(g?.latitude ?? 0), lng: String(g?.longitude ?? 0) };
  }
  if ("nullValue" in o) return { type: "null" };
  if ("arrayValue" in o) {
    const vals = (o.arrayValue as { values?: unknown[] })?.values ?? [];
    return { type: "array", items: vals.map(parseValue) };
  }
  if ("mapValue" in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> })?.fields ?? {};
    return { type: "map", entries: Object.entries(f).map(([name, val]) => ({ name, value: parseValue(val) })) };
  }
  return { type: "string", text: typeof v === "string" ? v : JSON.stringify(v) };
}

export function serializeValue(ev: EditValue): unknown {
  switch (ev.type) {
    case "string": return { stringValue: ev.text ?? "" };
    case "integer": return { integerValue: String(parseInt(ev.text || "0", 10)) };
    case "double": return { doubleValue: Number(ev.text || "0") };
    case "boolean": return { booleanValue: !!ev.bool };
    case "timestamp": return { timestampValue: ev.text ?? "" };
    case "reference": return { referenceValue: ev.text ?? "" };
    case "geopoint": return { geoPointValue: { latitude: Number(ev.lat || "0"), longitude: Number(ev.lng || "0") } };
    case "null": return { nullValue: null };
    case "array": return { arrayValue: { values: (ev.items ?? []).map(serializeValue) } };
    case "map": {
      const fields: Record<string, unknown> = {};
      for (const e of ev.entries ?? []) if (e.name.trim()) fields[e.name] = serializeValue(e.value);
      return { mapValue: { fields } };
    }
  }
}

export function parseFields(fields: Record<string, unknown>): FieldEntry[] {
  return Object.entries(fields ?? {}).map(([name, v]) => ({ name, value: parseValue(v) }));
}

export function serializeFields(entries: FieldEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of entries) if (e.name.trim()) out[e.name] = serializeValue(e.value);
  return out;
}
