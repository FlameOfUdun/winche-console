import { expect, test } from "vitest";
import { addToBlock, formatIndexText, indexLine } from "../indexText";

test("formats one block per collection, like the server", () => {
  expect(formatIndexText(
    [
      { collection: "sessions", fields: [{ path: "userId", direction: "asc" }, { path: "startedAt", direction: "desc" }], kind: "ordered", collectionGroup: false },
      { collection: "notes", fields: [{ path: "tags", direction: "asc" }], kind: "array", collectionGroup: true },
    ],
    [{ collection: "sessions", field: "expiresAt" }, { collection: "my-logs", field: "at" }],
  )).toBe(
    "collection sessions {\n  index (userId, startedAt desc)\n  expire when expiresAt\n}\n\n" +
    "collection group notes {\n  index (tags contains)\n}\n\n" +
    "collection `my-logs` {\n  expire when at\n}\n",
  );
  expect(formatIndexText([], [])).toBe("");
});

test("a line goes into its collection's block, or a new one", () => {
  const line = indexLine({ collection: "visits", fields: [{ path: "at", direction: "desc" }], kind: "ordered", collectionGroup: false });
  expect(line).toBe("index (at desc)");
  expect(addToBlock("collection visits {\n  index (patientId)\n}\n", "visits", false, line))
    .toBe("collection visits {\n  index (patientId)\n  index (at desc)\n}\n");
  expect(addToBlock("collection a {\n}\n", "visits", false, line)).toBe("collection a {\n}\n\ncollection visits {\n  index (at desc)\n}\n");
  expect(addToBlock("", "visits", true, line)).toBe("collection group visits {\n  index (at desc)\n}\n");
});
