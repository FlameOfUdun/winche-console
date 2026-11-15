import { useState } from "react";
import { Alert, Button, Collapse, Group, Modal, Paper, Select, Stack, Switch, TagsInput, Text, TextInput, UnstyledButton } from "@mantine/core";
import { errorWithList } from "../../api/appAuth";
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, serverAuthApi } from "../../api/client";
import {
  NEW_PROVIDER, newProviderId, providerLabel, providerSecretName, syncSecretName, type ConsoleSignIn, type ServerSettings, type ServerSettingsPage,
} from "../../api/server";
import { useQuery } from "@tanstack/react-query";
import { NumberInput } from "@mantine/core";
import type { WincheAuthSettings } from "../../api/appAuth";
import { KeycloakSyncFields } from "../authentication/KeycloakSyncFields";
import { ProviderRow } from "../authentication/SignInSettings";
import { IdentityProviderForm, RegisterAddresses, SecretField, TestSignIn } from "./IdentityProviderForm";
import { surface } from "../../theme";

/**
 * Saves the providers list with <paramref name="provider"/> in it (new, or in place of the one with its id), then its
 * client secret when one was typed. A new provider gets its id here.
 */
export async function saveProvider(settings: ServerSettings, provider: ConsoleSignIn, secret: string, reason: string): Promise<ConsoleSignIn> {
  const list = settings.consoleProviders ?? [];
  const p = provider.id ? provider : { ...provider, id: newProviderId(provider, list.map((x) => x.id)) };
  const next = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
  await api.saveServerSettings({ ...settings, consoleProviders: next }, reason);
  if (secret) await api.setServerSecret(providerSecretName(p.id), secret);
  return p;
}

/** A provider's settings and client secret, with a test sign-in (the form in the dialog, and in first-run setup). */
export function ProviderEditor({ value, onChange, secret, onSecret, page }: {
  value: ConsoleSignIn; onChange: (v: ConsoleSignIn) => void; secret: string; onSecret: (v: string) => void; page: ServerSettingsPage | undefined;
}) {
  const saved = value.id ? page?.secrets.find((s) => s.name === providerSecretName(value.id)) : undefined;
  return (
    <IdentityProviderForm value={value} onChange={onChange} unsavedSecret={secret || null}
      callbackUrl={page?.consoleSignIn?.callbackUrl} logoutUrl={page?.consoleSignIn?.logoutUrl}
      secretSlot={<SecretField value={secret} onChange={onSecret} savedAt={saved?.setAt} />} />
  );
}

/**
 * Server settings → Authentication → Sign-in method, laid out like Authentication → Sign-in method: the ways people sign in to the
 * console as a list (email and password, always there; then each identity provider), each opening to its settings and
 * saved with a reason.
 */
