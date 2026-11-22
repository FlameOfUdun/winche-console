import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../api/appAuth";
import { useOnTop } from "./dialogStack";

/**
 * A small reusable confirmation dialog for destructive actions (delete file/folder/document/collection). Either the
 * caller runs it ([onConfirm], with its own [loading] and [error]), or it runs [action] itself: busy while it runs,
 * closed (by [onCancel]) when it's done, its error shown and the dialog kept when it fails.
 */
export function ConfirmModal({
  opened, title, message, confirmLabel, confirmColor = "red", loading = false, error, onConfirm, action, onCancel,
}: {
  opened: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  confirmColor?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm?: () => void;
  action?: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { if (opened) setFailed(null); }, [opened]);
  const onTop = useOnTop(opened);
  const running = loading || busy;
  const shown = error ?? failed;
  const confirm = async () => {
    if (!action) { onConfirm?.(); return; }
    setBusy(true); setFailed(null);
    try { await action(); onCancel(); } catch (e) { setFailed(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={() => { if (!running) onCancel(); }} title={title} closeOnEscape={onTop}>
      <Stack>
        <Text size="sm">{message}</Text>
        {shown && <Text c="red" size="sm">{shown}</Text>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={running}>Cancel</Button>
          <Button color={confirmColor} loading={running} onClick={confirm}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
