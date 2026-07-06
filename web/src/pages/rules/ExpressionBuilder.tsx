import type { ReactNode } from "react";
import { ActionIcon, Box, Button, Group, Select, Stack, TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { ComparisonOperator, RuleExpression } from "../../api/rules";
import { RuleValueInput } from "./RuleValueInput";

const KIND_OPTIONS = [
  "literal", "variable", "member", "index", "comparison", "and", "or", "not", "in", "conditional", "call",
].map((v) => ({ value: v, label: v }));

const OP_OPTIONS: { value: ComparisonOperator; label: string }[] =
  ["Eq", "Ne", "Lt", "Le", "Gt", "Ge"].map((v) => ({ value: v as ComparisonOperator, label: v }));

const defaultVariable = (): RuleExpression => ({ kind: "variable", Name: "request" });
const defaultLiteral = (v: boolean): RuleExpression => ({ kind: "literal", Value: v });

/** Sensible, fully-shaped default node for each expression kind — used when creating a node or
 *  switching an existing node's kind. Never leaves a required field `undefined`. */
export function defaultExpression(kind: RuleExpression["kind"]): RuleExpression {
  switch (kind) {
    case "literal": return { kind: "literal", Value: true };
    case "variable": return { kind: "variable", Name: "request" };
    case "member": return { kind: "member", Target: defaultVariable(), Name: "" };
    case "index": return { kind: "index", Target: defaultVariable(), Index: defaultLiteral(true) };
    case "comparison": return { kind: "comparison", Left: defaultVariable(), Op: "Eq", Right: defaultLiteral(true) };
    case "and": return { kind: "and", Operands: [] };
    case "or": return { kind: "or", Operands: [] };
    case "not": return { kind: "not", Operand: defaultLiteral(true) };
    case "in": return { kind: "in", Item: defaultVariable(), Collection: { kind: "literal", Value: [] } };
    case "conditional": return { kind: "conditional", Condition: defaultLiteral(true), Then: defaultLiteral(true), Else: defaultLiteral(false) };
    case "call": return { kind: "call", Name: "exists", Args: [] };
  }
}

/** Small labeled, left-bordered indent wrapper for a child expression — the "nesting" visual. */
function ChildBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box ml={8} pl={12} style={{ borderLeft: "1px solid #e0e0e0" }}>
      <Box mb={2} style={{ fontSize: 11, fontWeight: 600, color: "#5f6368" }}>{label}</Box>
      {children}
    </Box>
  );
}

