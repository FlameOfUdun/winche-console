import { ProjectMembersPanel } from "./ProjectMembersPanel";
import { Paper, Stack, Text, Title } from "@mantine/core";
import { DataLocationTab } from "./DataLocationTab";
import { Navigate, useParams } from "react-router-dom";
import { useSession } from "../../auth/session";
import { GeneralSettings } from "../apps/AppsPage";
import { InvitesTab, UsersTab } from "../UsersPage";
import { ServiceAccountsTab } from "../access/ServiceAccountsTab";
import { NavPageHeader } from "../../components/NavPageHeader";

/**
 * Project settings, at the bottom of the sidebar: General (the project and its apps) for everyone; Members, and service
 * accounts, for admins; Data (where its data is kept) for server admins. One page each.
 */
export function ProjectSettingsPage() {
  const { tab } = useParams();
  const { state, user } = useSession();
  const admin = user?.role === "Admin";
  const serverAdmin = !!user?.serverAdmin;
  const tabs = ["general", ...(admin ? ["members", "service-accounts"] : []), ...(serverAdmin ? ["data"] : [])];
  if (tab === "ci") return <Navigate to="/settings/service-accounts" replace />;   // CI tokens became service accounts
  if (tab === "users") return <Navigate to="/settings/members" replace />;
  if (tab === "secrets") return <Navigate to="/secrets" replace />;   // its address of before
  if (!tab || !tabs.includes(tab)) return <Navigate to="/settings/general" replace />;

  return (
    <>
    <NavPageHeader />
    <Stack gap={0} pb={40}>
      {tab === "general" && <GeneralSettings />}
      {tab === "members" && (state?.capabilities?.members ? <ProjectMembersPanel /> : <UsersAndPermissions manageUsers={!!state?.capabilities?.manageUsers} />)}
      {tab === "service-accounts" && <ServiceAccountsTab />}
      {tab === "data" && <DataLocationTab />}
    </Stack>
    </>
  );
}

/** The console's own members and invites. */
function UsersAndPermissions({ manageUsers }: { manageUsers: boolean }) {
  if (!manageUsers) return null;
  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <Title order={2} fz={16}>Members</Title>
        <Text size="sm" c="dimmed" mt={2} mb="md">Who can use this project's console, and with which role.</Text>
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
