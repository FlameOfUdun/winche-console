import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Code, CopyButton, Group, Paper, Stack, Switch, TagsInput, Text, TextInput, Tooltip } from "@mantine/core";
import { SecretInput } from "../../components/SecretInput";
import { IconCheck, IconCopy, IconPlayerPlay } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorWithList } from "../../api/appAuth";
import type { ConsoleSignIn, SignInTestResult } from "../../api/server";
import { surface } from "../../theme";

const mono = { input: { fontFamily: "var(--mantine-font-family-monospace)" } };

/**
 * The identity provider people sign in to the console with: where it is, the console's client there, how its groups
 * map to console roles, and a test sign-in with the settings as they are on screen.
 */
export function IdentityProviderForm({ value, onChange, secretSlot, unsavedSecret, callbackUrl, logoutUrl }: {
  value: ConsoleSignIn;
  onChange: (v: ConsoleSignIn) => void;
  /** Where the client secret is set (a password row, or a field in the setup). */
  secretSlot: React.ReactNode;
  /** A secret typed but not saved yet, for the test. */
  unsavedSecret?: string | null;
  /** The address to register at the provider, once known. */
  callbackUrl?: string | null;
  /** Where the provider tells the console someone signed out (back-channel logout). */
  logoutUrl?: string | null;
}) {
  const set = (patch: Partial<ConsoleSignIn>) => onChange({ ...value, ...patch });
  const shownCallback = callbackUrl;
  return (
    <Stack gap="md">
      <Group grow align="flex-end" wrap="wrap">
        <TextInput label="Issuer" placeholder="https://login.example.com/realms/staff" styles={mono} value={value.issuer ?? ""}
          onChange={(e) => set({ issuer: e.currentTarget.value || null })} />
        <TextInput label="Client ID" placeholder="winche-console" styles={mono} value={value.clientId ?? ""}
          onChange={(e) => set({ clientId: e.currentTarget.value || null })} />
      </Group>
      {secretSlot}
      <RegisterAddresses callbackUrl={shownCallback} logoutUrl={logoutUrl} />
      <Group grow align="flex-end" wrap="wrap">
        <TextInput label="Button" placeholder="Sign in with your organization" value={value.buttonLabel ?? ""}
          onChange={(e) => set({ buttonLabel: e.currentTarget.value || null })} />
        <TextInput label="Scopes" styles={mono} value={value.scopes} onChange={(e) => set({ scopes: e.currentTarget.value })} />
      </Group>

      <Paper withBorder radius="md" p="md" bg={surface.subtle}>
        <Stack gap="sm">
          <Text fw={600} size="sm">Roles from the provider</Text>
          <TextInput label="Claim with groups or roles" placeholder="groups (or realm_access.roles); empty: server admins are made here" styles={mono}
            value={value.roleClaim ?? ""} onChange={(e) => set({ roleClaim: e.currentTarget.value || null })} />
          {value.roleClaim && (
            <>
              <TagsInput label="Server admin" placeholder="e.g. winche-admins" value={value.adminValues} onChange={(v) => set({ adminValues: v })} />
              <Text size="xs" c={surface.muted}>Checked at every sign-in. What people do in a project is that project's members list.</Text>
            </>
          )}
        </Stack>
      </Paper>

      <Stack gap="xs">
        <Switch label="Make an account for people the console doesn't know yet" checked={value.createAccounts}
          onChange={(e) => set({ createAccounts: e.currentTarget.checked })} />
        <Switch label="The provider's two-step sign-in is enough" checked={value.trustProviderTwoStep}
          onChange={(e) => set({ trustProviderTwoStep: e.currentTarget.checked })} />
      </Stack>

      <TestSignIn value={value} unsavedSecret={unsavedSecret} />
    </Stack>
  );
}

