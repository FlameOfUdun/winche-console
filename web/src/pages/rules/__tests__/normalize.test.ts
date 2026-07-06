import { describe, expect, test } from "vitest";
import {
  normalizeAllowRule, normalizeExpression, normalizeMatchBlock, normalizeRuleSet,
} from "../normalize";

describe("normalizeRuleSet (defensive JSON -> model)", () => {
  test("empty object becomes an empty ruleset", () => {
    expect(normalizeRuleSet({})).toEqual({ Matches: [] });
  });

  test("non-object input becomes an empty ruleset", () => {
    expect(normalizeRuleSet(null)).toEqual({ Matches: [] });
    expect(normalizeRuleSet(undefined)).toEqual({ Matches: [] });
    expect(normalizeRuleSet("nope")).toEqual({ Matches: [] });
    expect(normalizeRuleSet(42)).toEqual({ Matches: [] });
    expect(normalizeRuleSet([1, 2, 3])).toEqual({ Matches: [] });
  });

  test("recursively normalizes nested Matches", () => {
    const result = normalizeRuleSet({ Matches: [{ Path: "users/{userId}" }] });
    expect(result.Matches).toHaveLength(1);
    expect(result.Matches[0]).toEqual({ Path: "users/{userId}", Allow: [], Matches: [] });
  });
});

describe("normalizeMatchBlock", () => {
  test("missing Allow/Matches default to empty arrays, missing Path defaults to empty string", () => {
    expect(normalizeMatchBlock({})).toEqual({ Path: "", Allow: [], Matches: [] });
  });

  test("non-object input is treated as an empty block", () => {
    expect(normalizeMatchBlock(null)).toEqual({ Path: "", Allow: [], Matches: [] });
    expect(normalizeMatchBlock("garbage")).toEqual({ Path: "", Allow: [], Matches: [] });
  });

  test("non-string Path falls back to empty string", () => {
    expect(normalizeMatchBlock({ Path: 123 })).toEqual({ Path: "", Allow: [], Matches: [] });
  });

  test("non-array Allow/Matches fall back to empty arrays", () => {
    expect(normalizeMatchBlock({ Path: "x", Allow: "nope", Matches: {} })).toEqual({
      Path: "x", Allow: [], Matches: [],
    });
  });

  test("nested Matches are recursively normalized (missing fields filled in)", () => {
    const result = normalizeMatchBlock({
      Path: "a",
      Matches: [{ Path: "b" }, {}],
    });
    expect(result.Matches).toEqual([
      { Path: "b", Allow: [], Matches: [] },
      { Path: "", Allow: [], Matches: [] },
    ]);
  });

  test("Allow entries are recursively normalized via normalizeAllowRule", () => {
    const result = normalizeMatchBlock({ Path: "a", Allow: [{ Operations: ["Get", "Bogus"] }] });
    expect(result.Allow).toEqual([
      { Operations: ["Get"], Condition: { kind: "literal", Value: true } },
    ]);
  });
});

describe("normalizeAllowRule", () => {
  test("missing Operations defaults to [] and a valid Condition is produced", () => {
    const result = normalizeAllowRule({});
    expect(result.Operations).toEqual([]);
    expect(result.Condition).toEqual({ kind: "literal", Value: true });
  });

  test("non-object input is treated as an empty allow rule", () => {
    expect(normalizeAllowRule(null)).toEqual({ Operations: [], Condition: { kind: "literal", Value: true } });
  });

  test("unknown operation strings are filtered out, valid ones kept", () => {
    const result = normalizeAllowRule({ Operations: ["Get", "Frobnicate", "Delete"] });
    expect(result.Operations).toEqual(["Get", "Delete"]);
  });

  test("non-array Operations falls back to []", () => {
    expect(normalizeAllowRule({ Operations: "Get" }).Operations).toEqual([]);
  });

  test("Condition is recursively normalized", () => {
    const result = normalizeAllowRule({ Condition: { kind: "variable", Name: "request" } });
    expect(result.Condition).toEqual({ kind: "variable", Name: "request" });
  });
});

