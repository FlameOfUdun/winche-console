import { NumberInput, PasswordInput, Select, Stack, Switch, TextInput } from "@mantine/core";
import { NEW_KEYCLOAK_SYNC, type KeycloakSyncSettings } from "../../api/appAuth";

/**
 * A Keycloak provider's sync: its users are managed in Keycloak (the realm), and Winche Auth follows (new, changed,
 * turned off and deleted users, their sessions). Off by default; on, it needs a client that can read the realm's users.
 */
export function KeycloakSyncFields({ value, onChange, secret, onSecret, secretSet }: {
  value: KeycloakSyncSettings | null | undefined; onChange: (v: KeycloakSyncSettings | null) => void;
  secret: string; onSecret: (v: string) => void; secretSet: boolean;
}) {
  const on = !!value;
  const set = (p: Partial<KeycloakSyncSettings>) => value && onChange({ ...value, ...p });
  return (
    <Stack gap="sm">
      <Switch label="Keep its users in step with Keycloak" checked={on}
        description="For a Keycloak realm: users added, changed, turned off or deleted there follow here, and their sessions end with them."
        onChange={(e) => onChange(e.currentTarget.checked ? { ...NEW_KEYCLOAK_SYNC } : null)} />
      {value && (
        <>
          <TextInput label="Sync client id" required placeholder="winche-sync" value={value.clientId}
            description="A confidential client in the realm with a service account holding view-users and view-events."
            onChange={(e) => set({ clientId: e.currentTarget.value })} />
          <PasswordInput label="Sync client secret" autoComplete="new-password" value={secret} onChange={(e) => onSecret(e.currentTarget.value)}
            description={secretSet ? "One is saved. Type a new one to replace it, or leave it empty to keep it." : "Kept encrypted, never shown again."} />
          <TextInput label="Keycloak address for the server" placeholder="Same as the provider's" value={value.adminServer ?? ""}
            description="Only when the server reaches Keycloak at another address (e.g. inside a private network)."
            onChange={(e) => set({ adminServer: e.currentTarget.value.trim() || null })} />
          <NumberInput label="Check for changes every" w={220} min={2} max={3600} value={value.pollSeconds}
            rightSection={<span style={{ fontSize: 12, paddingRight: 8, opacity: 0.6 }}>s</span>}
            onChange={(v) => set({ pollSeconds: typeof v === "number" ? v : 10 })} />
          <Select label="Someone deleted in Keycloak" allowDeselect={false} value={value.whenDeleted ?? "disable"}
            data={[{ value: "disable", label: "Is turned off and unlinked here (an admin decides)" }, { value: "delete", label: "Is deleted here too" }]}
            description={(value.whenDeleted ?? "disable") === "delete"
              ? "Their account here goes, and the app's users.onDeleted functions and webhooks run: use it when Keycloak is where accounts are kept."
              : "Their account here stays, turned off, with nothing removed."}
            onChange={(v) => set({ whenDeleted: v === "delete" ? "delete" : "disable" })} />
        </>
      )}
    </Stack>
  );
}
