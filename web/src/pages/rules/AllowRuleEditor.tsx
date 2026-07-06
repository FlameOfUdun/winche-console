import { Button, Chip, Group, Stack } from "@mantine/core";
import type { AllowRule, RuleOperation } from "../../api/rules";
import { ExpressionBuilder } from "./ExpressionBuilder";

const ALL_OPS: RuleOperation[] = ["Get", "List", "Create", "Update", "Delete"];
const READ_OPS: RuleOperation[] = ["Get", "List"];
const WRITE_OPS: RuleOperation[] = ["Create", "Update", "Delete"];

/** Merges `toAdd` into `current`, de-duplicated and restored to the canonical Get/List/Create/Update/Delete order. */
function mergeOps(current: RuleOperation[], toAdd: RuleOperation[]): RuleOperation[] {
  const set = new Set(current);
  toAdd.forEach((o) => set.add(o));
  return ALL_OPS.filter((o) => set.has(o));
}

/** Editor for one `AllowRule`: operation chips (+ read/write umbrella shortcuts) and its condition. */
export function AllowRuleEditor({ rule, onChange }: { rule: AllowRule; onChange: (next: AllowRule) => void }) {
  return (
    <Stack gap={8}>
      <Group gap={10} align="center" wrap="wrap">
        <Chip.Group multiple value={rule.Operations}
          onChange={(ops) => onChange({ ...rule, Operations: ALL_OPS.filter((o) => (ops as string[]).includes(o)) })}>
          <Group gap={6}>
            {ALL_OPS.map((op) => <Chip key={op} value={op} size="xs">{op}</Chip>)}
          </Group>
        </Chip.Group>
        <Group gap={4}>
          <Button size="xs" variant="default" onClick={() => onChange({ ...rule, Operations: mergeOps(rule.Operations, READ_OPS) })}>
            + read
          </Button>
          <Button size="xs" variant="default" onClick={() => onChange({ ...rule, Operations: mergeOps(rule.Operations, WRITE_OPS) })}>
            + write
          </Button>
        </Group>
      </Group>
      <ExpressionBuilder value={rule.Condition} onChange={(cond) => onChange({ ...rule, Condition: cond })} />
    </Stack>
  );
}
