import { expect, test } from "vitest";
import { analyze, suggest, type FieldInfo } from "../rulesCompletion";

const FIELDS: FieldInfo[] = [
  { path: "name", types: ["string"] },
  { path: "age", types: ["float", "int"] },
  { path: "address", types: ["map"] },
  { path: "address.city", types: ["string"] },
  { path: "address.geo", types: ["map"] },
  { path: "address.geo.lat", types: ["float"] },
];

/** The text with "|" marking the cursor. */
function at(textWithCursor: string) {
  const pos = textWithCursor.indexOf("|");
  return analyze(textWithCursor.replace("|", ""), pos);
}

const labels = (text: string, subsystem: "database" | "storage" = "database", fields = FIELDS) =>
  suggest(at(text), fields, subsystem).map((s) => s.label);

const RULES = "match users/{uid} {\n  match notes/{noteId} {\n    allow read: if ";

test("knows the match patterns and captures around the cursor", () => {
  const ctx = at(RULES + "|");
  expect(ctx.patterns).toEqual(["users/{uid}", "users/{uid}/notes/{noteId}"]);
  expect(ctx.captures).toEqual(["uid", "noteId"]);
  expect(ctx.where).toBe("condition");
});

test("a closed block is out of scope; braces in paths, strings and comments don't confuse it", () => {
  const ctx = at("match a/{x}{ allow read: if true; }\n// match fake/{y} {\nmatch b/{z=**} {\n  allow get: if '{' == '}' && |");
  expect(ctx.patterns).toEqual(["b/{z=**}"]);
  expect(ctx.captures).toEqual(["z"]);
});

test("statements: match at the top, allow/match in a block, operations, then if", () => {
  expect(labels("|")).toEqual(["match"]);
  expect(labels("match users/{uid} {\n  |")).toEqual(["allow", "match"]);
  expect(labels("match users/{uid} {\n  allow |")).toContain("read");
  expect(labels("match users/{uid} {\n  allow read, cr|")).toContain("create");
  expect(labels("match users/{uid} {\n  allow read: |")).toEqual(["if"]);
  expect(labels("match users/{uid} {\n  allow read: if true;\n  |")).toEqual(["allow", "match"]);
});

test("in a condition: captures, request, resource and functions", () => {
  const l = labels(RULES + "|");
  expect(l.slice(0, 2)).toEqual(["uid", "noteId"]);
  expect(l).toEqual(expect.arrayContaining(["request", "resource", "exists", "true"]));
  expect(at(RULES + "requ|").word).toBe("requ");
});

test("request and auth members", () => {
  expect(labels(RULES + "request.|")).toEqual(["auth", "resource", "time", "method"]);
  expect(labels(RULES + "request.auth.|")).toEqual(["uid", "token"]);
  expect(labels(RULES + "request.auth.token.|")).toContain("sub");
});

test("document fields, from the sampled documents, at every level", () => {
  expect(labels(RULES + "request.resource.data.|")).toEqual(expect.arrayContaining(["name", "age", "address", "keys", "hasOnly"]));
  expect(labels(RULES + "resource.data.address.|")).toEqual(expect.arrayContaining(["city", "geo"]));
  expect(labels(RULES + "resource.data.address.|")).not.toContain("name");
  expect(labels(RULES + "resource.address.geo.|")).toContain("lat");      // resource.x is the same field as resource.data.x
  const resource = labels(RULES + "resource.|");
  expect(resource).toEqual(expect.arrayContaining(["data", "id", "version", "name", "address"]));
  const age = suggest(at(RULES + "resource.data.|"), FIELDS, "database").find((s) => s.label === "age");
  expect(age?.detail).toBe("float | int");
});

test("after a call, methods; after `is`, types", () => {
  expect(labels(RULES + "request.resource.data.keys().|")).toContain("hasOnly");
  expect(labels(RULES + "request.resource.data.diff(resource.data).|")).toContain("affectedKeys");
  expect(labels(RULES + "request.resource.data.name is |")).toContain("string");
  expect(labels(RULES + "request.resource.data.name is st|")).toContain("string");
});

test("storage resources have file fields", () => {
  const files: FieldInfo[] = [{ path: "mimeType", types: ["string"] }, { path: "metadata", types: ["map"] }];
  expect(labels("match files/{f=**} {\n  allow create: if request.resource.|", "storage", files)).toEqual(expect.arrayContaining(["mimeType", "metadata", "size"]));
  expect(labels("match files/{f=**} {\n  allow create: if request.resource.|", "storage", files)).not.toContain("data");
});

test("offers the word operators, readable forms included, in a condition", () => {
  const text = "match users/{uid} {\n  allow update: if request.auth.uid == uid && ";
  const labels = suggest(analyze(text, text.length), [], "database").map((s) => s.label);
  for (const op of ["in", "not in", "is", "has only", "has any", "changes only", "changes any"]) expect(labels).toContain(op);
});
