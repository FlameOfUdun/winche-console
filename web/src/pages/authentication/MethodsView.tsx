import { Alert, Badge, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { KeycloakSyncView } from "./KeycloakSyncView";

function Method({ name, on, about, rows }: { name: string; on: boolean; about: string; rows: [string, string][]; code?: string }) {
  return (
    <Paper withBorder p="md" data-testid="sign-in-method">
      <Stack gap={8}>
        <Group justify="space-between" wrap="nowrap">
          <Title order={5}>{name}</Title>
          <Badge color={on ? "teal" : "gray"} variant="light" tt="none">{on ? "On" : "Off"}</Badge>
        </Group>
        <Text size="sm" c="dimmed">{about}</Text>
        {rows.map(([k, v]) => (
          <Group key={k} justify="space-between" gap="xs" wrap="nowrap" style={{ borderTop: "1px solid var(--mantine-color-gray-2)", paddingTop: 6 }}>
            <Text size="sm">{k}</Text>
            <Text size="sm" fw={500} ta="right" style={{ wordBreak: "break-all" }}>{v}</Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

/** How users sign in: what's on, and its details. */
export function MethodsView() {
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  if (config.isLoading) return <Loader size="sm" />;
  if (config.isError || !config.data) return <Alert color="red">Couldn't load the settings: {errorMessage(config.error)}</Alert>;
  const c = config.data;
  return (
    <Stack gap="sm">
      {c.signInSettings && <Text size="sm" c="dimmed">What's in force now. Change it in Settings.</Text>}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Method name="Email and password" on={!!c.emailPassword}
          about="Sign up and sign in with an email address and a password."
          rows={c.emailPassword ? [
            ["Minimum length", `${c.emailPassword.minLength} characters`],
            ["Verified email required", c.emailPassword.requireVerifiedEmail ? "Yes" : "No"],
            ...(c.protection ? [["Lockout", `${c.protection.maxFailedSignIns} failures → ${c.protection.lockoutMinutes} minutes`] as [string, string]] : []),
          ] : []} />
        <Method name="Email link" on={!!c.emailLink}
          about="A one-time sign-in link sent by email: no password. The first use makes the account."
          rows={c.emailLink ? [["Finishes in", c.emailLink.linkUrl]] : []} />
        <Method name="Anonymous" on={c.anonymous}
          about="A guest user with a uid, upgraded later by linking an email and password."
          rows={[]} code="o.Anonymous();" />
        {c.identityProviders.map((p) => (
          <Method key={p.name} name={p.displayName} on
            about={p.kind === "oidc"
              ? "An OpenID Connect provider: the app signs in there and exchanges the ID token. Its users become Winche users."
              : `The app signs in with ${p.displayName} and exchanges the ID token. Its users become Winche users.`}
            rows={[
              ["Audiences", p.audiences.join(", ")],
              ...(p.kind === "oidc" ? [["Authority", p.authority] as [string, string]] : []),
              ["uid", p.useSubjectAsUid ? "the provider's own id" : "a new Winche uid"],
              ...(p.copiedClaims.length ? [["Claims copied", p.copiedClaims.join(", ")] as [string, string]] : []),
              ...(p.testingOnly ? [["Unsigned tokens", "accepted (testing only)"] as [string, string]] : []),
            ]} />
        ))}
        <Method name="Two-step sign-in" on={!!c.mfa}
          about="Users may add an authenticator app; then every sign-in also asks for its code (or a recovery code). Their tokens carry mfa: true."
          rows={c.mfa ? [["Shown in apps as", c.mfa.issuer], ["Recovery codes", String(c.mfa.recoveryCodes)], ["Time for the code", `${c.mfa.pendingMinutes} minutes`]] : []} />
        <Method name="Winche tokens" on={c.trustsWincheTokens}
          about="Database, Storage and your endpoints accept the tokens Winche Auth issues."
          rows={c.tokens ? [["Issuer", c.tokens.issuer]] : []} code="AddWincheTokens(t => t.TrustWincheAuth());" />
        {c.trustedIssuers.map((i) => (
          <Method key={i.name} name={`${i.name} (trusted issuer)`} on
            about="Another identity provider's tokens, accepted as they are. Its users are managed there, not here."
            rows={[
              ["Issuer", i.issuer ?? "—"],
              ["Audience", i.audience ?? "not checked"],
              ["uid from", i.uidClaim],
              ["Claims passed on", i.claims ? i.claims.join(", ") || "none" : "all"],
            ]} />
        ))}
      </SimpleGrid>
      {c.identityProviders.length > 0 && <KeycloakSyncView />}
    </Stack>
  );
}
