import type { SettingsVersionInfo } from "./appAuth";

/** A settings area as the console reads it. */
export interface AreaSettings<T> {
  settings: T;
  codeDefault: T;
  source: "code" | "console";
  version: SettingsVersionInfo | null;
  editable: boolean;
  whyReadOnly: string | null;
}

export interface IndexSettings {
  collection: string;
  fields: { path: string; direction: "asc" | "desc" }[];
  kind: "ordered" | "array";
  collectionGroup: boolean;
}

export interface DatabaseSettings {
  indexes: IndexSettings[];
  dropUndeclaredIndexes: boolean;
  ttl: { collection: string; field: string }[];
  history: { enabled: boolean; retentionDays: number };
  writeLimits: { maxDocumentKb: number; maxDepth: number };
  slowQueryMs: number | null;
  requestLog: { enabled: boolean; sampleRate: number; slowMs: number };
}

export interface StorageSettings {
  maxFileSizeMb: number | null;
  requestLog: { enabled: boolean; sampleRate: number; slowMs: number };
  orphanSweep: { enabled: boolean; intervalHours: number; graceHours: number; prefix: string | null };
}

export interface IndexSuggestion extends IndexSettings {
  elapsedMs: number;
  at: string;
  code: string;
}

/** "ward, startedAt desc" ⇄ fields. */
export function parseFields(text: string): IndexSettings["fields"] {
  return text.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [path, dir] = s.split(/\s+/);
    return { path, direction: dir?.toLowerCase() === "desc" ? "desc" : "asc" };
  });
}

export const fieldsText = (fields: IndexSettings["fields"]) =>
  fields.map((f) => (f.direction === "desc" ? `${f.path} desc` : f.path)).join(", ");

export const sameIndex = (a: IndexSettings, b: IndexSettings) =>
  a.collection === b.collection && a.kind === b.kind && a.collectionGroup === b.collectionGroup && fieldsText(a.fields) === fieldsText(b.fields);
