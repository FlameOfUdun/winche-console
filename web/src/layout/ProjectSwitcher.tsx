import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Group, Menu, Modal, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { IconCheck, IconPlus, IconSelector, IconStack2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { isProjectId, projectIdFrom } from "../api/project";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { surface } from "../theme";

/** Opens another project's console (a full page load: each project's console is its own app). */
const open = (consoleUrl: string) => window.location.assign(`${consoleUrl}/overview`);

/**
 * The project in the sidebar's header, opening the switcher: every project on this server, each with its thumbnail,
 * and "Add a project", which creates one and opens it. A console that runs one project only lists just that one.
 */
export function ProjectSwitcher({ name, id, logo, collapsed }: { name: string; id: string; logo: ReactNode; collapsed: boolean }) {
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, staleTime: 30_000 });
  const [adding, setAdding] = useState(false);
  const data = projects.data;
  const others = (data?.projects ?? []).filter((p) => p.id !== data?.current);
  const current = data?.projects.find((p) => p.id === data.current);

  return (
    <>
      <Menu position={collapsed ? "right-start" : "bottom-start"} width={300} shadow="md" radius="md" offset={6}>
        <Menu.Target>
          <UnstyledButton aria-label="Switch project" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, borderRadius: 10, padding: 4 }}
            className="winche-switcher">
            {logo}
            {!collapsed && (
              <>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text fw={600} size="sm" lh={1.2} c={surface.text} truncate>{name}</Text>
                  <Text size="xs" lh={1.3} c={surface.faint} truncate>{id}</Text>
                </div>
                <IconSelector size={16} color={surface.faint} style={{ flexShrink: 0 }} />
              </>
            )}
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Projects</Menu.Label>
          <Menu.Item leftSection={<ProjectAvatar version={current?.imageVersion} consoleUrl={current?.consoleUrl} size={24} radius={6} />}
            rightSection={<IconCheck size={16} color="var(--mantine-color-winche-6)" />}>
            <Text size="sm" fw={600} truncate>{name}</Text>
          </Menu.Item>
          {others.length === 0 && (
            <Stack gap={4} align="center" py="md" px="sm" data-testid="projects-empty">
              <IconStack2 size={22} color={surface.faint} />
              <Text size="sm" fw={600}>Only this project</Text>
              <Text size="xs" c={surface.muted} ta="center">
                {data?.available ? "Projects you add here run on this server, each with its own data." : "This console runs one project."}
              </Text>
            </Stack>
          )}
          {others.map((p) => (
            <Menu.Item key={p.id} onClick={() => open(p.consoleUrl)} data-testid="other-project"
              leftSection={<ProjectAvatar version={p.imageVersion} consoleUrl={p.consoleUrl} size={24} radius={6} />}
              rightSection={<Text size="xs" c={surface.faint}>{p.id}</Text>}>
              <Text size="sm" truncate>{p.name}</Text>
            </Menu.Item>
          ))}
          {data?.canCreate && (
            <>
              <Menu.Divider />
              <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add a project</Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>
      <CreateProjectDialog opened={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** Creating a project on this server: its name and id; then its console opens. */
function CreateProjectDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!idEdited) setId(projectIdFrom(name)); }, [name, idEdited]);
  const close = () => { setName(""); setId(""); setIdEdited(false); setError(null); onClose(); };
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const created = await api.createServerProject(name.trim(), id);
      open(created.consoleUrl);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Add a project</Text>}>
      <Stack gap="md">
        <TextInput label="Project name" placeholder="Clinic staging" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Project id" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} value={id} description={id && isProjectId(id) ? `Its address: …/p/${id}` : undefined}
          error={id && !isProjectId(id) ? "3 to 40 lower-case letters, digits and dashes, starting with a letter." : undefined}
          onChange={(e) => { setIdEdited(true); setId(e.currentTarget.value.toLowerCase()); }} />
        <Text size="sm" c={surface.muted}>It gets its own database, users and files. Its products start off, as here.</Text>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button onClick={create} loading={busy} disabled={!name.trim() || !isProjectId(id)}>Create project</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