export function ConsoleSignInMethods({ page }: { page: ServerSettingsPage }) {
  const qc = useQueryClient();
  const s = page.settings;
  const providers = s.consoleProviders ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServerSettings | null>(null);
  const [secret, setSecret] = useState("");
  const [syncSecret, setSyncSecret] = useState("");
  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false);
  // The console accounts' own sign-in settings (Winche Auth's): the shortest password, two-step.
  const accounts = useQuery({ queryKey: ["console-accounts-signin"], queryFn: serverAuthApi.signInSettings });
  const own = accounts.data?.available ? accounts.data.settings : null;
  const [ownDraft, setOwnDraft] = useState<WincheAuthSettings | null>(null);
  const edit = (id: string, start?: (d: ServerSettings) => ServerSettings) => {
    const d: ServerSettings = JSON.parse(JSON.stringify(s));
    setDraft(start ? start(d) : d); setSecret(""); setSyncSecret(""); setRemoving(false); setEditing(id);
    setOwnDraft(own ? JSON.parse(JSON.stringify(own)) : null);
  };
  const cancel = () => { setEditing(null); setDraft(null); setSecret(""); setSyncSecret(""); setRemoving(false); setOwnDraft(null); };
  const toggle = (id: string, start?: (d: ServerSettings) => ServerSettings) => () => (editing === id ? cancel() : edit(id, start));
  const save = async (reason: string) => {
    if (!draft) return;
    // A new provider gets its id now; its secret, when one was typed, after the settings. One being removed goes.
    const i = editing?.startsWith("provider:") ? Number(editing.slice(9)) : -1;
    const list = draft.consoleProviders.map((p) => (p.id ? p : { ...p, id: newProviderId(p, draft.consoleProviders.map((x) => x.id)) }));
    await api.saveServerSettings({ ...draft, consoleProviders: removing ? list.filter((_, j) => j !== i) : list }, reason, page.version?.number ?? 0);
    if (secret && !removing && list[i]) await api.setServerSecret(providerSecretName(list[i].id), secret);
    if (syncSecret && !removing && list[i]?.keycloakSync) await api.setServerSecret(syncSecretName(list[i].id), syncSecret);
    if (editing === "passwords" && own && ownDraft && JSON.stringify(own) !== JSON.stringify(ownDraft)) {
      await serverAuthApi.saveSignInSettings(ownDraft, null, reason);
      await qc.invalidateQueries({ queryKey: ["console-accounts-signin"] });
    }
    for (const key of ["server-settings", "server-settings-history"]) await qc.invalidateQueries({ queryKey: [key] });
    cancel();
  };
  const row = (id: string) => ({ open: editing === id, onSave: save, onCancel: cancel });
  const shownProviders = editing?.startsWith("provider:") && draft ? draft.consoleProviders : providers;
  const setProvider = (i: number, p: ConsoleSignIn) => draft && setDraft({ ...draft, consoleProviders: draft.consoleProviders.map((x, j) => (j === i ? p : x)) });
  const onlyAdmins = s.consolePasswordsOnlyForAdmins && providers.some((p) => p.enabled);

  return (
    <Paper withBorder radius="lg" style={{ overflow: "hidden" }} data-testid="console-sign-in">
      <Group justify="space-between" align="flex-start" px={24} py={18} wrap="wrap" gap="md">
        <div>
          <Text fw={600} fz={16}>Sign-in providers</Text>
          <Text size="sm" c="var(--w-faint)" mt={4}>How people sign in to this console. Select one to set it up.</Text>
        </div>
        {editing === null && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
            Add new provider
          </Button>
        )}
      </Group>
      <div className="winche-provider-head"><span>Provider</span><span>Status</span><span /></div>

      <ProviderRow testId="console-method-password" logo="@" name="Email and password"
        sub={[onlyAdmins ? "Server admins only: the way in when a provider is down" : "Console accounts",
          own ? `shortest password ${own.emailPassword.minLength}` : null, own?.twoStep.enabled ? "two-step available" : null].filter(Boolean).join(" · ")}
        on onToggle={toggle("passwords")} {...row("passwords")}
        form={draft && (
          <>
            <Text size="sm" c={surface.muted}>Always on, so a server admin can get in when a provider is down.</Text>
            <Select label="Who can use a password" allowDeselect={false} w={360} value={draft.consolePasswordsOnlyForAdmins ? "admins" : "everyone"}
              description={providers.some((p) => p.enabled) ? undefined : "Server admins only takes effect once a provider is on."}
              data={[{ value: "everyone", label: "Everyone with an account" }, { value: "admins", label: "Server admins only (others use a provider)" }]}
              onChange={(v) => setDraft({ ...draft, consolePasswordsOnlyForAdmins: v === "admins" })} />
            {ownDraft && (
              <>
                <NumberInput label="Shortest password" w={180} min={8} max={128} value={ownDraft.emailPassword.minLength}
                  onChange={(v) => setOwnDraft({ ...ownDraft, emailPassword: { ...ownDraft.emailPassword, minLength: typeof v === "number" ? v : 8 } })} />
                <Switch label="People can turn on two-step sign-in" checked={ownDraft.twoStep.enabled}
                  description="An authenticator app. Trusted providers' own second step counts, so nobody is asked twice."
                  onChange={(e) => setOwnDraft({ ...ownDraft, twoStep: { ...ownDraft.twoStep, enabled: e.currentTarget.checked } })} />
                {ownDraft.twoStep.enabled && (
                  <Group wrap="wrap">
                    <TextInput label="Name in authenticator apps" value={ownDraft.twoStep.issuer ?? ""}
                      onChange={(e) => setOwnDraft({ ...ownDraft, twoStep: { ...ownDraft.twoStep, issuer: e.currentTarget.value || null } })} />
                    <NumberInput label="Recovery codes" w={160} min={1} max={50} value={ownDraft.twoStep.recoveryCodes}
                      onChange={(v) => setOwnDraft({ ...ownDraft, twoStep: { ...ownDraft.twoStep, recoveryCodes: typeof v === "number" ? v : 10 } })} />
                  </Group>
                )}
              </>
            )}
          </>
        )} />

      {shownProviders.map((p, i) => {
        const id = `provider:${i}`;
        const open = editing === id;
        const shown = open && draft ? draft.consoleProviders[i] : providers[i] ?? p;
        return (
          <ProviderRow key={id} testId="console-provider" logo="ID" name={shown.id || shown.buttonLabel ? providerLabel(shown) : "New provider"}
            sub={shown.issuer ?? "OpenID Connect"} on={shown.enabled} onToggle={toggle(id)} {...row(id)}
            form={open && draft && (
              <>
                <Switch label="Enable" description="Shown on the sign-in page. Off: nobody signs in with it, and its sessions end."
                  checked={shown.enabled} onChange={(e) => setProvider(i, { ...shown, enabled: e.currentTarget.checked })} />
                <ProviderEditor value={shown} onChange={(v) => setProvider(i, v)} secret={secret} onSecret={setSecret} page={page} />
                <KeycloakSyncFields value={shown.keycloakSync} onChange={(k) => setProvider(i, { ...shown, keycloakSync: k })}
                  secret={syncSecret} onSecret={setSyncSecret} secretSet={!!shown.id && !!page.secrets.find((x) => x.name === syncSecretName(shown.id))?.setAt} />
                {i < providers.length && (
                  <Group justify="flex-end" gap="sm">
                    {removing && <Text size="sm" c="red">Removed when you save: its sessions end and its client secret is deleted.</Text>}
                    <Button size="xs" variant="subtle" color={removing ? "gray" : "red"} onClick={() => setRemoving(!removing)}>
                      {removing ? "Keep it" : "Remove (on Save)"}
                    </Button>
                  </Group>
                )}
              </>
            )} />
        );
      })}
      {adding && <AddProviderDialog page={page} onClose={() => setAdding(false)} />}
    </Paper>
  );
}

