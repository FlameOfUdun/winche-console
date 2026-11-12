// Suggestions for the rules file (Winche.Rules' text syntax). Pure: given the text, the cursor and the
// fields of the documents a match pattern covers, says what fits at the cursor. The editor wires it into
// CodeMirror (RulesCodeEditor).

import type { RuleSubsystem } from "../../api/rules";

export interface FieldInfo { path: string; types: string[] }

export interface Suggestion {
  label: string;
  /** What's inserted (defaults to label). `()` places the cursor between the parentheses. */
  insert?: string;
  type: "keyword" | "variable" | "property" | "method" | "function" | "type";
  detail?: string;
  info?: string;
}

/** Where the cursor is, and what the text before it says. */
export interface CursorContext {
  /** The full patterns of the match blocks around the cursor, outermost first. */
  patterns: string[];
  /** Path captures in scope ({uid}, {rest=**}). */
  captures: string[];
  where: "top" | "block" | "function" | "operations" | "beforeIf" | "condition";
  /** In a condition, the dotted expression before a trailing '.', e.g. "request.resource.data" (null when no dot). */
  receiver: string | null;
  /** The word being typed (replaced by the suggestion). */
  word: string;
  /** Offset where `word` starts. */
  from: number;
  /** Right after `is `. */
  afterIs: boolean;
}

const OPERATIONS: Suggestion[] = [
  { label: "read", type: "keyword", detail: "get + list" },
  { label: "write", type: "keyword", detail: "create + update + delete" },
  { label: "get", type: "keyword", detail: "read one document" },
  { label: "list", type: "keyword", detail: "query a collection" },
  { label: "create", type: "keyword", detail: "write a new document" },
  { label: "update", type: "keyword", detail: "change a document" },
  { label: "delete", type: "keyword", detail: "remove a document" },
];

const METHODS: Suggestion[] = [
  { label: "keys", insert: "keys()", type: "method", detail: "map → list", info: "The map's keys, e.g. request.resource.data.keys().hasOnly(['name'])" },
  { label: "hasOnly", insert: "hasOnly([])", type: "method", detail: "list → bool", info: "Every element is one of the listed values" },
  { label: "hasAll", insert: "hasAll([])", type: "method", detail: "list → bool", info: "Contains every listed value" },
  { label: "hasAny", insert: "hasAny([])", type: "method", detail: "list → bool", info: "Contains at least one listed value" },
  { label: "diff", insert: "diff()", type: "method", detail: "map → diff", info: "How this map differs from another: request.resource.data.diff(resource.data)" },
  { label: "affectedKeys", insert: "affectedKeys()", type: "method", detail: "diff → list", info: "Keys added, removed or changed" },
  { label: "addedKeys", insert: "addedKeys()", type: "method", detail: "diff → list" },
  { label: "removedKeys", insert: "removedKeys()", type: "method", detail: "diff → list" },
  { label: "changedKeys", insert: "changedKeys()", type: "method", detail: "diff → list" },
  { label: "unchangedKeys", insert: "unchangedKeys()", type: "method", detail: "diff → list" },
  { label: "size", insert: "size()", type: "method", detail: "string/list/map → int", info: "Length" },
  { label: "matches", insert: "matches('')", type: "method", detail: "string → bool", info: "The whole string matches the regex" },
  { label: "lower", insert: "lower()", type: "method", detail: "string → string" },
  { label: "upper", insert: "upper()", type: "method", detail: "string → string" },
  { label: "get", insert: "get('', null)", type: "method", detail: "map → value", info: "The value at a key, or a default when it's missing" },
];

