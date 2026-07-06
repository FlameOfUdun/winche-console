import { describe, expect, test } from "vitest";
import { defaultExpression } from "../ExpressionBuilder";
import type { RuleExpression } from "../../../api/rules";

const ALL_KINDS: RuleExpression["kind"][] = [
  "literal", "variable", "member", "index", "comparison", "and", "or", "not", "in", "conditional", "call",
];

describe("defaultExpression (fully-shaped default per kind)", () => {
  test.each(ALL_KINDS)("kind %s: returns a node with matching kind and no undefined required fields", (kind) => {
    const node = defaultExpression(kind);
    expect(node.kind).toBe(kind);
    for (const value of Object.values(node)) {
      expect(value).not.toBeUndefined();
    }
  });

  test("literal: has a Value", () => {
    expect(defaultExpression("literal")).toEqual({ kind: "literal", Value: true });
  });

  test("variable: has a non-empty Name", () => {
    const node = defaultExpression("variable");
    expect(node).toEqual({ kind: "variable", Name: "request" });
  });

  test("member: has Target and Name", () => {
    const node = defaultExpression("member");
    expect(node.kind).toBe("member");
    if (node.kind === "member") {
      expect(node.Target).toEqual({ kind: "variable", Name: "request" });
      expect(node.Name).toBe("");
    }
  });

  test("index: has Target and Index", () => {
    const node = defaultExpression("index");
    expect(node.kind).toBe("index");
    if (node.kind === "index") {
      expect(node.Target).toBeDefined();
      expect(node.Index).toBeDefined();
    }
  });

  test("comparison: has Left/Op/Right", () => {
    const node = defaultExpression("comparison");
    expect(node.kind).toBe("comparison");
    if (node.kind === "comparison") {
      expect(node.Left).toBeDefined();
      expect(node.Op).toBe("Eq");
      expect(node.Right).toBeDefined();
    }
  });

  test("and/or: have an empty Operands array", () => {
    const and = defaultExpression("and");
    const or = defaultExpression("or");
    expect(and).toEqual({ kind: "and", Operands: [] });
    expect(or).toEqual({ kind: "or", Operands: [] });
  });

  test("not: has an Operand", () => {
    const node = defaultExpression("not");
    expect(node.kind).toBe("not");
    if (node.kind === "not") expect(node.Operand).toBeDefined();
  });

  test("in: has Item and Collection", () => {
    const node = defaultExpression("in");
    expect(node.kind).toBe("in");
    if (node.kind === "in") {
      expect(node.Item).toBeDefined();
      expect(node.Collection).toBeDefined();
    }
  });

  test("conditional: has Condition/Then/Else", () => {
    const node = defaultExpression("conditional");
    expect(node.kind).toBe("conditional");
    if (node.kind === "conditional") {
      expect(node.Condition).toBeDefined();
      expect(node.Then).toBeDefined();
      expect(node.Else).toBeDefined();
    }
  });

  test("call: has Name and an Args array", () => {
    const node = defaultExpression("call");
    expect(node.kind).toBe("call");
    if (node.kind === "call") {
      expect(typeof node.Name).toBe("string");
      expect(node.Name.length).toBeGreaterThan(0);
      expect(node.Args).toEqual([]);
    }
  });
});