/** Where people usually start: the kind of provider, with its issuer's shape and the claim its roles come in. */
const KINDS: { value: string; label: string; issuer: string; issuerHint: string; roleClaim: string | null }[] = [
  { value: "keycloak", label: "Keycloak", issuer: "https://login.example.com/realms/staff", issuerHint: "The realm's address: …/realms/<realm>.", roleClaim: "realm_access.roles" },
  { value: "entra", label: "Microsoft Entra ID", issuer: "https://login.microsoftonline.com/<tenant id>/v2.0", issuerHint: "With your tenant id, ending in /v2.0.", roleClaim: "roles" },
  { value: "google", label: "Google Workspace", issuer: "https://accounts.google.com", issuerHint: "Always https://accounts.google.com.", roleClaim: null },
  { value: "okta", label: "Okta", issuer: "https://example.okta.com", issuerHint: "Your Okta org's address (or an authorization server's).", roleClaim: "groups" },
  { value: "oidc", label: "OpenID Connect", issuer: "https://login.example.com", issuerHint: "Its discovery document is under it (/.well-known/openid-configuration).", roleClaim: null },
];

/**
 * Adds an identity provider in a dialog, like Authentication's: the kind, what the button says, the provider's issuer and
 * the console's client there, the addresses to register; more settings folded away; a test sign-in and a reason.
 */