/** An add/remove-able list of child expressions (used by `and`/`or` Operands and `call` Args). */
function OperandList({ items, onChange, addLabel }: {
  items: RuleExpression[]; onChange: (next: RuleExpression[]) => void; addLabel: string;
}) {
  return (
    <Stack gap={6}>
      {items.map((op, i) => (
        <Group key={i} gap={6} align="flex-start" wrap="nowrap">
          <Box style={{ flex: 1, minWidth: 0 }}>
            <ExpressionBuilder value={op} onChange={(next) => onChange(items.map((o, oi) => (oi === i ? next : o)))} />
          </Box>
          <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove"
            onClick={() => onChange(items.filter((_, oi) => oi !== i))}>
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content"
        onClick={() => onChange([...items, defaultExpression("literal")])}>
        {addLabel}
      </Button>
    </Stack>
  );
}

/** Recursive AST editor for one `RuleExpression` node. Round-trips losslessly to/from the JSON model. */
export function ExpressionBuilder({ value, onChange }: {
  value: RuleExpression;
  onChange: (next: RuleExpression) => void;
}) {
  const setKind = (k: string | null) => {
    if (!k || k === value.kind) return;
    onChange(defaultExpression(k as RuleExpression["kind"]));
  };

  return (
    <Stack gap={6}>
      <Group gap={6} align="center" wrap="wrap">
        <Select size="xs" w={130} data={KIND_OPTIONS} value={value.kind} onChange={setKind}
          allowDeselect={false} aria-label="Expression kind" />

        {value.kind === "literal" && (
          <RuleValueInput value={value.Value} onChange={(v) => onChange({ kind: "literal", Value: v })} />
        )}
        {value.kind === "variable" && (
          <TextInput size="xs" ff="monospace" style={{ flex: 1, minWidth: 160 }}
            placeholder="request / resource / userId"
            value={value.Name} onChange={(e) => onChange({ kind: "variable", Name: e.currentTarget.value })} />
        )}
        {value.kind === "member" && (
          <TextInput size="xs" ff="monospace" style={{ flex: 1, minWidth: 120 }} placeholder="field name"
            value={value.Name} onChange={(e) => onChange({ ...value, Name: e.currentTarget.value })} />
        )}
        {value.kind === "comparison" && (
          <Select size="xs" w={80} data={OP_OPTIONS} value={value.Op} allowDeselect={false}
            onChange={(op) => op && onChange({ ...value, Op: op as ComparisonOperator })} />
        )}
        {value.kind === "call" && (
          <TextInput size="xs" ff="monospace" style={{ flex: 1, minWidth: 120 }} placeholder="exists / get / size"
            value={value.Name} onChange={(e) => onChange({ ...value, Name: e.currentTarget.value })} />
        )}
      </Group>

      {value.kind === "member" && (
        <ChildBox label="TARGET">
          <ExpressionBuilder value={value.Target} onChange={(t) => onChange({ ...value, Target: t })} />
        </ChildBox>
      )}

      {value.kind === "index" && (
        <>
          <ChildBox label="TARGET">
            <ExpressionBuilder value={value.Target} onChange={(t) => onChange({ ...value, Target: t })} />
          </ChildBox>
          <ChildBox label="INDEX">
            <ExpressionBuilder value={value.Index} onChange={(i) => onChange({ ...value, Index: i })} />
          </ChildBox>
        </>
      )}

      {value.kind === "comparison" && (
        <>
          <ChildBox label="LEFT">
            <ExpressionBuilder value={value.Left} onChange={(l) => onChange({ ...value, Left: l })} />
          </ChildBox>
          <ChildBox label="RIGHT">
            <ExpressionBuilder value={value.Right} onChange={(r) => onChange({ ...value, Right: r })} />
          </ChildBox>
        </>
      )}

      {(value.kind === "and" || value.kind === "or") && (
        <ChildBox label="OPERANDS">
          <OperandList items={value.Operands} addLabel="Add operand"
            onChange={(next) => onChange({ ...value, Operands: next })} />
        </ChildBox>
      )}

      {value.kind === "not" && (
        <ChildBox label="OPERAND">
          <ExpressionBuilder value={value.Operand} onChange={(o) => onChange({ ...value, Operand: o })} />
        </ChildBox>
      )}

      {value.kind === "in" && (
        <>
          <ChildBox label="ITEM">
            <ExpressionBuilder value={value.Item} onChange={(i) => onChange({ ...value, Item: i })} />
          </ChildBox>
          <ChildBox label="COLLECTION">
            <ExpressionBuilder value={value.Collection} onChange={(c) => onChange({ ...value, Collection: c })} />
          </ChildBox>
        </>
      )}

      {value.kind === "conditional" && (
        <>
          <ChildBox label="CONDITION">
            <ExpressionBuilder value={value.Condition} onChange={(c) => onChange({ ...value, Condition: c })} />
          </ChildBox>
          <ChildBox label="THEN">
            <ExpressionBuilder value={value.Then} onChange={(t) => onChange({ ...value, Then: t })} />
          </ChildBox>
          <ChildBox label="ELSE">
            <ExpressionBuilder value={value.Else} onChange={(e) => onChange({ ...value, Else: e })} />
          </ChildBox>
        </>
      )}

      {value.kind === "call" && (
        <ChildBox label="ARGS">
          <OperandList items={value.Args} addLabel="Add arg"
            onChange={(next) => onChange({ ...value, Args: next })} />
        </ChildBox>
      )}
    </Stack>
  );
}