const GLOBALS: Suggestion[] = [
  { label: "request", type: "variable", detail: "the request", info: "request.auth, request.resource, request.time, request.method" },
  { label: "resource", type: "variable", detail: "the existing document", info: "Its fields (resource.name or resource.data.name) and id, path, version…" },
  { label: "exists", insert: "exists()", type: "function", detail: "path → bool", info: "Whether a document exists: exists(/projects/$(projectId)/members/$(request.auth.uid))" },
  { label: "get", insert: "get()", type: "function", detail: "path → document", info: "Read another document: get(/users/$(request.auth.uid)).role — each $( ) is one path segment" },
  { label: "size", insert: "size()", type: "function", detail: "string/list/map → int" },
  { label: "timestamp", insert: "timestamp('')", type: "function", detail: "ISO-8601 → timestamp" },
  { label: "path", insert: "path('')", type: "function", detail: "parts → path", info: "path('users', uid) — a path from its parts; the same as /users/$(uid)" },
  { label: "true", type: "keyword" },
  { label: "false", type: "keyword" },
  { label: "null", type: "keyword" },
];

/** The word operators (readable forms: each is shorthand for a method chain). */
export const OPERATORS: Suggestion[] = [
  { label: "in", insert: "in ", type: "keyword", detail: "membership", info: "`x in list` — the list contains x; `key in map` — the map has that key" },
  { label: "not in", insert: "not in ", type: "keyword", detail: "not a member", info: "`x not in list` — the same as `!(x in list)`" },
  { label: "is", insert: "is ", type: "keyword", detail: "type check", info: "`x is string` (string int float number bool null map list timestamp bytes path)" },
  { label: "has only", insert: "has only []", type: "keyword", detail: "map → bool", info: "`request.resource.data has only ['name', 'email']` — the map has no keys but these (same as `.keys().hasOnly([...])`)" },
  { label: "has all", insert: "has all []", type: "keyword", detail: "map → bool", info: "`m has all ['name']` — the map has every one of these keys (`.keys().hasAll([...])`)" },
  { label: "has any", insert: "has any []", type: "keyword", detail: "map → bool", info: "`request.auth.token has any ['admin']` — the map has at least one of these keys (`.keys().hasAny([...])`)" },
  { label: "changes only", insert: "changes only []", type: "keyword", detail: "update → bool", info: "`changes only ['name']` — the update changes no fields but these (`request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`)" },
  { label: "changes any", insert: "changes any []", type: "keyword", detail: "update → bool", info: "`changes any ['role', 'ownerId']` — the update changes at least one of these fields (`….affectedKeys().hasAny([...])`)" },
  { label: "changes all", insert: "changes all []", type: "keyword", detail: "update → bool", info: "`changes all ['a', 'b']` — the update changes every one of these fields (`….affectedKeys().hasAll([...])`)" },
];

const TYPES = ["string", "int", "float", "number", "bool", "null", "map", "list", "timestamp", "bytes", "path"]
  .map((t): Suggestion => ({ label: t, type: "type" }));

const DOCUMENT_COLUMNS: Suggestion[] = [
  { label: "data", type: "property", detail: "the fields alone", info: "For keys() / diff(): request.resource.data.keys(). In list (query) rules write resource.x instead — a query can't prove resource.data." },
  { label: "id", type: "property", detail: "string" },
  { label: "path", type: "property", detail: "path" },
  { label: "collection", type: "property", detail: "string" },
  { label: "createdAt", type: "property", detail: "timestamp" },
  { label: "updatedAt", type: "property", detail: "timestamp" },
  { label: "version", type: "property", detail: "int" },
];

const REQUEST: Suggestion[] = [
  { label: "auth", type: "property", detail: "the caller's claims", info: "null when signed out" },
  { label: "resource", type: "property", detail: "the document after the write", info: "null for reads and deletes" },
  { label: "time", type: "property", detail: "timestamp" },
  { label: "method", type: "property", detail: "string", info: "get, list, create, update or delete" },
];

const AUTH: Suggestion[] = [
  { label: "uid", type: "property", detail: "string" },
  { label: "token", type: "property", detail: "map", info: "The token's claims: token.sub, token.email…" },
];

const TOKEN: Suggestion[] = ["sub", "email", "email_verified", "name", "preferred_username"]
  .map((c): Suggestion => ({ label: c, type: "property" }));

// ── reading the text before the cursor ────────────────────────────────────────

