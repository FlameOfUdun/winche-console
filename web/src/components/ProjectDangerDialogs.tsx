import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { errorMessage } from "../api/appAuth";
import { surface } from "../theme";

/** A destructive step on a project, confirmed by typing its id. */
export function ConfirmByIdDialog({ opened, id, title, body, action, color = "red", onConfirm, onClose }: {
  opened: boolean; id: string; title: string; body: React.ReactNode; action: string; color?: string;
  onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setTyped(""); setError(null); onClose(); };
  const confirm = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(); close(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" title={<Text fw={700} fz={18}>{title}</Text>}>
      <Stack gap="md">
        <Text size="sm" c={surface.muted}>{body}</Text>
        <TextInput label={<>Type <Text span ff="monospace" fw={600}>{id}</Text> to confirm</>} data-autofocus value={typed}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} onChange={(e) => setTyped(e.currentTarget.value)} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button color={color} onClick={confirm} loading={busy} disabled={typed.trim() !== id}>{action}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
