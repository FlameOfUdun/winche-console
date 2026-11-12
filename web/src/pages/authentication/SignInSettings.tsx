import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Group, Loader, NumberInput, Paper, PasswordInput, SegmentedControl, Select, Stack, Switch, Text, TextInput, Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage, errorWithList, type SignInProviderSettings, type SmtpSettings, type WincheAuthSettings } from "../../api/appAuth";
import { when } from "./UsersView";

export type SignInPart = "methods" | "security" | "email";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** A number field's value; empty stays empty while the user types (the server refuses it if saved). */
const num = (v: string | number) => (v === "" ? ("" as unknown as number) : Number(v));
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const NEW_SMTP: SmtpSettings = { host: "", port: 587, security: "startTls", username: null, fromAddress: "", fromName: null };

/** The draft of Winche Auth's settings, shared by the three Settings sections so moving between them keeps changes. */
export function useSignInDraft() {
  const saved = useQuery({ queryKey: ["signin-settings"], queryFn: api.signInSettings });
  const [draft, setDraft] = useState<WincheAuthSettings | null>(null);
  const [smtpPassword, setSmtpPassword] = useState("");
  useEffect(() => {
    if (saved.data?.available) setDraft(clone(saved.data.settings));
  }, [saved.data]);
  const dirty = useMemo(() => !!saved.data?.available && !!draft &&
    (JSON.stringify(saved.data.settings) !== JSON.stringify(draft) || smtpPassword !== ""), [saved.data, draft, smtpPassword]);
  const discard = () => { if (saved.data?.available) setDraft(clone(saved.data.settings)); setSmtpPassword(""); };
  return { saved, draft, setDraft, smtpPassword, setSmtpPassword, dirty, discard };
}

export type SignInDraft = ReturnType<typeof useSignInDraft>;

