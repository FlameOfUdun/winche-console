import { ProductHooks } from "../hooks/ProductHooks";
import { Anchor, Stack, Tabs } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../auth/session";
import { UsersView } from "./UsersView";
import { MethodsView } from "./MethodsView";
import { SettingsPanel } from "./SettingsPanel";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { EmailTemplatesView } from "./EmailTemplatesView";
import { PageHeader } from "../../components/PageHeader";

/** The Authentication tab: the app's users (Winche Auth), how they sign in, and token settings. */
export function AuthenticationPage() {
  const { state } = useSession();
  const config = useQuery({ queryKey: ["app-auth-config"], queryFn: api.appAuthConfig });
  const wincheAuth = config.data?.wincheAuth !== false;
  const hooks = !!state?.capabilities?.hooks;
  const hasUsers = !config.data || !!config.data.directory;
  const [chosen, setTab] = useState<string | null>(null);
  const tab = chosen ?? (hasUsers ? "users" : "settings");
  return (
    <Stack gap="sm">
      <PageHeader eyebrow="Build" title="Authentication"
        description={<>{wincheAuth ? "Your apps' users and how they sign in." : "How your apps' sign-ins are checked."} The console's own members are in Project settings.</>}
        actions={state?.capabilities?.logs?.app && (
          <Anchor component={Link} to="/logs?resource=auth" size="sm" fw={600}>Sign-ins and failures in Logs →</Anchor>
        )} />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          {hasUsers && <Tabs.Tab value="users">Users</Tabs.Tab>}
          <Tabs.Tab value="methods">Sign-in methods</Tabs.Tab>
          {wincheAuth && <Tabs.Tab value="emails">Email templates</Tabs.Tab>}
          {hooks && <Tabs.Tab value="hooks">Hooks</Tabs.Tab>}
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
        {hasUsers && <Tabs.Panel value="users"><UsersView /></Tabs.Panel>}
        <Tabs.Panel value="methods"><MethodsView /></Tabs.Panel>
        {wincheAuth && <Tabs.Panel value="emails"><EmailTemplatesView /></Tabs.Panel>}
        {hooks && <Tabs.Panel value="hooks"><ProductHooks source="auth" /></Tabs.Panel>}
        <Tabs.Panel value="settings"><SettingsPanel wincheAuth={wincheAuth} trustedProviders={config.data?.trustedProviders !== false} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
