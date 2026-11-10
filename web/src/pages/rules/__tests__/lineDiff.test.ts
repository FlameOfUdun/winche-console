import { expect, test } from "vitest";
import { diffStats, lineDiff } from "../lineDiff";

test("unchanged text is all 'same'", () => {
  const d = lineDiff("a\nb\n", "a\nb\n");
  expect(d.map((l) => l.kind)).toEqual(["same", "same"]);
  expect(diffStats(d)).toEqual({ added: 0, removed: 0 });
});

test("a changed line is removed then added, with both line numbers", () => {
  const d = lineDiff("match a {\n  allow read: if x;\n}\n", "match a {\n  allow read: if y;\n  allow write: if z;\n}\n");
  expect(d).toEqual([
    { kind: "same", text: "match a {", before: 1, after: 1 },
    { kind: "removed", text: "  allow read: if x;", before: 2, after: null },
    { kind: "added", text: "  allow read: if y;", before: null, after: 2 },
    { kind: "added", text: "  allow write: if z;", before: null, after: 3 },
    { kind: "same", text: "}", before: 3, after: 4 },
  ]);
  expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
});

test("from or to nothing", () => {
  expect(lineDiff("", "a\nb").map((l) => l.kind)).toEqual(["added", "added"]);
  expect(lineDiff("a\nb", "").map((l) => l.kind)).toEqual(["removed", "removed"]);
  expect(lineDiff("", "")).toEqual([]);
});
