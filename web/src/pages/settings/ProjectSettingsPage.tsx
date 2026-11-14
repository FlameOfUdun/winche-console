import { Alert, Code, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconApps, IconKey, IconUsers } from "@tabler/icons-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../auth/session";
import { GeneralSettings } from "../apps/AppsPage";
import { InvitesTab, UsersTab } from "../UsersPage";
import { CiTokensTab } from "../access/CiTokensTab";
import { PageHeader } from "../../components/PageHeader";

/**
 * Project settings (the gear, like Firebase's): General (the project and its apps) for everyone; Users and
 * permissions, and CLI and CI, for admins.
 */
export function ProjectSettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { state, user } = useSession();
  const admin = user?.role === "Admin";
  const tabs = ["general", ...(admin ? ["users", "ci"] : [])];
  if (!tab || !tabs.includes(tab)) return <Navigate to="/settings/general" replace />;

  return (
    <Stack gap="sm">
      <PageHeader title="Project settings" />
      <Tabs value={tab} onChange={(v) => v && navigate(`/settings/${v}`)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="general" leftSection={<IconApps size={16} stroke={1.7} />}>General</Tabs.Tab>
          {admin && <Tabs.Tab value="users" leftSection={<IconUsers size={16} stroke={1.7} />}>Users and permissions</Tabs.Tab>}
          {admin && <Tabs.Tab value="ci" leftSection={<IconKey size={16} stroke={1.7} />}>CLI and CI</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="general"><GeneralSettings /></Tabs.Panel>
        {admin && <Tabs.Panel value="users"><UsersAndPermissions manageUsers={!!state?.capabilities?.manageUsers} /></Tabs.Panel>}
        {admin && <Tabs.Panel value="ci"><CiTokensTab /></Tabs.Panel>}
      </Tabs>
    </Stack>
  );
}

/** The console's own users and invites; with Keycloak, they're managed there. */
function UsersAndPermissions({ manageUsers }: { manageUsers: boolean }) {
  if (!manageUsers) {
    return (
      <Alert color="blue" maw={760}>
        This console signs in with Keycloak: its users, and their Admin, Member or Viewer roles, are managed in Keycloak.
        The app's own users are under <Code>Authentication</Code>.
      </Alert>
    );
  }
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={5}>Members</Title>
        <Text size="sm" c="dimmed">Who can use this console, and with which role. The app's own users are under Authentication.</Text>
        <UsersTab />
      </Stack>
      <Stack gap="xs">
        <Title order={5}>Invites</Title>
        <InvitesTab />
      </Stack>
    </Stack>
  );
}
