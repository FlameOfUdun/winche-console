import { ActionIcon, Box, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { AllowRule, MatchBlock } from "../../api/rules";
import { AllowRuleEditor } from "./AllowRuleEditor";

const emptyAllowRule = (): AllowRule => ({ Operations: [], Condition: { kind: "literal", Value: true } });
const emptyMatchBlock = (): MatchBlock => ({ Path: "", Allow: [], Matches: [] });

/** Recursive editor for one `MatchBlock`: its path pattern, its allow rules, and nested match blocks. */
export function MatchBlockEditor({ block, onChange, onRemove }: {
  block: MatchBlock;
  onChange: (next: MatchBlock) => void;
  onRemove?: () => void;
}) {
  return (
    <Box style={{ border: "1px solid #e0e0e0", borderRadius: 6, padding: 10, background: "#fff" }}>
      <Group justify="space-between" align="center" mb={8} wrap="nowrap">
        <TextInput size="xs" ff="monospace" placeholder="users/{userId}" style={{ flex: 1 }}
          value={block.Path} onChange={(e) => onChange({ ...block, Path: e.currentTarget.value })} />
        {onRemove && (
          <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove match block" onClick={onRemove}>
            <IconTrash size={14} />
          </ActionIcon>
        )}
      </Group>

      <Stack gap={6} mb={8}>
        <Text size="xs" fw={600} c="#5f6368">ALLOW</Text>
        {block.Allow.map((a, i) => (
          <Group key={i} align="flex-start" gap={6} wrap="nowrap">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <AllowRuleEditor rule={a}
                onChange={(next) => onChange({ ...block, Allow: block.Allow.map((x, xi) => (xi === i ? next : x)) })} />
            </Box>
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove allow rule"
              onClick={() => onChange({ ...block, Allow: block.Allow.filter((_, xi) => xi !== i) })}>
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content"
          onClick={() => onChange({ ...block, Allow: [...block.Allow, emptyAllowRule()] })}>
          Add allow rule
        </Button>
      </Stack>

      <Box ml={8} pl={12} style={{ borderLeft: "1px solid #e0e0e0" }}>
        <Text size="xs" fw={600} c="#5f6368" mb={6}>NESTED MATCHES</Text>
        <Stack gap={8}>
          {block.Matches.map((m, i) => (
            <MatchBlockEditor key={i} block={m}
              onChange={(next) => onChange({ ...block, Matches: block.Matches.map((x, xi) => (xi === i ? next : x)) })}
              onRemove={() => onChange({ ...block, Matches: block.Matches.filter((_, xi) => xi !== i) })} />
          ))}
        </Stack>
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} w="fit-content" mt={6}
          onClick={() => onChange({ ...block, Matches: [...block.Matches, emptyMatchBlock()] })}>
          Add nested match
        </Button>
      </Box>
    </Box>
  );
}
