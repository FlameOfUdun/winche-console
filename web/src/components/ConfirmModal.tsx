import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

/** A small reusable confirmation dialog for destructive actions (delete file/folder/document/collection). */
export function ConfirmModal({
  opened, title, message, confirmLabel, confirmColor = "red", loading = false, error, onConfirm, onCancel,
}: {
  opened: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  confirmColor?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal opened={opened} onClose={() => { if (!loading) onCancel(); }} title={title}>
      <Stack>
        <Text size="sm">{message}</Text>
        {error && <Text c="red" size="sm">{error}</Text>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button color={confirmColor} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
