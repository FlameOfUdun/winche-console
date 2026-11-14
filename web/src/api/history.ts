export type ChangeType = "added" | "modified" | "removed";

export interface FieldChangeDto {
  field: string;
  kind: "added" | "changed" | "removed";
  before: unknown;
  after: unknown;
}

export interface HistoryEntry {
  seq: number;
  type: ChangeType;
  path: string;
  version: number;
  at: string;
  /** "u1" (an app user), "console:admin@…" (the console), or null (a hook or background job). */
  actor: string | null;
  /** False when the change predates history being turned on: then `fields` is null. */
  recorded: boolean;
  fields: FieldChangeDto[] | null;
}

export interface HistoryFilter {
  path?: string;
  under?: string;
  actor?: string;
  before?: number;
  limit?: number;
}

export function historyQuery(f: HistoryFilter): string {
  const p = new URLSearchParams();
  if (f.path) p.set("path", f.path);
  if (f.under) p.set("under", f.under);
  if (f.actor) p.set("actor", f.actor);
  if (f.before !== undefined) p.set("before", String(f.before));
  if (f.limit !== undefined) p.set("limit", String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A tagged value as compact readable text: strings quoted, maps and lists in full. */
export function valueText(v: unknown): string {
  return JSON.stringify(plain(v)) ?? "null";
}

function plain(v: unknown): unknown {
  if (v === null || v === undefined || typeof v !== "object") return v ?? null;
  const o = v as Record<string, unknown>;
  if ("stringValue" in o) return o.stringValue;
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return o.doubleValue;
  if ("booleanValue" in o) return o.booleanValue;
  if ("nullValue" in o) return null;
  if ("timestampValue" in o) return o.timestampValue;
  if ("docRefValue" in o) return o.docRefValue;
  if ("fileRefValue" in o) return o.fileRefValue;
  if ("userRefValue" in o) return o.userRefValue;
  if ("bytesValue" in o) return "<bytes>";
  if ("geoPointValue" in o) return o.geoPointValue;
  if ("arrayValue" in o) return ((o.arrayValue as { values?: unknown[] })?.values ?? []).map(plain);
  if ("mapValue" in o) {
    const f = (o.mapValue as { fields?: Record<string, unknown> })?.fields ?? {};
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, plain(x)]));
  }
  return o;
}
