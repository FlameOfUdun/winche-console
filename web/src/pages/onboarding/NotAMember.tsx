import { Anchor, Button, Loader, Stack, Text, UnstyledButton, Group } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AuthCard } from "../../components/AuthCard";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { surface } from "../../theme";

/** Signed in, but not a member of this project: the projects they are in, or signing out. */
export function NotAMember({ email }: { email: string }) {
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, retry: false });
  const mine = projects.data?.projects ?? [];
  const signOut = async () => { await api.logout(); window.location.reload(); };
  return (
    <AuthCard title="You're not in this project" icon={<IconLock size={40} stroke={1.5} color="var(--mantine-color-winche-6)" />}
      subtitle={`${email} isn't one of its members. Ask one of its admins to add you.`}
      footer={<Anchor size="sm" c="dimmed" onClick={signOut}>Sign in as someone else</Anchor>}>
      {projects.isLoading ? <Loader size="sm" /> : mine.length > 0 ? (
        <Stack gap="xs" w="100%">
          <Text size="sm" c={surface.muted}>Your projects</Text>
          {mine.map((p) => (
            <UnstyledButton key={p.id} onClick={() => window.location.assign(`${p.consoleUrl}/overview`)}
              style={{ border: `1px solid ${surface.border}`, borderRadius: 10, padding: 10 }}>
              <Group gap="sm" wrap="nowrap">
                <ProjectAvatar version={p.imageVersion} consoleUrl={p.consoleUrl} size={28} radius={7} />
                <Text fw={500} truncate>{p.name}</Text>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      ) : <Button variant="default" onClick={signOut}>Sign out</Button>}
    </AuthCard>
  );
}