/** Replaces strings and // comments with spaces (same length), so scanning sees only code. */
function blank(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out += " "; i++; }
    } else if (c === "'" || c === '"' || c === "`") {
      out += c; i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        out += " ";
        i += text[i] === "\\" && c !== "`" ? 2 : 1;
        if (i > text.length) break;
      }
      if (i < text.length && text[i] === c) { out += c; i++; }
    } else {
      out += c; i++;
    }
  }
  return out.slice(0, text.length);
}

function join(parent: string | undefined, path: string): string {
  if (!parent) return path.replace(/^\/+/, "");
  return `${parent.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** The functions a rules file defines: `function name(a, b) {` anywhere in it. */
export function definedFunctions(text: string): { name: string; params: string[] }[] {
  const out: { name: string; params: string[] }[] = [];
  for (const m of blank(text).matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g))
    out.push({ name: m[1], params: m[2].split(",").map((p) => p.trim()).filter(Boolean) });
  return out;
}

/** Marks a function body on the block stack (not a match path). */
const FUNCTION_BODY = "\u0000function";

export function analyze(text: string, pos: number): CursorContext {
  const before = blank(text.slice(0, pos));
  // Block structure: match <path> { … } nests patterns; other braces (maps) just nest.
  const stack: (string | null)[] = [];
  let statementStart = 0;
  let i = 0;
  while (i < before.length) {
    // Greedy: "users/{uid} {" is the path "users/{uid}" then the block's "{" (and "users/{uid}{" too).
    const m = /^match\s+(\S+)\s*\{/.exec(before.slice(i));
    if (m && (i === 0 || !/[\w.]/.test(before[i - 1]))) {
      const path = m[1];
      const parent = [...stack].reverse().find((p): p is string => p !== null && p !== FUNCTION_BODY);
      stack.push(join(parent, path));
      i += m[0].length;
      statementStart = i;
      continue;
    }
    const fn = /^function\s+[A-Za-z_]\w*\s*\([^)]*\)\s*\{/.exec(before.slice(i));
    if (fn && (i === 0 || !/[\w.]/.test(before[i - 1]))) {
      stack.push(FUNCTION_BODY);
      i += fn[0].length;
      statementStart = i;
      continue;
    }
    const c = before[i];
    if (c === "{") stack.push(null);
    else if (c === "}") { stack.pop(); statementStart = i + 1; }
    else if (c === ";") statementStart = i + 1;
    i++;
  }
  const patterns = stack.filter((p): p is string => p !== null && p !== FUNCTION_BODY);
  const captures = [...new Set(patterns.flatMap((p) => [...p.matchAll(/\{([A-Za-z_]\w*)(?:=\*\*)?\}/g)].map((x) => x[1])))];

  const statement = before.slice(statementStart);
  const wordMatch = /[A-Za-z_]\w*$/.exec(before);
  const word = wordMatch ? wordMatch[0] : "";
  const from = pos - word.length;

  let where: CursorContext["where"];
  if (stack.length === 0) where = "top";
  else if (/\bif\b/.test(statement) || /\breturn\b/.test(statement) || /\blet\s+\w+\s*=/.test(statement)) where = "condition";
  else if (stack[stack.length - 1] === FUNCTION_BODY) where = "function";
  else if (/^\s*allow\b/.test(statement) && statement.includes(":")) where = "beforeIf";
  else if (/^\s*allow\b/.test(statement)) where = /^\s*allow\s+\w*$/.test(statement) || /,\s*\w*$/.test(statement) ? "operations" : "block";
  else where = "block";

  let receiver: string | null = null;
  if (where === "condition") {
    const chain = /([A-Za-z_]\w*(?:\([^()]*\))?(?:\.[A-Za-z_]\w*(?:\([^()]*\))?)*)\.\w*$/.exec(before);
    if (chain) receiver = chain[1];
  }
  const afterIs = where === "condition" && /\bis\s+\w*$/.test(before);
  return { patterns, captures, where, receiver, word, from, afterIs };
}

// ── what fits ─────────────────────────────────────────────────────────────

/** Strips call parentheses: "request.resource.data.diff(x)" → ["request","resource","data","diff()"]. */
function parts(receiver: string): string[] {
  return receiver.split(".").map((p) => (p.includes("(") ? p.slice(0, p.indexOf("(")) + "()" : p));
}

/** The document fields directly under `prefix` ("" = top level), from the sampled dotted paths. */
function fieldsUnder(fields: FieldInfo[], prefix: string): Suggestion[] {
  const out = new Map<string, Suggestion>();
  for (const f of fields) {
    if (prefix && !f.path.startsWith(prefix + ".")) continue;
    const rest = prefix ? f.path.slice(prefix.length + 1) : f.path;
    if (!rest || rest.includes(".")) continue;
    out.set(rest, { label: rest, type: "property", detail: f.types.join(" | "), info: "A field of the documents this match covers (sampled)" });
  }
  return [...out.values()];
}

/**
 * Suggestions at the cursor. `fields` are those of the documents the innermost match covers (empty when
 * unknown), `subsystem` picks the shape of `resource`.
 */
const FUNCTION_KEYWORD: Suggestion = {
  label: "function", insert: "function ", type: "keyword", detail: "define a function",
  info: "function isOwner(uid) { return request.auth.uid == uid; } — call it from any condition where it's visible",
};

export function suggest(ctx: CursorContext, fields: FieldInfo[], subsystem: RuleSubsystem, functions: { name: string; params: string[] }[] = []): Suggestion[] {
  if (ctx.where === "top") return [{ label: "match", insert: "match ", type: "keyword", info: "match users/{uid} { … }" }, FUNCTION_KEYWORD];
  if (ctx.where === "block") {
    return [
      { label: "allow", insert: "allow ", type: "keyword", info: "allow read: if …;" },
      { label: "match", insert: "match ", type: "keyword", info: "A nested match extends this path" },
      FUNCTION_KEYWORD,
    ];
  }
  if (ctx.where === "function") {
    return [
      { label: "let", insert: "let ", type: "keyword", detail: "a named value", info: "let name = value; — usable in the lines after it" },
      { label: "return", insert: "return ", type: "keyword", detail: "the result", info: "return condition; — what the function gives (the last line)" },
    ];
  }
  if (ctx.where === "operations") return OPERATIONS;
  if (ctx.where === "beforeIf") return [{ label: "if", insert: "if ", type: "keyword" }];
  if (ctx.afterIs) return TYPES;

  if (ctx.receiver === null) {
    const captures = ctx.captures.map((c): Suggestion => ({ label: c, type: "variable", detail: "path capture" }));
    const own = functions.map((f): Suggestion => ({
      label: f.name, insert: `${f.name}()`, type: "function", detail: `(${f.params.join(", ")})`, info: "A function defined in this file",
    }));
    return [...captures, ...own, ...GLOBALS, ...OPERATORS];
  }

  const p = parts(ctx.receiver);
  const last = p[p.length - 1];
  if (last.endsWith("()")) return METHODS;   // a call's result: only methods

  // request…, resource…
  const isRequest = p[0] === "request";
  const doc = isRequest ? (p[1] === "resource" ? p.slice(2) : null) : p[0] === "resource" ? p.slice(1) : null;
  if (isRequest && p.length === 1) return REQUEST;
  if (isRequest && p[1] === "auth") {
    if (p.length === 2) return AUTH;
    if (p[2] === "token" && p.length === 3) return [...TOKEN, ...METHODS];
    return METHODS;
  }
  if (doc !== null) {
    if (subsystem === "storage") {
      if (doc.length === 0) return [...fieldsUnder(fields, ""), ...METHODS];
      return [...fieldsUnder(fields, doc.join(".")), ...METHODS];
    }
    if (doc.length === 0) return [...DOCUMENT_COLUMNS, ...fieldsUnder(fields, ""), ...METHODS];
    const path = doc[0] === "data" ? doc.slice(1) : doc;     // resource.data.x and resource.x are the same field
    return [...fieldsUnder(fields, path.join(".")), ...METHODS];
  }
  return METHODS;
}