describe("normalizeExpression", () => {
  test("unknown kind falls back to a safe literal default", () => {
    expect(normalizeExpression({ kind: "wat" })).toEqual({ kind: "literal", Value: true });
  });

  test("absent kind falls back to a safe literal default", () => {
    expect(normalizeExpression({})).toEqual({ kind: "literal", Value: true });
  });

  test("non-object input falls back to a safe literal default", () => {
    expect(normalizeExpression(null)).toEqual({ kind: "literal", Value: true });
    expect(normalizeExpression("nope")).toEqual({ kind: "literal", Value: true });
    expect(normalizeExpression(5)).toEqual({ kind: "literal", Value: true });
  });

  test("literal: missing Value defaults to true", () => {
    expect(normalizeExpression({ kind: "literal" })).toEqual({ kind: "literal", Value: true });
  });

  test("literal: an explicit (falsy) Value is preserved", () => {
    expect(normalizeExpression({ kind: "literal", Value: false })).toEqual({ kind: "literal", Value: false });
    expect(normalizeExpression({ kind: "literal", Value: 0 })).toEqual({ kind: "literal", Value: 0 });
    expect(normalizeExpression({ kind: "literal", Value: null })).toEqual({ kind: "literal", Value: null });
  });

  test("variable: missing Name defaults to empty string", () => {
    expect(normalizeExpression({ kind: "variable" })).toEqual({ kind: "variable", Name: "" });
  });

  test("member: missing Target/Name get safe defaults", () => {
    expect(normalizeExpression({ kind: "member" })).toEqual({
      kind: "member", Target: { kind: "literal", Value: true }, Name: "",
    });
  });

  test("index: missing Target/Index get safe defaults", () => {
    expect(normalizeExpression({ kind: "index" })).toEqual({
      kind: "index",
      Target: { kind: "literal", Value: true },
      Index: { kind: "literal", Value: true },
    });
  });

  test("comparison: missing Left/Op/Right default to safe values", () => {
    expect(normalizeExpression({ kind: "comparison" })).toEqual({
      kind: "comparison",
      Left: { kind: "literal", Value: true },
      Op: "Eq",
      Right: { kind: "literal", Value: true },
    });
  });

  test("comparison: invalid Op falls back to Eq, valid Op is preserved", () => {
    const bogus = normalizeExpression({ kind: "comparison", Op: "Bogus" });
    const valid = normalizeExpression({ kind: "comparison", Op: "Gt" });
    if (bogus.kind !== "comparison" || valid.kind !== "comparison") throw new Error("expected comparison nodes");
    expect(bogus.Op).toBe("Eq");
    expect(valid.Op).toBe("Gt");
  });

  test("and/or: missing Operands default to [], present Operands are recursively normalized", () => {
    expect(normalizeExpression({ kind: "and" })).toEqual({ kind: "and", Operands: [] });
    expect(normalizeExpression({ kind: "or" })).toEqual({ kind: "or", Operands: [] });
    const result = normalizeExpression({ kind: "and", Operands: [{ kind: "variable", Name: "x" }, {}] });
    expect(result).toEqual({
      kind: "and",
      Operands: [{ kind: "variable", Name: "x" }, { kind: "literal", Value: true }],
    });
  });

  test("and/or: non-array Operands falls back to []", () => {
    expect(normalizeExpression({ kind: "and", Operands: "nope" })).toEqual({ kind: "and", Operands: [] });
  });

  test("not: missing Operand gets a safe default", () => {
    expect(normalizeExpression({ kind: "not" })).toEqual({
      kind: "not", Operand: { kind: "literal", Value: true },
    });
  });

  test("in: missing Item/Collection get safe defaults", () => {
    expect(normalizeExpression({ kind: "in" })).toEqual({
      kind: "in",
      Item: { kind: "literal", Value: true },
      Collection: { kind: "literal", Value: true },
    });
  });

  test("conditional: missing Condition/Then/Else get safe defaults", () => {
    expect(normalizeExpression({ kind: "conditional" })).toEqual({
      kind: "conditional",
      Condition: { kind: "literal", Value: true },
      Then: { kind: "literal", Value: true },
      Else: { kind: "literal", Value: true },
    });
  });

  test("call: missing Name/Args default to empty string / empty array", () => {
    expect(normalizeExpression({ kind: "call" })).toEqual({ kind: "call", Name: "", Args: [] });
  });

  test("call: Args are recursively normalized", () => {
    const result = normalizeExpression({ kind: "call", Name: "exists", Args: [{ kind: "variable", Name: "x" }] });
    expect(result).toEqual({ kind: "call", Name: "exists", Args: [{ kind: "variable", Name: "x" }] });
  });

  test("no required field is ever undefined for any recognized kind", () => {
    const kinds = [
      "literal", "variable", "member", "index", "comparison", "and", "or", "not", "in", "conditional", "call",
    ];
    for (const kind of kinds) {
      const result = normalizeExpression({ kind });
      for (const value of Object.values(result)) {
        expect(value).not.toBeUndefined();
      }
    }
  });
});
