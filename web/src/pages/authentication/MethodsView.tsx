import { Alert, Badge, Code, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";

function Method({ name, on, about, rows, code }: { name: string; on: boolean; about: string; rows: [string, string][]; code: string }) {
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
        <Code block fz="xs">{code}</Code>
      </Stack>
    </Paper>
  );
}

/** How users sign in: set in code (AddWincheAuth / AddWincheTokens), shown here. */
export function MethodsView() {
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  if (config.isLoading) return <Loader size="sm" />;
  if (config.isError || !config.data) return <Alert color="red">Couldn't load the settings: {errorMessage(config.error)}</Alert>;
  const c = config.data;
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">Set in code with <Code>AddWincheAuth(o =&gt; …)</Code> and <Code>AddWincheTokens(t =&gt; …)</Code>; shown here so you can see what's on.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Method name="Email and password" on={!!c.emailPassword}
          about="Sign up and sign in with an email address and a password."
          rows={c.emailPassword ? [["Minimum length", `${c.emailPassword.minLength} characters`], ["Lockout", `${c.protection.maxFailedSignIns} failures → ${c.protection.lockoutMinutes} minutes`]] : []}
          code={c.emailPassword ? `o.EmailPassword(p => p.MinLength = ${c.emailPassword.minLength});` : "o.EmailPassword();"} />
        <Method name="Anonymous" on={c.anonymous}
          about="A guest user with a uid, upgraded later by linking an email and password."
          rows={[]} code="o.Anonymous();" />
        <Method name="Winche tokens" on={c.trustsWincheTokens}
          about="Database, Storage and your endpoints accept the tokens Winche Auth issues."
          rows={[["Issuer", c.tokens.issuer]]} code="AddWincheTokens(t => t.TrustWincheAuth());" />
        {c.trustedIssuers.map((i) => (
          <Method key={i.name} name={`${i.name} (trusted issuer)`} on
            about="Another identity provider's tokens, accepted as they are. Its users are managed there, not here."
            rows={[
              ["Issuer", i.issuer ?? "—"],
              ["Audience", i.audience ?? "not checked"],
              ["uid from", i.uidClaim],
              ["Claims passed on", i.claims ? i.claims.join(", ") || "none" : "all"],
            ]}
            code={`t.TrustIssuer("${i.name}", i => { i.Authority = "…"; i.Audience = "…"; });`} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
