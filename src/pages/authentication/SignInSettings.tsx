import { KeycloakSyncFields } from "./KeycloakSyncFields";
import { useAuthApi } from "./authScope";
import { useState, type ReactNode } from "react";
import {
  Alert, Badge, Button, Collapse, Group, Loader, Modal, NumberInput, Paper, PasswordInput, SegmentedControl, Select, Stack, Switch, Text, TextInput, UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, errorWithList, type SignInProviderSettings, type SmtpSettings, type WincheAuthSettings } from "../../api/appAuth";
import { when } from "./UsersView";
import { CardsPage, EditCard, EditRow, HistoryButton, OnOff } from "../../components/EditCard";
import { versionLine } from "../settings/AreaSettings";
import { HistorySection } from "./SettingsPanel";
import { AuthSettingsView } from "./AuthSettingsView";
import { KeycloakSyncView } from "./KeycloakSyncView";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** A number field's value; empty stays empty while the user types (the server refuses it if saved). */
const num = (v: string | number) => (v === "" ? ("" as unknown as number) : Number(v));
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const NEW_SMTP: SmtpSettings = { host: "", port: 587, security: "startTls", username: null, fromAddress: "", fromName: null };

/**
 * Winche Auth's settings (auth.signIn), edited a card or a provider at a time: a copy of the whole document to change,
 * saved with a reason as a new version.
 */
export function useSignInCards() {
  const authApi = useAuthApi();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["signin-settings"], queryFn: authApi.signInSettings });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<WincheAuthSettings | null>(null);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [syncSecrets, setSyncSecrets] = useState<Record<string, string>>({});
  const data = saved.data?.available ? saved.data : null;
  const edit = (id: string, start?: (d: WincheAuthSettings) => WincheAuthSettings) => {
    if (!data) return;
    const d = clone(data.settings);
    setDraft(start ? start(d) : d);
    setSmtpPassword("");
    setSyncSecrets({});
    setEditing(id);
  };
  const cancel = () => { setEditing(null); setDraft(null); setSmtpPassword(""); setSyncSecrets({}); };
  const save = async (reason: string) => {
    if (!draft) return;
    const typed = Object.fromEntries(Object.entries(syncSecrets).filter(([n, v]) => v && draft.providers.some((p) => p.name === n && p.keycloakSync)));
    const basedOn = data?.version?.number ?? 0;   // someone else's save since: refused, not undone
    await authApi.saveSignInSettings(draft, smtpPassword || null, reason, Object.keys(typed).length ? typed : undefined, basedOn);
    for (const key of ["signin-settings", "settings-history", "app-auth-config"]) await qc.invalidateQueries({ queryKey: [key] });
    cancel();
  };
  const editable = !!data?.editable;
  const card = (id: string) => ({ editing: editing === id, onEdit: () => edit(id), onCancel: cancel, onSave: save, editable });
  const set = (patch: Partial<WincheAuthSettings>) => draft && setDraft({ ...draft, ...patch });
  const syncSecret = (name: string) => ({
    secret: syncSecrets[name] ?? "", onSecret: (v: string) => setSyncSecrets({ ...syncSecrets, [name]: v }), secretSet: !!data?.syncSecrets?.[name],
  });
  return { saved, data, editing, draft, set, edit, cancel, save, card, editable, smtpPassword, setSmtpPassword, syncSecret };
}

