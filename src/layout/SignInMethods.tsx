import { useState } from "react";
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { ConfirmModal } from "../components/ConfirmModal";

/** Where adding a provider goes: the provider, then back to `here` with this dialog open again. */
export function linkUrl(provider: string, here: string): string {
  const back = `${here}${here.includes("?") ? "&" : "?"}signInMethods=1`;
  return new URL(`/console/v1/session/oidc/start?provider=${encodeURIComponent(provider)}&link=true&returnUrl=${encodeURIComponent(back)}`,
    document.baseURI).toString();
}

/**
 * The signed-in person's ways to sign in: their password, and each identity provider the server offers. A provider is
 * added here, signed in (never by its email address alone), and removed here.
 */
export function SignInMethodsModal({ opened, onClose, error }: { opened: boolean; onClose: () => void; error?: string | null }) {
  const qc = useQueryClient();
  const methods = useQuery({ queryKey: ["sign-in-methods"], queryFn: () => api.signInMethods(), enabled: opened });
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const here = window.location.pathname;
  return (
    <Modal opened={opened} onClose={onClose} title="Sign-in methods">
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}
        {methods.isLoading ? <Loader size="sm" /> : methods.isError ? <Alert color="red">{String(methods.error)}</Alert> : methods.data && (
          <>
            <Group justify="space-between">
              <Text size="sm" fw={500}>Password</Text>
              {methods.data.password ? <Badge variant="light" color="teal" tt="none">On</Badge> : <Text size="sm" c="var(--w-muted)">Not set</Text>}
            </Group>
            {methods.data.providers.map((p) => (
              <Group key={p.id} justify="space-between">
                <Text size="sm" fw={500}>{p.label}</Text>
                {p.linked
                  ? <Button size="xs" variant="subtle" color="red" aria-label={`Remove ${p.label}`} onClick={() => setRemoving(p)}>Remove</Button>
                  : <Anchor size="sm" href={linkUrl(p.id, here)} aria-label={`Add ${p.label}`}>Add</Anchor>}
              </Group>
            ))}
            <Text size="xs" c="var(--w-muted)">Adding one takes you to it to sign in; after that it signs you in here too.</Text>
          </>
        )}
      </Stack>
      <ConfirmModal opened={!!removing} title={`Remove ${removing?.label ?? ""}`} confirmLabel="Remove"
        message={<>You won't be able to sign in with <b>{removing?.label}</b> until you add it again here.</>}
        action={async () => { await api.unlinkSignInMethod(removing!.id); await qc.invalidateQueries({ queryKey: ["sign-in-methods"] }); }}
        onCancel={() => setRemoving(null)} />
    </Modal>
  );
}
