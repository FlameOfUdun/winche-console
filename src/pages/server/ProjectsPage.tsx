import { useState } from "react";
import { Alert, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconArchive, IconArrowRight, IconPlus, IconStack2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { PageBand } from "../../components/NavPageHeader";
import { EmptyState } from "../../components/EmptyState";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { ConfirmByIdDialog } from "../../components/ProjectDangerDialogs";
import { CreateProjectDialog, openProject } from "../../layout/ProjectSwitcher";
import { surface } from "../../theme";
import type { ProductId } from "../../api/project";

/** Every project on this server you're in, each opening its console; server admins add, restore and delete them. */
export function ProjectsPage() {
  const projects = useQuery({ queryKey: ["server-projects"], queryFn: api.projects, staleTime: 30_000 });
  const [adding, setAdding] = useState(false);
  const d = projects.data;
  if (projects.isLoading) return <Loader size="sm" />;
  if (projects.isError || !d) return <Alert color="red">Couldn't load the projects: {errorMessage(projects.error)}</Alert>;
  const add = d.canCreate && <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Add project</Button>;

  return (
    <>
    <PageBand title="Your projects" actions={d.projects.length > 0 && add} />
    <Stack gap="xl" pb={28}>
      {d.projects.length === 0 ? (
        <EmptyState icon={IconStack2} title="No projects yet"
          description={d.canCreate ? "Add one to get its database, users and files." : "A server admin adds you to projects."}
          action={add} />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {d.projects.map((p) => (
            <UnstyledButton key={p.id} onClick={() => openProject(p.consoleUrl)} data-testid="project-card" aria-label={`Open ${p.name}`}>
              <Paper withBorder p="lg" className="winche-card-link" h="100%">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ProjectAvatar version={p.imageVersion} consoleUrl={p.consoleUrl} size={44} radius={10} />
                    <div style={{ minWidth: 0 }}>
                      <Text fw={600} fz={16} truncate>{p.name}</Text>
                      <Text size="sm" c={surface.faint} ff="monospace" truncate>{p.id}</Text>
                    </div>
                  </Group>
                </Group>
                <Group justify="space-between" align="flex-end" mt="lg" gap="xs" wrap="nowrap">
                  {p.products ? <ProductDots on={p.products} /> : <span />}
                  <Group gap={4} c={surface.accent} wrap="nowrap">
                    <Text size="sm" fw={600}>Open</Text>
                    <IconArrowRight size={15} />
                  </Group>
                </Group>
              </Paper>
            </UnstyledButton>
          ))}
          {d.canCreate && (
            <UnstyledButton onClick={() => setAdding(true)} className="winche-add-card" aria-label="Add a project">
              <span className="winche-add-icon"><IconPlus size={20} /></span>
              <Text fw={500}>Add project</Text>
            </UnstyledButton>
          )}
        </SimpleGrid>
      )}
      {(d.archived?.length ?? 0) > 0 && <Archived archived={d.archived!} />}
      <CreateProjectDialog opened={adding} onClose={() => setAdding(false)} />
    </Stack>
    </>
  );
}

const PRODUCTS: { id: ProductId; name: string }[] = [
  { id: "authentication", name: "Authentication" }, { id: "database", name: "Database" }, { id: "storage", name: "Storage" }, { id: "functions", name: "Functions" }, { id: "assets", name: "Assets" }, { id: "realtime", name: "Realtime" },
];

/** Which products a project has started: a dot each, green when on. */
function ProductDots({ on }: { on: ProductId[] }) {
  return (
    <Group gap={12} wrap="wrap" data-testid="project-products">
      {PRODUCTS.map((x) => (
        <Group key={x.id} gap={6} wrap="nowrap">
          <span className="winche-dot" data-on={on.includes(x.id) || undefined} aria-hidden />
          <Text size="xs" c={on.includes(x.id) ? surface.muted : surface.faint}>{on.includes(x.id) ? x.name : `${x.name} off`}</Text>
        </Group>
      ))}
    </Group>
  );
}

/** Archived projects: restore one (back at its address) or delete it (its data, for good). */
function Archived({ archived }: { archived: { id: string; name: string; archivedAt: string }[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["server-projects"] });
  const restore = async (id: string) => {
    setBusy(id); setError(null);
    try { await api.restoreProject(id); await refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <Stack gap="sm">
      <Group gap={8}>
        <IconArchive size={18} color={surface.faint} />
        <Text fw={600}>Archived</Text>
        <Text size="sm" c={surface.faint}>Their apps don't work until they're restored.</Text>
      </Group>
      <Paper withBorder>
        {archived.map((a, i) => (
          <Group key={a.id} justify="space-between" wrap="nowrap" px="md" py={12} data-testid="archived-project"
            style={{ borderTop: i ? `1px solid ${surface.subtle}` : undefined }}>
            <div style={{ minWidth: 0 }}>
              <Text fw={500} truncate>{a.name}</Text>
              <Text size="xs" c={surface.muted}>{a.id} · archived {new Date(a.archivedAt).toLocaleDateString()}</Text>
            </div>
            <Group gap="xs" wrap="nowrap">
              <Button size="xs" variant="default" loading={busy === a.id} onClick={() => restore(a.id)}>Restore</Button>
              <Button size="xs" variant="subtle" color="red" onClick={() => setDeleting(a)}>Delete</Button>
            </Group>
          </Group>
        ))}
      </Paper>
      {error && <Alert color="red" p="xs">{error}</Alert>}
      {deleting && (
        <ConfirmByIdDialog opened id={deleting.id} title={`Delete ${deleting.name}?`} action="Delete for good"
          body="Its database, users, files and settings are deleted, and can't be brought back. Its apps stop working for good."
          onConfirm={async () => { await api.deleteProject(deleting.id); await refresh(); }} onClose={() => setDeleting(null)} />
      )}
    </Stack>
  );
}
