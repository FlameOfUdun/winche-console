import type { ReactNode } from "react";
import { Center, Loader } from "@mantine/core";
import { IconHourglass } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useSession } from "../../auth/session";
import { AuthCard } from "../../components/AuthCard";
import { Onboarding } from "./Onboarding";
import { NotAMember } from "./NotAMember";

/**
 * The project is required once the console is set up: until it exists, admins create it (the same steps as the
 * first run) and everyone else waits. Consoles without project setup pass straight through.
 */
export function RequireProject({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const notMember = user?.member === false;
  const project = useQuery({ queryKey: ["project"], queryFn: api.project, staleTime: 30_000, retry: false, enabled: !notMember });
  if (notMember) return <NotAMember email={user!.email} />;
  if (project.isLoading) return <Center h="100vh"><Loader /></Center>;
  const p = project.data;
  if (!p || !p.setup || p.created) return <>{children}</>;
  if (user?.role === "Admin") return <Onboarding mode="create" />;
  return (
    <AuthCard title="Almost ready" icon={<IconHourglass size={40} stroke={1.5} color="var(--mantine-color-winche-6)" />}
      subtitle="An admin hasn't created this console's project yet. Come back once they have.">
      <></>
    </AuthCard>
  );
}
