import type { DatabaseSettings, IndexSettings } from "./dataSettings";

export interface IndexTextError { message: string; line: number; column: number; offset: number }
export interface IndexTextParse { ok: boolean; indexes: IndexSettings[] | null; ttl: DatabaseSettings["ttl"] | null; error: IndexTextError | null }

const quote = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `\`${s}\``);

/** The text for indexes and expiry rules, as the server writes it (Indexes.IndexText.Format). */
export function formatIndexText(indexes: IndexSettings[], ttl: DatabaseSettings["ttl"]): string {
  const blocks: { collection: string; group: boolean }[] = [];
  const add = (collection: string, group: boolean) => {
    if (!blocks.some((b) => b.collection === collection && b.group === group)) blocks.push({ collection, group });
  };
  indexes.forEach((i) => add(i.collection, i.collectionGroup));
  ttl.forEach((t) => add(t.collection, false));
  return blocks.map(({ collection, group }) => {
    const lines = [`collection ${group ? "group " : ""}${quote(collection)} {`];
    for (const i of indexes.filter((x) => x.collection === collection && x.collectionGroup === group))
      lines.push(`  index (${i.kind === "array" ? `${i.fields[0]?.path} contains` : i.fields.map((f) => (f.direction === "desc" ? `${f.path} desc` : f.path)).join(", ")})`);
    if (!group) for (const t of ttl.filter((x) => x.collection === collection)) lines.push(`  expire when ${t.field}`);
    lines.push("}");
    return lines.join("\n") + "\n";
  }).join("\n");
}

/** One index as a line, for inserting a suggestion. */
export function indexLine(i: IndexSettings): string {
  return `index (${i.kind === "array" ? `${i.fields[0]?.path} contains` : i.fields.map((f) => (f.direction === "desc" ? `${f.path} desc` : f.path)).join(", ")})`;
}

/** [text] with [line] added to the block for [collection] (a new block at the end when there's none). */
export function addToBlock(text: string, collection: string, group: boolean, line: string): string {
  const header = new RegExp(`^collection\\s+${group ? "group\\s+" : ""}${quote(collection).replace(/[.*+?^${}()|[\]\\`]/g, "\\$&")}\\s*\\{`, "m");
  const m = header.exec(text);
  if (m) {
    const close = text.indexOf("}", m.index + m[0].length);
    if (close >= 0) return `${text.slice(0, close)}  ${line}\n${text.slice(close)}`;
  }
  const sep = text.trim() ? (text.endsWith("\n") ? "\n" : "\n\n") : "";
  return `${text}${sep}collection ${group ? "group " : ""}${quote(collection)} {\n  ${line}\n}\n`;
}