/** One sign-in provider: a row with its status that opens to its settings, saved with a reason. */
export function ProviderRow({ logo, name, sub, on, open, onToggle, form, onSave, onCancel, testId }: {
  logo: ReactNode; name: ReactNode; sub?: ReactNode; on: boolean; open: boolean; onToggle?: () => void;
  form: ReactNode; onSave: (reason: string) => Promise<unknown>; onCancel: () => void; testId?: string;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave(reason.trim()); setReason(""); } catch (e) { setError(errorWithList(e)); } finally { setBusy(false); }
  };
  return (
    <div className="winche-provider" data-open={open || undefined} data-testid={testId}>
      <UnstyledButton className="winche-provider-row" onClick={onToggle} aria-expanded={open} disabled={!onToggle}>
        <Group gap={12} wrap="nowrap" style={{ minWidth: 0 }}>
          <span className="winche-provider-logo">{logo}</span>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>{name}</Text>
            {sub && <Text size="xs" c="var(--w-faint)" truncate>{sub}</Text>}
          </div>
        </Group>
        <OnOff on={on} onLabel="Enabled" offLabel="Disabled" />
        {onToggle ? <IconChevronDown size={16} className="winche-nav-chevron" data-open={open || undefined} /> : <span />}
      </UnstyledButton>
      <Collapse in={open} transitionDuration={120}>
        {open && (
          <div className="winche-provider-body">
            <Stack gap="md">{form}</Stack>
            {error && <Alert color="red" p="xs" mt="md" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            <Group gap="xs" wrap="wrap" mt="md" pt="md" style={{ borderTop: "1px solid var(--w-subtle)" }}>
              <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 260px" }}
                value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
              <Button variant="default" onClick={() => { setReason(""); setError(null); onCancel(); }} disabled={busy}>Cancel</Button>
              <Button onClick={save} loading={busy} disabled={!reason.trim()}>Save</Button>
            </Group>
          </div>
        )}
      </Collapse>
    </div>
  );
}

const PROVIDER_LOGO: Record<string, string> = { google: "G", apple: "", oidc: "ID" };

