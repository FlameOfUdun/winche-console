// Rule model + rule-editor API DTO types.
//
// CASING NOTE (important — do not "fix" this to be consistent):
//   - Endpoint envelope DTOs below (RuleSubsystemStatus, RuleVersionSummary, RuleVersionDetail,
//     RuleValidationResult, SimulateResult, etc.) are produced by ASP.NET's default JSON
//     serialization of C# records/anonymous objects, which is camelCase. Fields on these
//     interfaces are camelCase.
//   - The ruleset MODEL itself (RuleSet / MatchBlock / AllowRule / RuleExpression), which travels
//     as an opaque string inside the `rulesJson` field, is serialized by the backend with default
//     System.Text.Json object semantics: PascalCase property names and PascalCase enum string
//     values, plus a lowercase `"kind"` discriminator on expression nodes. The console passes
//     `rulesJson` through verbatim (validated/stored as-is, echoed back by `GET live`), so the SPA
//     must produce and consume this exact PascalCase + lowercase-kind shape when it parses or
//     builds a rulesJson string. Do not camelCase these fields.

export type RuleSubsystem = "database" | "storage";

export type RuleOperation = "Get" | "List" | "Create" | "Update" | "Delete";

export type ComparisonOperator = "Eq" | "Ne" | "Lt" | "Le" | "Gt" | "Ge";

/**
 * The value type used in `literal` expression nodes. The backend `RuleValue` serializes via a
 * custom converter using a tagged-object convention: plain JSON for null/bool/string, and tagged
 * objects for other primitives — `{"$integer": "..."}`, `{"$double": ...}`, `{"$timestamp": "..."}`,
 * `{"$bytes": "..."}`, `{"$path": "..."}` — with maps represented as JSON objects and lists as JSON
 * arrays. Modeled permissively here; a precise typed model is not required for this task (a later
 * expression-builder task will handle construction).
 */
export type RuleValue = unknown;

/**
 * Rule expression AST, mirroring the backend exactly: lowercase `kind` discriminator,
 * PascalCase payload fields.
 */
export type RuleExpression =
  | { kind: "literal"; Value: RuleValue }
  | { kind: "variable"; Name: string }
  | { kind: "member"; Target: RuleExpression; Name: string }
  | { kind: "index"; Target: RuleExpression; Index: RuleExpression }
  | { kind: "comparison"; Left: RuleExpression; Op: ComparisonOperator; Right: RuleExpression }
  | { kind: "and"; Operands: RuleExpression[] }
  | { kind: "or"; Operands: RuleExpression[] }
  | { kind: "not"; Operand: RuleExpression }
  | { kind: "in"; Item: RuleExpression; Collection: RuleExpression }
  | { kind: "conditional"; Condition: RuleExpression; Then: RuleExpression; Else: RuleExpression }
  | { kind: "call"; Name: string; Args: RuleExpression[] };

export interface AllowRule {
  Operations: RuleOperation[];
  Condition: RuleExpression;
}

export interface MatchBlock {
  Path: string;
  Allow: AllowRule[];
  Matches: MatchBlock[];
}

export interface RuleSet {
  Matches: MatchBlock[];
}

// --- Endpoint envelope DTOs (camelCase) ---

export interface RuleSubsystemStatus {
  id: RuleSubsystem;
  available: boolean;
  applyOnStartup: boolean;
  liveMatchesHead: boolean;
}

export interface RuleVersionSummary {
  version: number;
  isActive: boolean;
  note: string | null;
  createdAtUtc: string;
  createdBy: string | null;
  revertedFromVersion: number | null;
}

export interface RuleVersionDetail extends RuleVersionSummary {
  rulesJson: string;
}

export interface RuleValidationError {
  path: string | null;
  message: string;
}

export interface RuleValidationResult {
  ok: boolean;
  errors: RuleValidationError[];
}

export interface SimulateResult {
  allowed: boolean;
  error: string | null;
}