/** Settings → Sign-in methods / Sessions and security / Email: Winche Auth's own settings, saved together with a reason. */
export function SignInSettings({ part, state }: { part: SignInPart; state: SignInDraft }) {
  const qc = useQueryClient();
  const { saved, draft, setDraft, smtpPassword, setSmtpPassword, dirty, discard } = state;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (saved.isLoading) return <Loader size="sm" />;
  if (saved.isError || !saved.data) return <Alert color="red">Couldn't load the sign-in settings: {errorMessage(saved.error)}</Alert>;
  const d = saved.data;
  if (!d.available) return <Alert color="gray">{d.whyReadOnly}</Alert>;
  if (!draft) return <Loader size="sm" />;
  const editable = d.editable;
  const set = (patch: Partial<WincheAuthSettings>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.saveSignInSettings(draft, smtpPassword || null, reason.trim());
      setReason("");
      setSmtpPassword("");
      setNotice(`Saved as version ${v.number}. It applies to every server within seconds.`);
      for (const key of ["signin-settings", "settings-history", "app-auth-config"]) await qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setError(errorWithList(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed" data-testid="signin-source">
        {d.source === "console" && d.version
          ? `Saved in the console: version ${d.version.number}, ${when(d.version.at)}${d.version.by ? ` by ${d.version.by}` : ""}${d.version.reason ? ` — ${d.version.reason}` : ""}.`
          : "These are the starting values from the app's code."}
      </Text>
      {!editable && <Alert color="gray">Read-only. {d.whyReadOnly}</Alert>}

      {part === "methods" && <Methods draft={draft} set={set} editable={editable} />}
      {part === "security" && <Security draft={draft} set={set} editable={editable} />}
      {part === "email" && (
        <EmailPart draft={draft} set={set} editable={editable} appSender={d.appSender} passwordSet={d.smtpPassword}
          secretsAvailable={d.secretsAvailable} password={smtpPassword} setPassword={setSmtpPassword} />
      )}

      {editable && (dirty || error || notice) && (
        <Paper withBorder p="sm" data-testid="signin-save-bar" style={{ borderColor: dirty ? "var(--mantine-color-blue-5)" : undefined }}>
          <Stack gap="xs">
            {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
            {notice && !dirty && <Alert color="teal">{notice}</Alert>}
            {dirty && (
              <Group gap="xs" wrap="wrap">
                <TextInput placeholder="Why are you making this change?" aria-label="Reason for the change" style={{ flex: "1 1 280px" }}
                  value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
                <Button loading={busy} disabled={!reason.trim()} onClick={save}>Save changes</Button>
                <Button variant="subtle" disabled={busy} onClick={() => { discard(); setError(null); }}>Discard</Button>
              </Group>
            )}
            {dirty && <Text size="xs" c="dimmed">Changes on the other Winche Auth sections are saved with these.</Text>}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

type PartProps = { draft: WincheAuthSettings; set: (p: Partial<WincheAuthSettings>) => void; editable: boolean };

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <div>
          <Text fw={600}>{title}</Text>
          {hint && <Text size="xs" c="dimmed">{hint}</Text>}
        </div>
        {children}
      </Stack>
    </Paper>
  );
}

function Methods({ draft, set, editable }: PartProps) {
  const ep = draft.emailPassword;
  const setProvider = (i: number, p: Partial<SignInProviderSettings>) =>
    set({ providers: draft.providers.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <Stack gap="md">
      <div>
        <Title order={4}>Sign-in methods</Title>
        <Text size="sm" c="dimmed">How the app's users can sign in. Turning a method off stops new sign-ins with it; signed-in users stay signed in.</Text>
      </div>
      <Card title="Email and password">
        <Switch label="Users can sign up and sign in with an email and password" disabled={!editable} checked={ep.enabled}
          onChange={(e) => set({ emailPassword: { ...ep, enabled: e.currentTarget.checked } })} />
        {ep.enabled && (
          <Group align="flex-end" wrap="wrap">
            <NumberInput label="Shortest password" w={160} min={6} max={128} disabled={!editable} value={ep.minLength}
              onChange={(v) => set({ emailPassword: { ...ep, minLength: num(v) } })} />
            <Switch label="Users must verify their email first" disabled={!editable} checked={ep.requireVerifiedEmail}
              onChange={(e) => set({ emailPassword: { ...ep, requireVerifiedEmail: e.currentTarget.checked } })} />
          </Group>
        )}
      </Card>
      <Card title="Sign-in link by email" hint="No password: the user gets a one-time link. Needs email (Settings → Email).">
        <Switch label="Users can sign in with a link" disabled={!editable} checked={draft.emailLink.enabled}
          onChange={(e) => set({ emailLink: { ...draft.emailLink, enabled: e.currentTarget.checked } })} />
        {draft.emailLink.enabled && (
          <TextInput label="Link address" description="The app's page or deep link that finishes the sign-in." placeholder="https://app.example.com/finish-sign-in"
            disabled={!editable} value={draft.emailLink.linkUrl} onChange={(e) => set({ emailLink: { ...draft.emailLink, linkUrl: e.currentTarget.value } })} />
        )}
      </Card>
      <Card title="Guests" hint="Anonymous accounts the user can later turn into a full one.">
        <Switch label="Users can start as guests" disabled={!editable} checked={draft.anonymous} onChange={(e) => set({ anonymous: e.currentTarget.checked })} />
      </Card>
      <Card title="Google, Apple and other providers" hint="The app signs in with the provider and hands Winche Auth the ID token.">
        {draft.providers.length === 0 && <Text size="sm" c="dimmed">None yet.</Text>}
        {draft.providers.map((p, i) => (
          <Paper key={i} withBorder p="sm" data-testid="signin-provider">
            <Stack gap="xs">
              <Group grow wrap="wrap" align="flex-end">
                <Select label="Kind" disabled={!editable} allowDeselect={false} value={p.kind}
                  data={[{ value: "google", label: "Google" }, { value: "apple", label: "Apple" }, { value: "oidc", label: "OpenID Connect" }]}
                  onChange={(v) => setProvider(i, { kind: (v ?? "oidc") as SignInProviderSettings["kind"] })} />
                <TextInput label="Name" description="In the app's code and users' records" disabled={!editable} value={p.name}
                  onChange={(e) => setProvider(i, { name: e.currentTarget.value })} />
                <TextInput label="Shown as" disabled={!editable} value={p.displayName ?? ""} onChange={(e) => setProvider(i, { displayName: e.currentTarget.value || null })} />
              </Group>
              {p.kind === "oidc" && (
                <TextInput label="Address" placeholder="https://login.example.com" disabled={!editable} value={p.authority ?? ""}
                  onChange={(e) => setProvider(i, { authority: e.currentTarget.value || null })} />
              )}
              <TextInput label="Client ids" description="The app's ids at the provider, separated by commas. Tokens must be for one of them."
                disabled={!editable} value={p.audiences.join(", ")} onChange={(e) => setProvider(i, { audiences: list(e.currentTarget.value) })} />
              <TextInput label="Claims copied to the user" description="From the provider's token into custom claims at each sign-in, e.g. role, org."
                disabled={!editable} value={p.copiedClaims.join(", ")} onChange={(e) => setProvider(i, { copiedClaims: list(e.currentTarget.value) })} />
              <Group justify="space-between">
                <Switch label="Use the provider's user id as the Winche id" disabled={!editable} checked={p.useSubjectAsUid}
                  onChange={(e) => setProvider(i, { useSubjectAsUid: e.currentTarget.checked })} />
                {editable && <Button size="xs" variant="subtle" color="red" onClick={() => set({ providers: draft.providers.filter((_, j) => j !== i) })}>Remove</Button>}
              </Group>
            </Stack>
          </Paper>
        ))}
        {editable && (
          <Button size="xs" variant="default" w="fit-content" onClick={() => set({
            providers: [...draft.providers, { name: draft.providers.some((p) => p.name === "google") ? "" : "google", kind: "google", displayName: null, authority: null, audiences: [], useSubjectAsUid: false, copiedClaims: [] }],
          })}>Add provider</Button>
        )}
      </Card>
    </Stack>
  );
}

function Security({ draft, set, editable }: PartProps) {
  const t = draft.twoStep;
  return (
    <Stack gap="md">
      <div>
        <Title order={4}>Sessions and security</Title>
        <Text size="sm" c="dimmed">How long sign-ins last, when accounts lock, and two-step sign-in.</Text>
      </div>
      <Card title="Sessions" hint="Shorter access tokens pick up changes (disabled users, new claims) sooner.">
        <Group wrap="wrap">
          <NumberInput label="Access tokens last (minutes)" w={220} min={1} max={1440} disabled={!editable} value={draft.sessions.accessTokenMinutes}
            onChange={(v) => set({ sessions: { ...draft.sessions, accessTokenMinutes: num(v) } })} />
          <NumberInput label="Users stay signed in (days)" w={220} min={1} max={3650} disabled={!editable} value={draft.sessions.refreshTokenDays}
            onChange={(v) => set({ sessions: { ...draft.sessions, refreshTokenDays: num(v) } })} />
        </Group>
      </Card>
      <Card title="Lockout" hint="After too many wrong passwords or codes, the account waits before trying again.">
        <Group wrap="wrap">
          <NumberInput label="Lock after failed tries" w={220} min={1} max={100} disabled={!editable} value={draft.lockout.maxFailedSignIns}
            onChange={(v) => set({ lockout: { ...draft.lockout, maxFailedSignIns: num(v) } })} />
          <NumberInput label="For (minutes)" w={220} min={1} disabled={!editable} value={draft.lockout.lockoutMinutes}
            onChange={(v) => set({ lockout: { ...draft.lockout, lockoutMinutes: num(v) } })} />
        </Group>
      </Card>
      <Card title="Two-step sign-in" hint="Users may add an authenticator app; their tokens then carry mfa: true, which rules can require.">
        <Switch label="Users can turn on two-step sign-in" disabled={!editable} checked={t.enabled} onChange={(e) => set({ twoStep: { ...t, enabled: e.currentTarget.checked } })} />
        {t.enabled && (
          <Group wrap="wrap">
            <TextInput label="Name in authenticator apps" placeholder="The app's name" disabled={!editable} value={t.issuer ?? ""}
              onChange={(e) => set({ twoStep: { ...t, issuer: e.currentTarget.value || null } })} />
            <NumberInput label="Recovery codes" w={160} min={1} max={50} disabled={!editable} value={t.recoveryCodes}
              onChange={(v) => set({ twoStep: { ...t, recoveryCodes: num(v) } })} />
          </Group>
        )}
        {!t.enabled && <Text size="xs" c="dimmed">Users who already use it keep being asked for their code.</Text>}
      </Card>
    </Stack>
  );
}

function EmailPart({ draft, set, editable, appSender, passwordSet, secretsAvailable, password, setPassword }: PartProps & {
  appSender: boolean; passwordSet: { setAt: string; setBy: string | null } | null; secretsAvailable: boolean; password: string; setPassword: (s: string) => void;
}) {
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
      const r = await api.testSignInEmail({ ...draft, email: { ...e, smtp } }, password || null, to.trim() || null);
      setTest({ ok: true, text: `Sent to ${r.sentTo}. Check that it arrived (and not in spam).` });
    } catch (err) {
      setTest({ ok: false, text: errorMessage(err) });
    }
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>Email</Title>
        <Text size="sm" c="dimmed">Verify-email, password-reset and sign-in-link messages. Their wording is in Email templates.</Text>
      </div>
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
            data={[{ value: "smtp", label: "SMTP server" }, { value: "app", label: "The app's code" }, { value: "logLinks", label: "Log only" }]}
            onChange={(v) => setE({ sender: v as WincheAuthSettings["email"]["sender"], smtp: v === "smtp" ? smtp : e.smtp })} />
          {e.sender === "app" && (
            appSender
              ? <Text size="sm" c="dimmed">The app's own sender (an IAuthEmailSender in its code) sends them.</Text>
              : <Alert color="yellow">The app's code has no email sender: choose SMTP server, or emails will fail.</Alert>
          )}
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
