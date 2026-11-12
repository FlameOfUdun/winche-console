import { Anchor, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../auth/session";
import { UsersView } from "./UsersView";
import { MethodsView } from "./MethodsView";
import { AuthSettingsView } from "./AuthSettingsView";

/** The Authentication tab: the app's users (Winche Auth), how they sign in, and token settings. */
export function AuthenticationPage() {
  const [tab, setTab] = useState<string | null>("users");
  const { state } = useSession();
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={3}>Authentication</Title>
          <Text size="sm" c="dimmed">The app's users. The console's own admins are in Access.</Text>
        </div>
        {state?.capabilities?.logs?.app && (
          <Anchor component={Link} to="/logs?resource=auth" size="sm">Sign-ins and failures in Logs →</Anchor>
        )}
      </Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="users">Users</Tabs.Tab>
          <Tabs.Tab value="methods">Sign-in methods</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="users"><UsersView /></Tabs.Panel>
        <Tabs.Panel value="methods"><MethodsView /></Tabs.Panel>
        <Tabs.Panel value="settings"><AuthSettingsView /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
