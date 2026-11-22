import { useEffect, useState } from "react";
import { Alert, Button, Group, Menu, Modal, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { IconCheck, IconLayoutGrid, IconPlus, IconSelector, IconStack2 } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { ProjectDatabaseFields, useProjectDatabase } from "../components/ProjectDatabase";
import { isProjectId, projectIdFrom } from "../api/project";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { surface } from "../theme";

/** Opens another project's console (a full page load: each project's console is its own app). */
export const openProject = (consoleUrl: string) => window.location.assign(`${consoleUrl}/overview`);

/**
 * The project in the top bar, opening the picker: every project on this server, each with its thumbnail, all
 * projects, and (server admins) adding one. A console that runs one project shows just its name.
 */
export function ProjectPicker({ name, id, imageVersion }: { name: string; id: string; imageVersion?: string | null }) {
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, staleTime: 30_000 });
  const [adding, setAdding] = useState(false);
  const data = projects.data;
  const others = (data?.projects ?? []).filter((p) => p.id !== data?.current);
  const button = (
    <UnstyledButton aria-label="Switch project" className="winche-picker" disabled={!data?.available}>
      <ProjectAvatar version={imageVersion} size={24} radius={6} />
      <Text fw={600} fz={14} truncate maw={220}>{name}</Text>
      {id && id !== name && <Text fz={12} c={surface.faint} truncate maw={160} visibleFrom="md">{id}</Text>}
      {data?.available && <IconSelector size={15} color={surface.faint} style={{ flexShrink: 0 }} />}
    </UnstyledButton>
  );
  if (!data?.available) return button;
  return (
    <>
      <Menu position="bottom-start" width={320} shadow="md" radius="md" offset={6}>
        <Menu.Target>{button}</Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Projects</Menu.Label>
          <Menu.Item leftSection={<ProjectAvatar version={imageVersion} size={24} radius={6} />}
            rightSection={<IconCheck size={16} color="var(--w-accent)" />}>
            <Text size="sm" fw={600} truncate>{name}</Text>
          </Menu.Item>
          {others.length === 0 && (
            <Stack gap={4} align="center" py="md" px="sm" data-testid="projects-empty">
              <IconStack2 size={22} color={surface.faint} />
              <Text size="sm" fw={600}>Only this project</Text>
              <Text size="xs" c={surface.muted} ta="center">Projects you add run on this server, each with its own data.</Text>
            </Stack>
          )}
          {others.map((p) => (
            <Menu.Item key={p.id} onClick={() => openProject(p.consoleUrl)} data-testid="other-project"
              leftSection={<ProjectAvatar version={p.imageVersion} consoleUrl={p.consoleUrl} size={24} radius={6} />}
              rightSection={<Text size="xs" c={surface.faint}>{p.id}</Text>}>
              <Text size="sm" truncate>{p.name}</Text>
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item leftSection={<IconLayoutGrid size={16} />} component={Link} to="/projects">All projects</Menu.Item>
          {data.canCreate && <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add a project</Menu.Item>}
        </Menu.Dropdown>
      </Menu>
      <CreateProjectDialog opened={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** Creating a project on this server: its name, id and database; then its console opens. */
export function CreateProjectDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const dbs = useProjectDatabase();
  const [busy, setBusy] = useState<"check" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!idEdited) setId(projectIdFrom(name)); }, [name, idEdited]);
  const close = () => { setName(""); setId(""); setIdEdited(false); dbs.reset(); setError(null); onClose(); };
  const run = async (kind: "check" | "create") => {
    setBusy(kind); setError(null);
    try {
      if (kind === "check") { dbs.setCheck(await api.checkProjectDatabase(id, dbs.target())); setBusy(null); return; }
      const created = await api.createServerProject(name.trim(), id, dbs.target());
      openProject(created.consoleUrl);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  const ready = !!name.trim() && isProjectId(id) && dbs.ready;
  return (
    <Modal opened={opened} onClose={close} size="lg" radius="lg" title={<Text fw={700} fz={18}>Add a project</Text>}>
      <Stack gap="md">
        <TextInput label="Project name" placeholder="My app staging" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Project id" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }} value={id}
          error={id && !isProjectId(id) ? "3 to 40 lower-case letters, digits and dashes, starting with a letter." : undefined}
          onChange={(e) => { setIdEdited(true); setId(e.currentTarget.value.toLowerCase()); }} />
        <ProjectDatabaseFields state={dbs} />
        <Text size="sm" c={surface.muted}>It gets its own users and files too. Its products start off, as here.</Text>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          {dbs.where === "elsewhere" && <Button variant="default" loading={busy === "check"} disabled={!ready || busy !== null} onClick={() => run("check")}>Check</Button>}
          <Button onClick={() => run("create")} loading={busy === "create"} disabled={!ready || busy !== null}>Create project</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
