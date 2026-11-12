import { Anchor, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../auth/session";
import { UsersView } from "./UsersView";
import { MethodsView } from "./MethodsView";
import { SettingsPanel } from "./SettingsPanel";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { EmailTemplatesView } from "./EmailTemplatesView";

/** The Authentication tab: the app's users (Winche Auth), how they sign in, and token settings. */
export function AuthenticationPage() {
  const { state } = useSession();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  const wincheAuth = config.data?.wincheAuth !== false;
  const [chosen, setTab] = useState<string | null>(null);
  const tab = chosen ?? (wincheAuth ? "users" : "settings");
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={3}>Authentication</Title>
          <Text size="sm" c="dimmed">
            {wincheAuth ? "The app's users and how they sign in." : "How the app's sign-ins are checked."} The console's own admins are in Access.
          </Text>
        </div>
        {state?.capabilities?.logs?.app && (
          <Anchor component={Link} to="/logs?resource=auth" size="sm">Sign-ins and failures in Logs →</Anchor>
        )}
      </Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          {wincheAuth && <Tabs.Tab value="users">Users</Tabs.Tab>}
          <Tabs.Tab value="methods">Sign-in methods</Tabs.Tab>
          {wincheAuth && <Tabs.Tab value="emails">Email templates</Tabs.Tab>}
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
        {wincheAuth && <Tabs.Panel value="users"><UsersView /></Tabs.Panel>}
        <Tabs.Panel value="methods"><MethodsView /></Tabs.Panel>
        {wincheAuth && <Tabs.Panel value="emails"><EmailTemplatesView /></Tabs.Panel>}
        <Tabs.Panel value="settings"><SettingsPanel wincheAuth={wincheAuth} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
