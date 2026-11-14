import { ProjectMembersPanel } from "./ProjectMembersPanel";
import { Alert, Code, Paper, Stack, Tabs, Text, Title } from "@mantine/core";
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
          {admin && <Tabs.Tab value="users" leftSection={<IconUsers size={16} stroke={1.7} />}>Members</Tabs.Tab>}
          {admin && <Tabs.Tab value="ci" leftSection={<IconKey size={16} stroke={1.7} />}>CLI and CI</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="general"><GeneralSettings /></Tabs.Panel>
        {admin && <Tabs.Panel value="users">
          {state?.capabilities?.members ? <ProjectMembersPanel /> : <UsersAndPermissions manageUsers={!!state?.capabilities?.manageUsers} />}
        </Tabs.Panel>}
        {admin && <Tabs.Panel value="ci"><CiTokensTab /></Tabs.Panel>}
      </Tabs>
    </Stack>
  );
}

/** The console's own members and invites; with Keycloak, they're managed there. */
function UsersAndPermissions({ manageUsers }: { manageUsers: boolean }) {
  if (!manageUsers) {
    return (
      <Alert color="blue" maw={760}>
        This console signs in with Keycloak: its members, and their Admin, Member or Viewer roles, are managed in Keycloak.
        Your apps' users are under <Code>Authentication</Code>.
      </Alert>
    );
  }
  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <Title order={2} fz={16}>Members</Title>
        <Text size="sm" c="dimmed" mt={2} mb="md">Who can use this console, and with which role. Your apps' users are under Authentication.</Text>
        <UsersTab />
      </Paper>
      <Paper withBorder p="lg">
        <Title order={2} fz={16}>Invites</Title>
        <Text size="sm" c="dimmed" mt={2} mb="md">Pending invites. Each works once, until it expires.</Text>
        <InvitesTab />
      </Paper>
    </Stack>
  );
}