/** A sign-in provider's settings (Google, Apple or OpenID Connect): in its row, and in the dialog that adds one. */
function ProviderFields({ value, onChange, sync }: {
  value: SignInProviderSettings; onChange: (p: SignInProviderSettings) => void;
  sync: { secret: string; onSecret: (v: string) => void; secretSet: boolean };
}) {
  const set = (p: Partial<SignInProviderSettings>) => onChange({ ...value, ...p });
  return (
    <>
      <Group grow wrap="wrap" align="flex-end">
        <Select label="Kind" allowDeselect={false} value={value.kind}
          data={[{ value: "google", label: "Google" }, { value: "apple", label: "Apple" }, { value: "oidc", label: "OpenID Connect" }]}
          onChange={(v) => set({ kind: (v ?? "oidc") as SignInProviderSettings["kind"] })} />
        <TextInput label="Name" description="The id apps sign in with" value={value.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput label="Shown as" value={value.displayName ?? ""} onChange={(e) => set({ displayName: e.currentTarget.value || null })} />
      </Group>
      {value.kind === "oidc" && (
        <TextInput label="Address" placeholder="https://login.example.com" value={value.authority ?? ""}
          onChange={(e) => set({ authority: e.currentTarget.value || null })} />
      )}
      <TextInput label="Client ids" description="The app's ids at the provider, separated by commas. Tokens must be for one of them."
        value={value.audiences.join(", ")} onChange={(e) => set({ audiences: list(e.currentTarget.value) })} />
      <TextInput label="Claims copied to the user" description="From the provider's token into custom claims at each sign-in, e.g. role, org."
        value={value.copiedClaims.join(", ")} onChange={(e) => set({ copiedClaims: list(e.currentTarget.value) })} />
      <Switch label="Require a second step" checked={!!value.requireSecondStep}
        description="Sign-ins without one (the provider's one-time code, or Winche's) are refused. Off: only users who turned on two-step are asked."
        onChange={(e) => set({ requireSecondStep: e.currentTarget.checked })} />
      {value.kind === "oidc" && (
        <TextInput label="acr values that mean a second step" placeholder="e.g. 2"
          description="What the provider puts in acr after a one-time code, separated by commas. An amr of otp or mfa counts anyway."
          value={(value.secondStepAcrValues ?? []).join(", ")} onChange={(e) => set({ secondStepAcrValues: list(e.currentTarget.value) })} />
      )}
      <Switch label="Use the provider's user id as the Winche id" checked={value.useSubjectAsUid}
        onChange={(e) => set({ useSubjectAsUid: e.currentTarget.checked })} />
      {value.kind === "oidc" && <KeycloakSyncFields value={value.keycloakSync} onChange={(k) => set({ keycloakSync: k })} {...sync} />}
    </>
  );
}

/** Adds a sign-in provider in a dialog: its settings, a reason, saved as a new version of the sign-in settings. */
function AddProviderDialog({ settings, onClose }: { settings: WincheAuthSettings; onClose: () => void }) {
  const authApi = useAuthApi();
  const qc = useQueryClient();
  const [value, setValue] = useState<SignInProviderSettings>({
    name: settings.providers.some((p) => p.name === "google") ? "" : "google", kind: "google", displayName: null, authority: null, audiences: [],
    useSubjectAsUid: false, copiedClaims: [], requireSecondStep: false, secondStepAcrValues: [],
  });
  const [reason, setReason] = useState("");
  const [syncSecret, setSyncSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const next = { ...settings, providers: [...settings.providers, value] };
      if (value.keycloakSync && syncSecret) await authApi.saveSignInSettings(next, null, reason.trim(), { [value.name]: syncSecret });
      else await authApi.saveSignInSettings(next, null, reason.trim());
      for (const key of ["signin-settings", "settings-history", "app-auth-config"]) await qc.invalidateQueries({ queryKey: [key] });
      onClose();
    } catch (e) { setError(errorWithList(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} fz={18}>Add a sign-in provider</Text>}>
      <Stack gap="md">
        <ProviderFields value={value} onChange={setValue} sync={{ secret: syncSecret, onSecret: setSyncSecret, secretSet: false }} />
        {error && <Alert color="red" p="xs" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
        <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!reason.trim() || !value.name.trim()}>Add provider</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Authentication → Sign-in method: how your apps' users sign in, as a list of providers (email and password, links,
 * guests, Google, Apple, OpenID Connect), each opening to its settings. Two-step sign-in belongs to email and
 * password: a provider's own second step counts for the others.
 */
export function SignInMethodView() {
  const sc = useSignInCards();
  const [adding, setAdding] = useState(false);
  if (sc.saved.isLoading) return <Loader size="sm" />;
  if (sc.saved.isError || !sc.saved.data) return <Alert color="red">Couldn't load the sign-in settings: {errorMessage(sc.saved.error)}</Alert>;
  if (!sc.data) return <Alert color="gray">{(sc.saved.data as { whyReadOnly: string }).whyReadOnly}</Alert>;
  const s = sc.data.settings;
  const d = sc.draft;
  const toggle = (id: string, start?: (d: WincheAuthSettings) => WincheAuthSettings) =>
    sc.editable ? () => (sc.editing === id ? sc.cancel() : sc.edit(id, start)) : undefined;
  const row = (id: string) => ({ open: sc.editing === id, onSave: sc.save, onCancel: sc.cancel });
  const ep = d?.emailPassword;
  const tw = d?.twoStep;
  const setProvider = (i: number, p: Partial<SignInProviderSettings>) => d && sc.set({ providers: d.providers.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  return (
    <CardsPage intro={versionLine(sc.data)} history={<HistoryButton subtitle="Authentication settings"><HistorySection /></HistoryButton>}>
      {!sc.editable && <Alert color="gray">Read-only. {sc.data.whyReadOnly}</Alert>}
      <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
        <Group justify="space-between" align="flex-start" px={24} py={18} wrap="wrap" gap="md">
          <div>
            <Text fw={600} fz={16}>Sign-in providers</Text>
            <Text size="sm" c="var(--w-faint)" mt={4}>How your apps' users sign in. Each becomes a Winche Auth user. Select one to set it up.</Text>
          </div>
          {sc.editable && sc.editing === null && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add new provider</Button>
          )}
        </Group>
        <div className="winche-provider-head"><span>Provider</span><span>Status</span><span /></div>

        <ProviderRow testId="method-emailPassword" logo="@" name="Email and password"
          sub={s.emailPassword.enabled ? `Shortest password ${s.emailPassword.minLength}${s.twoStep.enabled ? " · two-step available" : ""}` : undefined}
          on={s.emailPassword.enabled} onToggle={toggle("emailPassword")} {...row("emailPassword")}
          form={ep && tw && (
            <>
              <Switch label="Enable" description="Users sign up and sign in with an email address and a password." checked={ep.enabled}
                onChange={(e) => sc.set({ emailPassword: { ...ep, enabled: e.currentTarget.checked } })} />
              <Group align="flex-end" wrap="wrap">
                <NumberInput label="Shortest password" w={180} min={6} max={128} disabled={!ep.enabled} value={ep.minLength}
                  onChange={(v) => sc.set({ emailPassword: { ...ep, minLength: num(v) } })} />
                <Switch label="Users must verify their email first" disabled={!ep.enabled} checked={ep.requireVerifiedEmail}
                  onChange={(e) => sc.set({ emailPassword: { ...ep, requireVerifiedEmail: e.currentTarget.checked } })} />
              </Group>
              <Switch label="Users can turn on two-step sign-in" checked={tw.enabled} onChange={(e) => sc.set({ twoStep: { ...tw, enabled: e.currentTarget.checked } })}
                description="An authenticator app. Every sign-in to their account then needs a second step: its code, or a provider's own (Google or Keycloak asking for a code counts, so nobody is asked twice). Tokens carry mfa: true." />
              {tw.enabled ? (
                <Group wrap="wrap">
                  <TextInput label="Name in authenticator apps" placeholder="The app's name" value={tw.issuer ?? ""}
                    onChange={(e) => sc.set({ twoStep: { ...tw, issuer: e.currentTarget.value || null } })} />
                  <NumberInput label="Recovery codes" w={160} min={1} max={50} value={tw.recoveryCodes}
                    onChange={(v) => sc.set({ twoStep: { ...tw, recoveryCodes: num(v) } })} />
                </Group>
              ) : <Text size="xs" c="dimmed">Users who already use it keep being asked for their code.</Text>}
            </>
          )} />

        <ProviderRow testId="method-emailLink" logo="✉" name="Email link" sub={s.emailLink.enabled ? s.emailLink.linkUrl : "No password: a one-time link by email"}
          on={s.emailLink.enabled} onToggle={toggle("emailLink")} {...row("emailLink")}
          form={d && (
            <>
              <Switch label="Enable" description="Needs email (Settings → Emails to users)." checked={d.emailLink.enabled}
                onChange={(e) => sc.set({ emailLink: { ...d.emailLink, enabled: e.currentTarget.checked } })} />
              <TextInput label="Link address" description="The app's page or deep link that finishes the sign-in." placeholder="https://app.example.com/finish-sign-in"
                disabled={!d.emailLink.enabled} value={d.emailLink.linkUrl} onChange={(e) => sc.set({ emailLink: { ...d.emailLink, linkUrl: e.currentTarget.value } })} />
            </>
          )} />

        <ProviderRow testId="method-anonymous" logo="?" name="Anonymous (guests)" sub="A guest account the user can later turn into a full one"
          on={s.anonymous} onToggle={toggle("anonymous")} {...row("anonymous")}
          form={d && <Switch label="Users can start as guests" checked={d.anonymous} onChange={(e) => sc.set({ anonymous: e.currentTarget.checked })} />} />

        {(sc.editing?.startsWith("provider:") && d ? d.providers : s.providers).map((p, i) => {
          const id = `provider:${i}`;
          const editingThis = sc.editing === id;
          const shown = editingThis && d ? d.providers[i] : s.providers[i] ?? p;
          return (
            <ProviderRow key={id} testId="signin-provider" logo={PROVIDER_LOGO[shown.kind] ?? "ID"}
              name={shown.displayName || shown.name || "New provider"}
              sub={[shown.kind === "oidc" ? "OpenID Connect" : shown.kind === "google" ? "Google" : "Apple",
                shown.requireSecondStep ? "second step required" : null].filter(Boolean).join(" · ")}
              on open={editingThis} onToggle={toggle(id)} onSave={sc.save} onCancel={sc.cancel}
              form={editingThis && d && (
                <>
                  <ProviderFields value={shown} onChange={(p) => setProvider(i, p)} sync={sc.syncSecret(shown.name)} />
                  {i < s.providers.length && (
                    <Group justify="flex-end">
                      <Button size="xs" variant="subtle" color="red" onClick={() => sc.set({ providers: d.providers.filter((_, j) => j !== i) })}>
                        Remove (on Save)
                      </Button>
                    </Group>
                  )}
                </>
              )} />
          );
        })}
      </Paper>
      {adding && <AddProviderDialog settings={s} onClose={() => setAdding(false)} />}
      {s.providers.length > 0 && <KeycloakSyncView />}
    </CardsPage>
  );
}

/**
 * Authentication → Settings: sessions, account protection, emails to users and signing keys, each
 * a card showing what's set and edited in place.
 */
export function AuthSettingsCards({ wincheAuth }: { wincheAuth: boolean }) {
  const sc = useSignInCards();
  const authApi = useAuthApi();
  const config = useQuery({ queryKey: ["app-auth-config", "server-email"], queryFn: authApi.appAuthConfig, staleTime: 60_000, enabled: wincheAuth });
  const serverEmail = config.data?.serverEmail ?? null;
  if (!wincheAuth) return <CardsPage><Alert color="gray">Winche Auth isn't in this app: its users are those of the providers it trusts (Trusted issuers).</Alert></CardsPage>;
  if (sc.saved.isLoading) return <Loader size="sm" />;
  if (sc.saved.isError || !sc.saved.data) return <Alert color="red">Couldn't load the sign-in settings: {errorMessage(sc.saved.error)}</Alert>;
  if (!sc.data) return <CardsPage><Alert color="gray">{(sc.saved.data as { whyReadOnly: string }).whyReadOnly}</Alert></CardsPage>;
  const s = sc.data.settings;
  const d = sc.draft;
  const e = s.email;
  return (
    <CardsPage intro={versionLine(sc.data)} history={<HistoryButton subtitle="Authentication settings"><HistorySection /></HistoryButton>}>
      {!sc.editable && <Alert color="gray">Read-only. {sc.data.whyReadOnly}</Alert>}
      <EditCard title="Sessions" description="How long a sign-in lasts. Shorter access tokens pick up changes (disabled users, new claims) sooner." {...sc.card("sessions")}
        rows={[{ label: "Access tokens last", value: `${s.sessions.accessTokenMinutes} minutes` }, { label: "Users stay signed in", value: `${s.sessions.refreshTokenDays} days` }]}
        form={d && (
          <>
            <EditRow label="Access tokens last" hint="1 minute to 24 hours.">
              <NumberInput aria-label="Access tokens last (minutes)" w={180} min={1} max={1440} rightSection={<Text size="xs" c="dimmed" pr={8}>min</Text>}
                value={d.sessions.accessTokenMinutes} onChange={(v) => sc.set({ sessions: { ...d.sessions, accessTokenMinutes: num(v) } })} />
            </EditRow>
            <EditRow label="Users stay signed in" hint="From their last use.">
              <NumberInput aria-label="Users stay signed in (days)" w={180} min={1} max={3650} rightSection={<Text size="xs" c="dimmed" pr={8}>days</Text>}
                value={d.sessions.refreshTokenDays} onChange={(v) => sc.set({ sessions: { ...d.sessions, refreshTokenDays: num(v) } })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Account protection" description="After too many wrong passwords or codes, the account waits before trying again." {...sc.card("lockout")}
        rows={[{ label: "Lock an account after", value: `${s.lockout.maxFailedSignIns} failed sign-ins` }, { label: "Locked for", value: `${s.lockout.lockoutMinutes} minutes` }]}
        form={d && (
          <>
            <EditRow label="Lock after failed tries">
              <NumberInput aria-label="Lock after failed tries" w={180} min={1} max={100} value={d.lockout.maxFailedSignIns}
                onChange={(v) => sc.set({ lockout: { ...d.lockout, maxFailedSignIns: num(v) } })} />
            </EditRow>
            <EditRow label="Locked for">
              <NumberInput aria-label="Locked for (minutes)" w={180} min={1} rightSection={<Text size="xs" c="dimmed" pr={8}>min</Text>} value={d.lockout.lockoutMinutes}
                onChange={(v) => sc.set({ lockout: { ...d.lockout, lockoutMinutes: num(v) } })} />
            </EditRow>
          </>
        )} />

      <EditCard title="Emails to users" description="Verification, password reset and sign-in link emails: who they're from and how they're sent." {...sc.card("email")}
        rows={e.enabled ? [
          { label: "App name", value: e.appName || "—" },
          { label: "Sent", value: e.sender === "smtp" && e.smtp ? <code>{e.smtp.host}:{e.smtp.port}</code> : e.sender === "logLinks" ? "Only logged (development)" : serverEmail ? `Through the server's email (${serverEmail})` : "By the app" },
          ...(e.sender === "smtp" && e.smtp ? [{ label: "From", value: e.smtp.fromName ? `${e.smtp.fromName} <${e.smtp.fromAddress}>` : e.smtp.fromAddress },
            { label: "Password", value: sc.data.smtpPassword ? `Set ${when(sc.data.smtpPassword.setAt)}` : <OnOff on={false} offLabel="Not set" /> }] : []),
          { label: "Verify link on sign-up", value: <OnOff on={e.sendVerificationOnSignUp} /> },
        ] : [{ label: "Winche Auth sends email", value: <OnOff on={false} /> }]}
        form={d && (
          <div style={{ padding: "0 24px 16px" }}>
            <EmailPart draft={d} set={sc.set} editable passwordSet={sc.data.smtpPassword} secretsAvailable={sc.data.secretsAvailable}
              password={sc.smtpPassword} setPassword={sc.setSmtpPassword} />
          </div>
        )} />

      <AuthSettingsView />

    </CardsPage>
  );
}

type PartProps = { draft: WincheAuthSettings; set: (p: Partial<WincheAuthSettings>) => void; editable: boolean };

/** A group of fields inside a form. */
function Card({ title, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Text fw={600} size="sm">{title}</Text>
        {children}
      </Stack>
    </Paper>
  );
}

function EmailPart({ draft, set, editable, passwordSet, secretsAvailable, password, setPassword }: PartProps & {
  passwordSet: { setAt: string; setBy: string | null } | null; secretsAvailable: boolean; password: string; setPassword: (s: string) => void;
}) {
  const authApi = useAuthApi();
  const config = useQuery({ queryKey: ["app-auth-config", "server-email"], queryFn: authApi.appAuthConfig, staleTime: 60_000 });
  const serverEmail = config.data?.serverEmail ?? null;
  const e = draft.email;
  const setE = (p: Partial<WincheAuthSettings["email"]>) => set({ email: { ...e, ...p } });
  const smtp = e.smtp ?? NEW_SMTP;
  const setSmtp = (p: Partial<SmtpSettings>) => setE({ smtp: { ...smtp, ...p } });
  const [replacing, setReplacing] = useState(false);
  const [to, setTo] = useState("");
  const [test, setTest] = useState<{ ok: boolean; text: string } | "sending" | null>(null);

  const sendTest = async () => {
    setTest("sending");
    try {
      const r = await authApi.testSignInEmail({ ...draft, email: { ...e, smtp } }, password || null, to.trim() || null);
      setTest({ ok: true, text: `Sent to ${r.sentTo}. Check that it arrived (and not in spam).` });
    } catch (err) {
      setTest({ ok: false, text: errorMessage(err) });
    }
  };

  return (
    <Stack gap="md">
      <Card title="Sending email">
        <Switch label="Winche Auth sends email" disabled={!editable} checked={e.enabled} onChange={(ev) => setE({ enabled: ev.currentTarget.checked })} />
        {e.enabled && (
          <>
            <Group grow wrap="wrap">
              <TextInput label="App name" description="In subjects and messages" disabled={!editable} value={e.appName} onChange={(ev) => setE({ appName: ev.currentTarget.value })} />
              <TextInput label="Action page (optional)" description="Where links open; Winche Auth's built-in page when empty" placeholder="https://app.example.com/auth-action"
                disabled={!editable} value={e.actionUrl ?? ""} onChange={(ev) => setE({ actionUrl: ev.currentTarget.value || null })} />
            </Group>
            <Switch label="Send a verify link when someone signs up" disabled={!editable} checked={e.sendVerificationOnSignUp}
              onChange={(ev) => setE({ sendVerificationOnSignUp: ev.currentTarget.checked })} />
            <Group wrap="wrap">
              <NumberInput label="Emails per address per hour" w={200} min={1} max={100} disabled={!editable} value={e.maxPerAddressPerHour}
                onChange={(v) => setE({ maxPerAddressPerHour: num(v) })} />
              <NumberInput label="Verify links last (hours)" w={200} min={1} max={720} disabled={!editable} value={e.verifyLinkHours}
                onChange={(v) => setE({ verifyLinkHours: num(v) })} />
              <NumberInput label="Reset links last (hours)" w={200} min={1} max={72} disabled={!editable} value={e.resetLinkHours}
                onChange={(v) => setE({ resetLinkHours: num(v) })} />
            </Group>
          </>
        )}
      </Card>
      {e.enabled && (
        <Card title="How it's sent">
          <SegmentedControl aria-label="Sender" w="fit-content" disabled={!editable} value={e.sender}
            data={[...(serverEmail ? [{ value: "app", label: "The server's email" }] : []), { value: "smtp", label: "SMTP server" }, { value: "logLinks", label: "Log only" }]}
            onChange={(v) => setE({ sender: v as WincheAuthSettings["email"]["sender"], smtp: v === "smtp" ? smtp : e.smtp })} />
          {e.sender === "app" && (serverEmail
            ? <Alert color="teal">Sent through the server's own email: {serverEmail}. Nothing to set up here; it's from your app name.</Alert>
            : <Alert color="gray">Choose how emails are sent: an SMTP server, or only logged for now.</Alert>)}
          {e.sender === "logLinks" && <Alert color="yellow">Nothing is sent: links go to the server's log. For local development only.</Alert>}
          {e.sender === "smtp" && (
            <Stack gap="sm">
              <Text size="xs" c="dimmed">Any email service with SMTP works: Amazon SES, Postmark, SendGrid, Microsoft 365, Gmail…</Text>
              <Group grow wrap="wrap" align="flex-end">
                <TextInput label="Server" placeholder="email-smtp.eu-west-2.amazonaws.com" disabled={!editable} value={smtp.host} onChange={(ev) => setSmtp({ host: ev.currentTarget.value })} />
                <NumberInput label="Port" min={1} max={65535} disabled={!editable} value={smtp.port} onChange={(v) => setSmtp({ port: num(v) })} />
                <Select label="Security" disabled={!editable} allowDeselect={false} value={smtp.security}
                  data={[{ value: "startTls", label: "STARTTLS (587)" }, { value: "tls", label: "TLS (465)" }, { value: "none", label: "None (local only)" }]}
                  onChange={(v) => setSmtp({ security: (v ?? "startTls") as SmtpSettings["security"] })} />
              </Group>
              <Group grow wrap="wrap" align="flex-end">
                <TextInput label="Username" disabled={!editable} value={smtp.username ?? ""} onChange={(ev) => setSmtp({ username: ev.currentTarget.value || null })} />
                {passwordSet && !replacing ? (
                  <Group gap="xs" data-testid="smtp-password-set">
                    <Text size="sm">Password: <Badge variant="light" color="teal" tt="none">set</Badge></Text>
                    <Text size="xs" c="dimmed">{when(passwordSet.setAt)} · never shown</Text>
                    {editable && <Button size="xs" variant="subtle" onClick={() => setReplacing(true)}>Replace</Button>}
                  </Group>
                ) : (
                  <PasswordInput label="Password" description="Saved encrypted; it can't be read back." disabled={!editable || !secretsAvailable}
                    value={password} onChange={(ev) => setPassword(ev.currentTarget.value)} />
                )}
              </Group>
              <Group grow wrap="wrap">
                <TextInput label="From address" placeholder="no-reply@example.com" disabled={!editable} value={smtp.fromAddress} onChange={(ev) => setSmtp({ fromAddress: ev.currentTarget.value })} />
                <TextInput label="From name (optional)" placeholder={e.appName || "The app's name"} disabled={!editable} value={smtp.fromName ?? ""}
                  onChange={(ev) => setSmtp({ fromName: ev.currentTarget.value || null })} />
              </Group>
              {!secretsAvailable && <Alert color="yellow">Passwords can't be saved: the app needs a master key (WincheConfigOptions.MasterKey).</Alert>}
              <Group gap="xs" align="flex-end">
                <TextInput label="Send a test to" placeholder="Your address" value={to} onChange={(ev) => setTo(ev.currentTarget.value)} />
                <Button variant="default" loading={test === "sending"} disabled={!smtp.host || !smtp.fromAddress} onClick={sendTest}>Send test email</Button>
              </Group>
              {test && test !== "sending" && <Alert color={test.ok ? "teal" : "red"} data-testid="smtp-test">{test.text}</Alert>}
            </Stack>
          )}
        </Card>
      )}
    </Stack>
  );
}
