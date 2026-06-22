// Renders a Winche/Firestore tagged value (e.g. { stringValue: "Alice" }) to a display string + type.
export interface DisplayValue {
  text: string;
  type: string;
}

export function formatValue(v: unknown): DisplayValue {
  if (v === null || v === undefined) return { text: "null", type: "null" };
  if (typeof v !== "object") return { text: String(v), type: typeof v };

  const o = v as Record<string, unknown>;
  if ("stringValue" in o) return { text: `"${o.stringValue}"`, type: "string" };
  if ("integerValue" in o) return { text: String(o.integerValue), type: "number" };
  if ("doubleValue" in o) return { text: String(o.doubleValue), type: "number" };
  if ("booleanValue" in o) return { text: String(o.booleanValue), type: "boolean" };
  if ("timestampValue" in o) return { text: String(o.timestampValue), type: "timestamp" };
  if ("nullValue" in o) return { text: "null", type: "null" };
  if ("bytesValue" in o) return { text: "<bytes>", type: "bytes" };
  if ("referenceValue" in o) return { text: String(o.referenceValue), type: "reference" };
  if ("geoPointValue" in o) {
    const g = o.geoPointValue as { latitude?: number; longitude?: number };
    return { text: `[${g.latitude}, ${g.longitude}]`, type: "geopoint" };
  }
  if ("arrayValue" in o) {
    const arr = (o.arrayValue as { values?: unknown[] })?.values ?? [];
    return { text: `[${arr.length} item${arr.length === 1 ? "" : "s"}]`, type: "array" };
  }
  if ("mapValue" in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> })?.fields ?? {};
    return { text: `{${Object.keys(f).length} field${Object.keys(f).length === 1 ? "" : "s"}}`, type: "map" };
  }
  return { text: JSON.stringify(v), type: "object" };
}
