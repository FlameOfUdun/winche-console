import type { FieldFilter, LogLevel, LogResource, SavedQuerySpec } from "../../api/logs";

export type RangeKey = "15m" | "1h" | "6h" | "24h" | "7d";
export const RANGES: { value: RangeKey; label: string; ms: number }[] = [
  { value: "15m", label: "Last 15 minutes", ms: 15 * 60_000 },
  { value: "1h", label: "Last hour", ms: 3_600_000 },
  { value: "6h", label: "Last 6 hours", ms: 6 * 3_600_000 },
  { value: "24h", label: "Last 24 hours", ms: 24 * 3_600_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 24 * 3_600_000 },
];

/** What the explorer shows: kept by the Logs page so a saved query can be opened into it. */
export interface ExplorerState {
  resource: LogResource | "";
  /** The lowest level shown ("" = all). */
  level: LogLevel | "";
  filters: FieldFilter[];
  q: string;
  range: RangeKey;
}

export const EMPTY: ExplorerState = { resource: "", level: "", filters: [], q: "", range: "1h" };

export function rangeFrom(range: RangeKey, now = Date.now()): string {
  return new Date(now - (RANGES.find((r) => r.value === range)?.ms ?? 3_600_000)).toISOString();
}

/** Adds a filter, replacing any on the same field with the same value. */
export function withFilter(s: ExplorerState, f: FieldFilter): ExplorerState {
  return { ...s, filters: [...s.filters.filter((x) => !(x.field === f.field && x.value === f.value)), f] };
}

const quote = (v: string) => (/^[\w.@:/-]+$/.test(v) ? v : JSON.stringify(v));

/** The query line: resource = database AND outcome != ok AND severity >= Warning AND "text". */
export function queryText(s: ExplorerState): string {
  const parts: string[] = [];
  if (s.resource) parts.push(`resource = ${s.resource}`);
  for (const f of s.filters) parts.push(`${f.field} ${f.not ? "!=" : "="} ${quote(f.value)}`);
  if (s.level) parts.push(`severity >= ${s.level}`);
  if (s.q.trim()) parts.push(JSON.stringify(s.q.trim()));
  return parts.length ? parts.join(" AND ") : "everything";
}

export function toSpec(s: ExplorerState): SavedQuerySpec {
  return { resource: s.resource || null, minimumLevel: s.level || "Trace", filters: s.filters, search: s.q.trim() || null };
}

export function fromSpec(spec: SavedQuerySpec, range: RangeKey = "24h"): ExplorerState {
  return {
    resource: spec.resource ?? "",
    level: spec.minimumLevel === "Trace" ? "" : spec.minimumLevel,
    filters: spec.filters ?? [],
    q: spec.search ?? "",
    range,
  };
}
