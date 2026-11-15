import { describe, expect, test } from "vitest";
import { parseFields, serializeFields, type FieldEntry } from "../fields";

describe("document fields model (recursive)", () => {
  test("parses scalars into typed entries", () => {
    const entries = parseFields({
      name: { stringValue: "Alice" },
      age: { integerValue: "30" },
      active: { booleanValue: true },
      at: { geoPointValue: { latitude: 1, longitude: 2 } },
    });
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.value]));
    expect(byName.name).toEqual({ type: "string", text: "Alice" });
    expect(byName.age).toEqual({ type: "integer", text: "30" });
    expect(byName.active).toEqual({ type: "boolean", bool: true });
    expect(byName.at).toEqual({ type: "geopoint", lat: "1", lng: "2" });
  });

  test("parses nested array and map", () => {
    const entries = parseFields({
      tags: { arrayValue: { values: [{ stringValue: "a" }, { integerValue: "2" }] } },
      meta: { mapValue: { fields: { k: { stringValue: "v" } } } },
    });
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.value]));
    expect(byName.tags).toEqual({ type: "array", items: [{ type: "string", text: "a" }, { type: "integer", text: "2" }] });
    expect(byName.meta).toEqual({ type: "map", entries: [{ name: "k", value: { type: "string", text: "v" } }] });
  });

  test("serializes nested array/map back to tagged values", () => {
    const entries: FieldEntry[] = [
      { name: "tags", value: { type: "array", items: [{ type: "string", text: "a" }] } },
      { name: "meta", value: { type: "map", entries: [{ name: "k", value: { type: "integer", text: "5" } }] } },
      { name: "", value: { type: "string", text: "skip" } },
    ];
    expect(serializeFields(entries)).toEqual({
      tags: { arrayValue: { values: [{ stringValue: "a" }] } },
      meta: { mapValue: { fields: { k: { integerValue: "5" } } } },
    });
  });

  test("round-trips a nested document", () => {
    const original = {
      name: { stringValue: "x" },
      nested: { mapValue: { fields: { arr: { arrayValue: { values: [{ booleanValue: false }] } } } } },
    };
    expect(serializeFields(parseFields(original))).toEqual(original);
  });
});
