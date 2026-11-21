import { useState } from "react";
import { ActionIcon, Alert, Button, CopyButton, FileButton, Group, Loader, Modal, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconPencil, IconPhoto } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { EditCard } from "../../components/EditCard";
import { ProjectAvatar, squareThumbnail } from "../../components/ProjectAvatar";
import { useSession } from "../../auth/session";
import { ConfirmByIdDialog } from "../../components/ProjectDangerDialogs";
import { surface } from "../../theme";
import { serverConsoleUrl } from "../../layout/nav";

export function Copy({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={1500}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : `Copy ${label}`} withArrow>
          <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} onClick={copy} aria-label={`Copy ${label}`}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

/** Project settings → General: the project (thumbnail, name, id). Its apps are under Integrity. */
export function GeneralSettings() {
  const page = useQuery({ queryKey: ["apps", "android,ios,web"], queryFn: () => api.apps(["android", "ios", "web"]) });
  if (page.isLoading) return <Loader size="sm" />;
  if (page.error || !page.data) return <Alert color="red">Couldn't load the project: {String(page.error)}</Alert>;
  return (
    <Stack gap="lg">
      <YourProject fallbackName={page.data.setup.name ?? page.data.setup.projectId} fallbackId={page.data.setup.projectId} />
      <ArchiveProject />
    </Stack>
  );
}

/** The project's thumbnail, name and id; admins change the thumbnail and rename the project here. */
function YourProject({ fallbackName, fallbackId }: { fallbackName: string; fallbackId: string }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const project = useQuery({ queryKey: ["project"], queryFn: api.project });
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = user?.role === "Admin";
  const p = project.data;
  const name = p?.created ? p.name : fallbackName;
  const id = p?.created ? p.id : fallbackId;
  const canEdit = admin && !!p?.setup && !!p.created;
  const refresh = () => Promise.all(["project", "overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setError(null);
    try { await api.setProjectImage(await squareThumbnail(file)); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const removeImage = async () => {
    setBusy(true); setError(null);
    try { await api.removeProjectImage(); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <EditCard title="Your project" description="Apps find it by its id, which never changes. Its name and image are just for people."
      actions={canEdit && <Button variant="subtle" leftSection={<IconPencil size={15} />} onClick={() => setRenaming(true)}>Rename</Button>}
      rows={[
        { label: "Name", value: <Text span size="sm" data-testid="project-name">{name}</Text> },
        { label: "Project id", value: <Group gap={4} wrap="nowrap"><Text span ff="monospace" fz="sm">{id}</Text><Copy value={id} label="project id" /></Group> },
        { label: "Image", value: (
          <Group gap="sm" wrap="wrap">
            <ProjectAvatar version={p?.imageVersion} size={40} radius={10} />
            {canEdit && (
              <>
                <FileButton onChange={upload} accept="image/png,image/jpeg,image/webp">
                  {(props) => <Button {...props} size="xs" variant="default" leftSection={<IconPhoto size={14} />} loading={busy}>{p?.imageVersion ? "Change image" : "Add image"}</Button>}
                </FileButton>
                {p?.imageVersion && <Button size="xs" variant="subtle" color="gray" onClick={removeImage} disabled={busy}>Remove</Button>}
              </>
            )}
          </Group>
        ) },
      ]}>
      {error && <Alert color="red" p="xs" mx={24} mb={16}>{error}</Alert>}
      <RenameDialog opened={renaming} name={name} id={id} onClose={() => setRenaming(false)} onDone={refresh} />
    </EditCard>
  );
}

/**
 * Archiving this project (server admins): it stops and its address is refused until
 * it's restored; nothing is deleted.
 */
function ArchiveProject() {
  const { user } = useSession();
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  const data = projects.data;
  const current = data?.projects.find((p) => p.id === data.current);
  if (!user?.serverAdmin || !data?.available || !current) return null;
  return (
    <EditCard danger title="Archive this project" description="It stops, and its apps and console are refused until a server admin restores it. Nothing is deleted."
      actions={<Button color="red" variant="light" onClick={() => setOpen(true)}>Archive project</Button>}>
      <ConfirmByIdDialog opened={open} id={current.id} title={`Archive ${current.name}?`} action="Archive project" onClose={() => setOpen(false)}
        body="Its apps get errors until it's restored. Its data, users and files are kept: restore or delete it on the server's Projects page, under Archived."
        onConfirm={async () => { await api.archiveProject(current.id); window.location.assign(serverConsoleUrl("projects")); }} />
    </EditCard>
  );
}

/** Renaming the project. Its id stays: apps and their options files use it. */
function RenameDialog({ opened, name, id, onClose, onDone }: { opened: boolean; name: string; id: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = value ?? name;
  const close = () => { setValue(null); setError(null); onClose(); };
  const save = async () => {
    setBusy(true); setError(null);
    try { await api.renameProject(v.trim(), id); await onDone(); close(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal opened={opened} onClose={close} radius="lg" title={<Text fw={700} fz={18}>Rename the project</Text>}>
      <Stack gap="md">
        <TextInput label="Project name" data-autofocus value={v} onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && v.trim() && save()} />
        <Text size="sm" c={surface.muted}>The project id stays <Text span ff="monospace">{id}</Text>: your apps use it.</Text>
        {error && <Alert color="red" p="xs">{error}</Alert>}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!v.trim() || v.trim() === name}>Rename</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