/** Test sign-in with the settings as they are on screen: a window to the provider, and what came back. */
export function TestSignIn({ value, unsavedSecret }: { value: ConsoleSignIn; unsavedSecret?: string | null }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SignInTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || (e.data as { type?: string })?.type !== "winche-oidc-test") return;
      setResult(e.data as SignInTestResult);
      setTesting(false);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  const test = async () => {
    setError(null); setResult(null);
    // Opened now, while the click still counts, so it isn't blocked; pointed at the provider once the address is back.
    popup.current = window.open("about:blank", "winche-oidc-test", "width=520,height=700");
    setTesting(true);
    try {
      const r = await api.testConsoleSignIn(value, unsavedSecret ?? null);
      const url = new URL(r.url, document.baseURI).toString();
      if (popup.current) popup.current.location.href = url; else window.open(url, "winche-oidc-test", "width=520,height=700");
    } catch (e) {
      popup.current?.close();
      setError(errorWithList(e));
      setTesting(false);
    }
  };

  return (
    <Stack gap="sm">
      <Group>
        <Button variant="default" leftSection={<IconPlayerPlay size={15} />} loading={testing} onClick={test}
          disabled={!value.issuer || !value.clientId}>Test sign-in</Button>
        {testing && <Text size="sm" c={surface.muted}>Sign in in the window that opened…</Text>}
      </Group>
      {error && <Alert color="red" style={{ whiteSpace: "pre-line" }}>{error}</Alert>}
      {result && <TestResult result={result} mapsRoles={!!value.roleClaim} />}
    </Stack>
  );
}

/** The addresses to register at the provider. */
export function RegisterAddresses({ callbackUrl, logoutUrl }: { callbackUrl?: string | null; logoutUrl?: string | null }) {
  if (!callbackUrl && !logoutUrl) return null;
  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap={6}>
        <Text size="sm" fw={600}>Register at the provider</Text>
        {callbackUrl && <CopyRow label="Redirect URI" value={callbackUrl} />}
        {logoutUrl && <CopyRow label="Back-channel logout URL" value={logoutUrl}
          hint="Optional: with it, signing out at the provider signs people out of the console at once (otherwise within minutes)." />}
      </Stack>
    </Paper>
  );
}

/** An address to copy, with its name. */
function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <Group gap={6} wrap="nowrap">
        <Text size="sm" c={surface.muted} style={{ flexShrink: 0 }}>{label}:</Text>
        <Code style={{ overflowWrap: "anywhere" }}>{value}</Code>
        <CopyButton value={value}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
              <ActionIcon variant="subtle" size="sm" onClick={copy} aria-label={`Copy the ${label.toLowerCase()}`}>{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      {hint && <Text size="xs" c={surface.faint}>{hint}</Text>}
    </div>
  );
}

function TestResult({ result, mapsRoles }: { result: SignInTestResult; mapsRoles: boolean }) {
  const [showClaims, setShowClaims] = useState(false);
  if (!result.ok) return <Alert color="red" title="The test sign-in didn't work">{result.error}</Alert>;
  return (
    <Alert color={!mapsRoles || result.role ? "teal" : "yellow"} title="The test sign-in worked" data-testid="sign-in-test-result">
      <Stack gap={6}>
        <Text size="sm">{result.name ? `${result.name} · ` : ""}{result.email ?? "no email shared"}</Text>
        {mapsRoles && (
          <Group gap={6}>
            <Text size="sm">Role:</Text>
            {result.role ? <Badge variant="light" tt="none">{result.role}</Badge> : <Text size="sm" fw={600}>none (no group matches)</Text>}
            {(result.roleValues ?? []).length > 0 && <Text size="xs" c={surface.muted}>from {result.roleValues!.join(", ")}</Text>}
          </Group>
        )}
        {mapsRoles && (result.roleValues ?? []).length === 0 && (
          <Text size="xs">The provider didn't send the claim with groups or roles. Have it add the claim to the ID token, user info or access token.</Text>
        )}
        {result.claims && (
          <>
            <Text size="xs" component="button" type="button" onClick={() => setShowClaims(!showClaims)}
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: "inherit", textDecoration: "underline" }}>
              {showClaims ? "Hide" : "Show"} everything the provider sent
            </Text>
            {showClaims && <Code block style={{ maxHeight: 260, overflow: "auto" }}>{JSON.stringify(result.claims, null, 2)}</Code>}
          </>
        )}
      </Stack>
    </Alert>
  );
}

/** A client secret typed here, saved with the provider (empty: keep the saved one, or none for a public client). */
export function SecretField({ value, onChange, savedAt, savedReference }: { value: string; onChange: (v: string) => void; savedAt?: string | null; savedReference?: string | null }) {
  return <SecretInput label="Client secret" value={value} onChange={onChange} savedReference={savedReference}
    description={savedAt ? "One is saved. Type a new one to replace it, or leave it empty to keep it." : "Leave empty for a public client."} />;
}
