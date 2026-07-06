// Defensive JSON → model normalization for the rules Builder view. The backend's rulesJson is
// PascalCase with a lowercase `kind` discriminator (see api/rules.ts). Hand-edited or imported JSON
// may have missing/malformed fields; normalize*() below always returns a fully-shaped, well-typed
// value so the GUI tree never has to null-check while rendering. Unrecognized/malformed nodes fall
// back to safe defaults (e.g. an unknown expression `kind` becomes `{kind:"literal",Value:true}`,
// a ruleset with no valid `Matches` array becomes `{ Matches: [] }`).
import type {
  AllowRule, ComparisonOperator, MatchBlock, RuleExpression, RuleOperation, RuleSet,
} from "../../api/rules";

const OPERATIONS: RuleOperation[] = ["Get", "List", "Create", "Update", "Delete"];
const COMPARISON_OPS: ComparisonOperator[] = ["Eq", "Ne", "Lt", "Le", "Gt", "Ge"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function normalizeExpression(e: unknown): RuleExpression {
  if (!isRecord(e) || typeof e.kind !== "string") return { kind: "literal", Value: true };
  switch (e.kind) {
    case "literal":
      return { kind: "literal", Value: "Value" in e ? e.Value : true };
    case "variable":
      return { kind: "variable", Name: typeof e.Name === "string" ? e.Name : "" };
    case "member":
      return { kind: "member", Target: normalizeExpression(e.Target), Name: typeof e.Name === "string" ? e.Name : "" };
    case "index":
      return { kind: "index", Target: normalizeExpression(e.Target), Index: normalizeExpression(e.Index) };
    case "comparison":
      return {
        kind: "comparison",
        Left: normalizeExpression(e.Left),
        Op: COMPARISON_OPS.includes(e.Op as ComparisonOperator) ? (e.Op as ComparisonOperator) : "Eq",
        Right: normalizeExpression(e.Right),
      };
    case "and":
      return { kind: "and", Operands: Array.isArray(e.Operands) ? e.Operands.map(normalizeExpression) : [] };
    case "or":
      return { kind: "or", Operands: Array.isArray(e.Operands) ? e.Operands.map(normalizeExpression) : [] };
    case "not":
      return { kind: "not", Operand: normalizeExpression(e.Operand) };
    case "in":
      return { kind: "in", Item: normalizeExpression(e.Item), Collection: normalizeExpression(e.Collection) };
    case "conditional":
      return {
        kind: "conditional",
        Condition: normalizeExpression(e.Condition),
        Then: normalizeExpression(e.Then),
        Else: normalizeExpression(e.Else),
      };
    case "call":
      return {
        kind: "call",
        Name: typeof e.Name === "string" ? e.Name : "",
        Args: Array.isArray(e.Args) ? e.Args.map(normalizeExpression) : [],
      };
    default:
      return { kind: "literal", Value: true };
  }
}

export function normalizeAllowRule(a: unknown): AllowRule {
  const o = isRecord(a) ? a : {};
  const ops = Array.isArray(o.Operations)
    ? (o.Operations as unknown[]).filter((x): x is RuleOperation => OPERATIONS.includes(x as RuleOperation))
    : [];
  return { Operations: ops, Condition: normalizeExpression(o.Condition) };
}

export function normalizeMatchBlock(b: unknown): MatchBlock {
  const o = isRecord(b) ? b : {};
  return {
    Path: typeof o.Path === "string" ? o.Path : "",
    Allow: Array.isArray(o.Allow) ? o.Allow.map(normalizeAllowRule) : [],
    Matches: Array.isArray(o.Matches) ? o.Matches.map(normalizeMatchBlock) : [],
  };
}

export function normalizeRuleSet(v: unknown): RuleSet {
  const o = isRecord(v) ? v : {};
  return { Matches: Array.isArray(o.Matches) ? o.Matches.map(normalizeMatchBlock) : [] };
}
