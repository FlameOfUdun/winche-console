import { Button, Stack, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import type { MatchBlock, RuleSet } from "../../api/rules";
import { MatchBlockEditor } from "./MatchBlockEditor";

const emptyMatchBlock = (): MatchBlock => ({ Path: "", Allow: [], Matches: [] });

/** Root of the Builder view: renders `RuleSet.Matches` and lets the admin add root-level match blocks. */
export function MatchTree({ ruleSet, onChange }: { ruleSet: RuleSet; onChange: (next: RuleSet) => void }) {
  return (
    <Stack gap={10}>
      {ruleSet.Matches.length === 0 && (
        <Text size="sm" c="dimmed">No match blocks yet. Add one to get started.</Text>
      )}
      {ruleSet.Matches.map((m, i) => (
        <MatchBlockEditor key={i} block={m}
          onChange={(next) => onChange({ ...ruleSet, Matches: ruleSet.Matches.map((x, xi) => (xi === i ? next : x)) })}
          onRemove={() => onChange({ ...ruleSet, Matches: ruleSet.Matches.filter((_, xi) => xi !== i) })} />
      ))}
      <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} w="fit-content"
        onClick={() => onChange({ ...ruleSet, Matches: [...ruleSet.Matches, emptyMatchBlock()] })}>
        Add match block
      </Button>
    </Stack>
  );
}
