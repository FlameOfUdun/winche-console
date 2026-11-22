import type { ReactNode } from "react";
import { Box, Group, Modal, Text, type ModalProps } from "@mantine/core";

/**
 * A dialog whose title and buttons stay put: only what's between them scrolls, with a line at each edge, so a tall
 * form never slides under the title or takes its buttons out of view.
 */
export function ScrollDialog({ opened, onClose, title, footer, size = "lg", children, testId, ariaLabel }: {
  opened: boolean; onClose: () => void; title: ReactNode; footer?: ReactNode; size?: ModalProps["size"];
  children: ReactNode; testId?: string; ariaLabel?: string;
}) {
  return (
    <Modal opened={opened} onClose={onClose} size={size} radius="lg" data-testid={testId} aria-label={ariaLabel}
      title={typeof title === "string" ? <Text fw={700} fz={18}>{title}</Text> : title}
      styles={{
        content: { display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "calc(100dvh - 2 * var(--modal-y-offset, 5dvh))" },
        header: { flexShrink: 0, borderBottom: "1px solid var(--w-border)" },
        body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0 },
      }}>
      <Box px="md" py="md" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</Box>
      {footer && (
        <Group justify="flex-end" gap="xs" px="md" py="sm" style={{ flexShrink: 0, borderTop: "1px solid var(--w-border)" }}>
          {footer}
        </Group>
      )}
    </Modal>
  );
}