function AddProviderDialog({ page, onClose }: { page: ServerSettingsPage; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState(KINDS[0]);
  const [value, setValue] = useState<ConsoleSignIn>({ ...NEW_PROVIDER, roleClaim: KINDS[0].roleClaim });
  const [secret, setSecret] = useState("");
  const [more, setMore] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<ConsoleSignIn>) => setValue({ ...value, ...p });
  const choose = (v: string | null) => {
    const k = KINDS.find((x) => x.value === v) ?? KINDS[0];
    setKind(k);
    // The kind's issuer when it has only one; its role claim unless one was typed.
    set({ issuer: k.value === "google" ? k.issuer : value.issuer, roleClaim: value.roleClaim === kind.roleClaim ? k.roleClaim : value.roleClaim });
  };
  const mono = { input: { fontFamily: "var(--mantine-font-family-monospace)" } };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const p = { ...value, buttonLabel: value.buttonLabel?.trim() || `Sign in with ${kind.value === "oidc" ? "your organization" : kind.label}` };
      await saveProvider(page.settings, p, secret, reason.trim());
      for (const key of ["server-settings", "server-settings-history"]) await qc.invalidateQueries({ queryKey: [key] });
      onClose();
    } catch (e) { setError(errorWithList(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} fz={18}>Add a sign-in provider</Text>}>
      <Stack gap="md">
        <Group grow wrap="wrap" align="flex-end">
          <Select label="Kind" allowDeselect={false} value={kind.value} data={KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={choose} />
          <TextInput label="Shown as" description="The sign-in button" placeholder={`Sign in with ${kind.value === "oidc" ? "your organization" : kind.label}`}
            value={value.buttonLabel ?? ""} onChange={(e) => set({ buttonLabel: e.currentTarget.value || null })} />
        </Group>
        <TextInput label="Issuer" description={kind.issuerHint} placeholder={kind.issuer} styles={mono}
          value={value.issuer ?? ""} onChange={(e) => set({ issuer: e.currentTarget.value || null })} />
        <Group grow wrap="wrap" align="flex-end">
          <TextInput label="Client ID" description="The console's client at the provider" placeholder="winche-console" styles={mono}
            value={value.clientId ?? ""} onChange={(e) => set({ clientId: e.currentTarget.value || null })} />
          <SecretField value={secret} onChange={setSecret} />
        </Group>
        <RegisterAddresses callbackUrl={page.consoleSignIn?.callbackUrl} logoutUrl={page.consoleSignIn?.logoutUrl} />
        <Switch label="Make an account for people the console doesn't know yet" checked={value.createAccounts}
          onChange={(e) => set({ createAccounts: e.currentTarget.checked })} />
        <Switch label="The provider's two-step sign-in is enough" checked={value.trustProviderTwoStep}
          onChange={(e) => set({ trustProviderTwoStep: e.currentTarget.checked })} />
        <UnstyledButton onClick={() => setMore(!more)} aria-expanded={more}>
          <Group gap={6}>
            <IconChevronDown size={15} className="winche-nav-chevron" data-open={more || undefined} />
            <Text size="sm" fw={500}>More settings: roles and scopes</Text>
          </Group>
        </UnstyledButton>
        <Collapse in={more}>
          <Stack gap="sm">
            <TextInput label="Claim with groups or roles" description="Empty: roles are given in the console." placeholder="groups" styles={mono}
              value={value.roleClaim ?? ""} onChange={(e) => set({ roleClaim: e.currentTarget.value || null })} />
            {value.roleClaim && (
              <Group grow wrap="wrap" align="flex-start">
                <TagsInput label="Server admin" placeholder="e.g. winche-admins" value={value.adminValues} onChange={(v) => set({ adminValues: v })} />
                <TagsInput label="Member" placeholder="e.g. developers" value={value.memberValues} onChange={(v) => set({ memberValues: v })} />
                <TagsInput label="Viewer" placeholder="e.g. support" value={value.viewerValues} onChange={(v) => set({ viewerValues: v })} />
              </Group>
            )}
            <TextInput label="Scopes" styles={mono} value={value.scopes} onChange={(e) => set({ scopes: e.currentTarget.value })} />
          </Stack>
        </Collapse>
        <TestSignIn value={value} unsavedSecret={secret || null} />
        {error && <Alert color="red" p="xs" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!reason.trim() || !value.issuer || !value.clientId}>Add provider</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
