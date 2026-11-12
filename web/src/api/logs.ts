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
}

export interface LogPage {
  entries: LogEntry[];
  /** The lowest level the app keeps (entries below it never reach the console). */
  minimumLevel: LogLevel;
  retentionDays: number;
}

export interface LogFilter {
  level?: LogLevel | "";
  category?: string;
  q?: string;
  before?: number;
  after?: number;
  limit?: number;
}

export function logQuery(filter: LogFilter): string {
  const p = new URLSearchParams();
  if (filter.level) p.set("level", filter.level);
  if (filter.category) p.set("category", filter.category);
  if (filter.q) p.set("q", filter.q);
  if (filter.before !== undefined) p.set("before", String(filter.before));
  if (filter.after !== undefined) p.set("after", String(filter.after));
  if (filter.limit !== undefined) p.set("limit", String(filter.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}
