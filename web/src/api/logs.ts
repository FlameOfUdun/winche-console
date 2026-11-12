export type LogScope = "app" | "database" | "storage";
export type LogLevel = "Trace" | "Debug" | "Information" | "Warning" | "Error" | "Critical";

export interface LogEntry {
  id: number;
  at: string;
  level: LogLevel;
  category: string;
  eventId: number;
  message: string;
  exception: string | null;
  userId: string | null;
  instance: string;
  properties: Record<string, string | null> | null;
  /** database, storage, console or app. */
  resource: LogResource;
  /** Request entries (LogRequests): database.get, storage.upload, … */
  operation: string | null;
  /** Who: the app user, or for other entries the signed-in user if any. */
  principal: string | null;
  path: string | null;
  /** ok, denied, notFound, invalid, … */
  outcome: string | null;
  latencyMs: number | null;
}

export type LogResource = "database" | "storage" | "console" | "app";
export const FILTER_FIELDS = ["resource", "operation", "principal", "path", "outcome", "category", "instance", "user"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

/** principal = u2, or (not) outcome ≠ ok. */
export interface FieldFilter { field: FilterField; value: string; not?: boolean }

export interface Histogram {
  from: string;
  to: string;
  total: number;
  buckets: { start: string; info: number; warning: number; error: number }[];
}

/** What a saved query selects. */
export interface SavedQuerySpec { resource: LogResource | null; minimumLevel: LogLevel; filters: FieldFilter[]; search: string | null }

export interface SavedQuery {
  id: string;
  name: string;
  query: SavedQuerySpec;
  /** Null for the built-in ones (which can't be deleted). */
  createdBy: string | null;
  createdAt: string | null;
}

export interface LogPage {
  entries: LogEntry[];
  /** The lowest level the app keeps (entries below it never reach the console). */
  minimumLevel: LogLevel;
  retentionDays: number;
}

export interface LogLevelOverride { category: string; level: LogLevel; until: string | null }

export interface LogLevels {
  defaultLevel: LogLevel;
  overrides: LogLevelOverride[];
  /** "code": the app's own settings; "console": saved here by an Admin (applies on every instance). */
  source: "code" | "console";
  updatedAt: string | null;
  updatedBy: string | null;
  codeDefaultLevel: LogLevel;
}

export interface LogFilter {
  level?: LogLevel | "";
  category?: string;
  q?: string;
  resource?: LogResource | "";
  filters?: FieldFilter[];
  from?: string;
  to?: string;
  buckets?: number;
  before?: number;
  after?: number;
  limit?: number;
}

export function logQuery(filter: LogFilter): string {
  const p = new URLSearchParams();
  if (filter.level) p.set("level", filter.level);
  if (filter.category) p.set("category", filter.category);
  if (filter.q) p.set("q", filter.q);
  if (filter.resource) p.set("resource", filter.resource);
  for (const f of filter.filters ?? []) p.append("f", `${f.field}${f.not ? "!" : ""}:${f.value}`);
  if (filter.from) p.set("from", filter.from);
  if (filter.to) p.set("to", filter.to);
  if (filter.buckets !== undefined) p.set("buckets", String(filter.buckets));
  if (filter.before !== undefined) p.set("before", String(filter.before));
  if (filter.after !== undefined) p.set("after", String(filter.after));
  if (filter.limit !== undefined) p.set("limit", String(filter.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}
