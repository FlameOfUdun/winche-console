import { NumberInput, Stack, Switch, TextInput } from "@mantine/core";
import { SecretInput } from "../../components/SecretInput";
import { NEW_KEYCLOAK_SYNC, type KeycloakSyncSettings } from "../../api/appAuth";

/**
 * A Keycloak provider's sync: its users are managed in Keycloak (the realm), and Winche Auth follows (new, changed,
 * turned off and deleted users, their sessions). Off by default; on, it needs a client that can read the realm's users.
 */
export function KeycloakSyncFields({ value, onChange, secret, onSecret, secretSet, secretReference }: {
  value: KeycloakSyncSettings | null | undefined; onChange: (v: KeycloakSyncSettings | null) => void;
  secret: string; onSecret: (v: string) => void; secretSet: boolean; secretReference?: string | null;
}) {
  const on = !!value;
  const set = (p: Partial<KeycloakSyncSettings>) => value && onChange({ ...value, ...p });
  return (
    <Stack gap="sm">
      <Switch label="Keep its users in step with Keycloak" checked={on}
        onChange={(e) => onChange(e.currentTarget.checked ? { ...NEW_KEYCLOAK_SYNC } : null)} />
      {value && (
        <>
          <TextInput label="Sync client id" required placeholder="winche-sync" value={value.clientId}
            description="Its service account needs view-users and view-events"
            onChange={(e) => set({ clientId: e.currentTarget.value })} />
          <SecretInput label="Sync client secret" value={secret} onChange={onSecret} savedReference={secretReference}
            description={secretSet ? "One is saved: leave empty to keep it." : undefined} />
          <TextInput label="Keycloak address for the server" placeholder="Same as the provider's" value={value.adminServer ?? ""}
            description="Only if the server reaches it at another address"
            onChange={(e) => set({ adminServer: e.currentTarget.value.trim() || null })} />
          <NumberInput label="Check for changes every" w={220} min={2} max={3600} value={value.pollSeconds}
            rightSection={<span style={{ fontSize: 12, paddingRight: 8, opacity: 0.6 }}>s</span>}
            onChange={(v) => set({ pollSeconds: typeof v === "number" ? v : 10 })} />
        </>
      )}
    </Stack>
  );
}
