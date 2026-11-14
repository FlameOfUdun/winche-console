import type { ReactNode } from "react";
import { Group, Stack, Text } from "@mantine/core";
import { surface } from "../theme";

/**
 * What a list shows when it has nothing in it: an icon, a title, a line on what goes here, and the action that adds
 * the first one. `compact` for small panels (a user's sessions, a filter with no matches); the full one for a page's
 * main list.
 */
export function EmptyState({ icon: Icon, title, description, action, compact = false, bordered = true }: {
  icon: React.ElementType;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  bordered?: boolean;
}) {
  return (
    <Stack align="center" justify="center" gap={compact ? 6 : 12} ta="center" data-testid="empty-state"
      py={compact ? 20 : 48} px="lg"
      style={{
        border: bordered ? `1px dashed ${surface.border}` : undefined,
        borderRadius: 12,
        background: bordered ? surface.card : undefined,
      }}>
      <div style={{
        width: compact ? 36 : 52, height: compact ? 36 : 52, borderRadius: 999, display: "grid", placeItems: "center",
        background: "var(--mantine-color-winche-0)", color: "var(--mantine-color-winche-6)",
      }}>
        <Icon size={compact ? 18 : 24} stroke={1.7} />
      </div>
      <div>
        <Text fw={600} fz={compact ? 14 : 16}>{title}</Text>
        {description && <Text size="sm" c={surface.muted} mt={4} maw={440} mx="auto" lh={1.5}>{description}</Text>}
      </div>
      {action && <Group gap="xs" justify="center" mt={compact ? 2 : 4}>{action}</Group>}
    </Stack>
  );
}
