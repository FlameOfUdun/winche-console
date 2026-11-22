import type { ReactNode } from "react";
import { Box, Group, Modal, Text, type ModalProps } from "@mantine/core";
import { useOnTop } from "./dialogStack";

/**
 * A dialog whose title and buttons stay put: only what's between them scrolls, with a line at each edge, so a tall
 * form never slides under the title or takes its buttons out of view.
 */
export function ScrollDialog({ opened, onClose, title, footer, size = "lg", children, testId, ariaLabel, top, height }: {
  opened: boolean; onClose: () => void; title: ReactNode; footer?: ReactNode; size?: ModalProps["size"];
  children: ReactNode; testId?: string; ariaLabel?: string;
  /** Fixed under the title, above what scrolls (tabs). */
  top?: ReactNode;
  /** A fixed height (it stays the same whatever's shown), never taller than the window. */
  height?: number;
}) {
  const onTop = useOnTop(opened);   // a confirm over it takes Escape
  const heading = typeof title === "string" ? <Text fw={700} fz={18}>{title}</Text> : title;
  // Built from Modal's parts so a plain-text name ([ariaLabel]) reaches the dialog itself; the rich title then isn't its name.
  return (
    <Modal.Root opened={opened} onClose={onClose} closeOnEscape={onTop} size={size} radius="lg" data-testid={testId}
      styles={{
        content: { display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "calc(100dvh - 2 * var(--modal-y-offset, 5dvh))",
          ...(height ? { height: `min(${height}px, calc(100dvh - 2 * var(--modal-y-offset, 5dvh)))` } : {}) },
        header: { flexShrink: 0, borderBottom: "1px solid var(--w-border)" },
        body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0 },
      }}>
      <Modal.Overlay />
      <Modal.Content aria-label={ariaLabel}>
        <Modal.Header>
          {ariaLabel ? <div style={{ minWidth: 0, flex: 1 }}>{heading}</div> : <Modal.Title>{heading}</Modal.Title>}
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          {top && <Box px="md" pt="xs" style={{ flexShrink: 0 }}>{top}</Box>}
          <Box px="md" py="md" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</Box>
          {footer && (
            <Group justify="flex-end" gap="xs" px="md" py="sm" style={{ flexShrink: 0, borderTop: "1px solid var(--w-border)" }}>
              {footer}
            </Group>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
