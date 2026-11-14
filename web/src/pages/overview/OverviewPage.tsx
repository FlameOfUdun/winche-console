import { Alert, Anchor, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconApps, IconDatabase, IconFolder, IconHistory, IconLambda, IconLock, IconPlus, IconUsers, IconWebhook } from "@tabler/icons-react";
import { EmptyState } from "../../components/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { PageHeader, StatusPill } from "../../components/PageHeader";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";

const ICONS: Record<string, typeof IconDatabase> = {
  database: IconDatabase, storage: IconFolder, authentication: IconUsers, functions: IconLambda, hooks: IconWebhook,
};

/** Project overview, the console's home: each product with its status and a few numbers, apps, and recent changes. */
export function OverviewPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  if (overview.isLoading) return <Loader size="sm" />;
  if (overview.isError || !overview.data) return <Alert color="red">Couldn't load the overview: {errorMessage(overview.error)}</Alert>;
  const { project, products, changes } = overview.data;

  return (
    <Stack gap="xl">
      <PageHeader eyebrow="Project overview" title={project.name}
        actions={<Button component={Link} to="/settings/general" leftSection={<IconPlus size={16} />}>Add an app</Button>} />

      <Stack gap="sm">
        <Title order={2} fz={15}>Products</Title>
        {products.length === 0 && <EmptyState icon={IconLock} title="Nothing for your role yet" description="Ask an admin for access to the parts of this project you work on." />}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {products.map((p) => {
            const Icon = ICONS[p.id] ?? IconApps;
            return (
              <Paper key={p.id} withBorder p="lg" data-testid="product"
                style={{ borderStyle: p.on ? "solid" : "dashed", display: "flex", flexDirection: "column", gap: 14 }}>
                <Group gap={12} wrap="nowrap">
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
                    background: p.on ? "var(--mantine-color-winche-0)" : surface.subtle, color: p.on ? "var(--mantine-color-winche-6)" : surface.muted }}>
                    <Icon size={20} stroke={1.8} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600}>{p.name}</Text>
                    <Text size="sm" c={surface.faint} lineClamp={2}>{p.about}</Text>
                  </div>
                  <StatusPill tone={p.on ? "on" : "off"}>{p.on ? "On" : "Not set up"}</StatusPill>
                </Group>
                {p.stats.length > 0 && (
                  <SimpleGrid cols={3} spacing="xs">
                    {p.stats.map((s) => (
                      <div key={s.label}>
                        <Text fz={20} fw={700} lh={1.2}>{s.value}</Text>
                        <Text size="xs" c={surface.faint}>{s.label}</Text>
                      </div>
                    ))}
                  </SimpleGrid>
                )}
                <Anchor component={Link} to={p.path} fw={600} size="sm" mt="auto">Open {p.name} →</Anchor>
              </Paper>
            );
          })}
        </SimpleGrid>
      </Stack>

      <Paper withBorder p="lg">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <div>
            <Title order={2} fz={15}>Your apps</Title>
            <Text size="sm" c={surface.faint} mt={2}>Connect a Flutter or Dart app: run <code>winche configure</code> in its folder, or download its options file.</Text>
          </div>
          <Anchor component={Link} to="/settings/general" fw={600} size="sm">Project settings →</Anchor>
        </Group>
      </Paper>

      <Paper withBorder p="lg">
        <Title order={2} fz={15} mb="xs">Recent changes</Title>
        {changes.length === 0 && <EmptyState compact bordered={false} icon={IconHistory} title="Nothing has changed yet" description="Rules, function versions and settings changes show here, with who made them." />}
          {changes.map((c, i) => (
            <Group key={i} gap="md" py={8} wrap="wrap" data-testid="change"
              style={{ borderTop: i === 0 ? undefined : `1px solid ${surface.subtle}` }}>
              <Text size="sm" c={surface.faint} w={150}>{when(c.at)}</Text>
              <Text size="sm" style={{ flex: 1, minWidth: 200 }}>{c.what}</Text>
              <Text size="sm" c={surface.faint}>{c.by ?? "—"}</Text>
            </Group>
          ))}
      </Paper>
    </Stack>
  );
}
