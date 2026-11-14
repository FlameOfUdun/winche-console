import { useState, type ReactNode } from "react";
import { ActionIcon, Alert, Button, Group, Menu, Modal, Stack, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconExternalLink, IconPlus, IconSelector, IconStack2, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorMessage } from "../api/appAuth";
import { surface } from "../theme";

/** An address a project's console can have. */
const isUrl = (v: string) => { try { const u = new URL(v.trim()); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

/**
 * The project in the sidebar's header, opening the project switcher: this project, the other projects' consoles
 * (each Winche server is one project, so switching opens that server's console) and "Add a project".
 */
export function ProjectSwitcher({ name, id, logo, collapsed }: { name: string; id: string; logo: ReactNode; collapsed: boolean }) {
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ["project-links"], queryFn: api.projectLinks, staleTime: 60_000 });
  const [adding, setAdding] = useState(false);
  const list = links.data?.links ?? [];
  const editable = !!links.data?.editable;

  const remove = async (url: string) => {
    await api.removeProjectLink(url);
    await qc.invalidateQueries({ queryKey: ["project-links"] });
  };

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
          <Menu.Item leftSection={<IconCheck size={16} color="var(--mantine-color-winche-6)" />} rightSection={<Text size="xs" c={surface.faint}>{id}</Text>}>
            <Text size="sm" fw={600} truncate>{name}</Text>
          </Menu.Item>
          {list.length === 0 && (
            <Stack gap={4} align="center" py="md" px="sm" data-testid="projects-empty">
              <IconStack2 size={22} color={surface.faint} />
              <Text size="sm" fw={600}>Only this project</Text>
              <Text size="xs" c={surface.muted} ta="center">Add your other Winche projects to switch between them here.</Text>
            </Stack>
          )}
          {list.map((l) => (
            <Group key={l.consoleUrl} gap={0} wrap="nowrap">
              <Menu.Item component="a" href={l.consoleUrl} style={{ flex: 1, minWidth: 0 }} leftSection={<span style={{ width: 16 }} />}
                rightSection={<IconExternalLink size={14} color={surface.faint} />}>
                <Text size="sm" truncate>{l.name}</Text>
                <Text size="xs" c={surface.faint} truncate>{l.consoleUrl.replace(/^https?:\/\//, "")}</Text>
              </Menu.Item>
              {editable && (
                <Tooltip label="Remove from the list" withArrow>
                  <ActionIcon variant="subtle" color="gray" size="sm" mr={6} aria-label={`Remove ${l.name}`} onClick={() => remove(l.consoleUrl)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
          {editable && (
            <>
              <Menu.Divider />
              <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add a project</Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>
      <AddProjectDialog opened={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddProjectDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setName(""); setUrl(""); setError(null); onClose(); };
  const add = async () => {
    setBusy(true); setError(null);
    try {
      await api.addProjectLink(name.trim(), url.trim());
      await qc.invalidateQueries({ queryKey: ["project-links"] });
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Add a project</Text>}>
      <Stack gap="md">
        <Text size="sm" c={surface.muted}>Each Winche server runs one project. List another server's console here to switch to it from this sidebar.</Text>
        <TextInput label="Project name" placeholder="Clinic staging" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Its console's address" placeholder="https://staging.example.com/_console" value={url}
          error={url && !isUrl(url) ? "An address starting with https://" : undefined} onChange={(e) => setUrl(e.currentTarget.value)} />
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button onClick={add} loading={busy} disabled={!name.trim() || !isUrl(url)}>Add project</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
