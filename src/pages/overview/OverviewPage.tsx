import { Alert, Anchor, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconApps, IconArrowRight, IconBroadcast, IconShieldCheck, IconDatabase, IconFolder, IconHistory, IconLambda, IconLock, IconPackage, IconPlus, IconUsers, IconWebhook } from "@tabler/icons-react";
import { EmptyState } from "../../components/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { StatusPill } from "../../components/PageHeader";
import { PageBand } from "../../components/NavPageHeader";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { when } from "../authentication/UsersView";
import { surface } from "../../theme";
import { useSession } from "../../auth/session";
import type { IntegrityData } from "../../api/apps";
import { readiness } from "../integrity/IntegrityPage";

const ICONS: Record<string, typeof IconDatabase> = {
  database: IconDatabase, storage: IconFolder, authentication: IconUsers, functions: IconLambda, assets: IconPackage, realtime: IconBroadcast, hooks: IconWebhook,
};

/** Project overview, the console's home: each product with its status and a few numbers, apps, and recent changes. */
export function OverviewPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  const projectState = useQuery({ queryKey: ["project"], queryFn: api.project, staleTime: 30_000 });
  const session = useSession();
  const integrity = useQuery({ queryKey: ["integrity"], queryFn: api.integrity, enabled: !!session?.state?.capabilities?.integrity, staleTime: 30_000 });
  if (overview.isLoading) return <Loader size="sm" />;
  if (overview.isError || !overview.data) return <Alert color="red">Couldn't load the overview: {errorMessage(overview.error)}</Alert>;
  const { project, changes } = overview.data;
  // Authentication first, like the sidebar; hooks are each product's own tab now, not a product.
  const ORDER = ["authentication", "database", "storage", "functions"];
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  const products = overview.data.products.filter((p) => p.id !== "hooks")
    .sort((a, b) => rank(a.id) - rank(b.id));


  // Counted over every product the project has, not only those this role sees.
  const all = projectState.data?.setup ? projectState.data.products : null;
  const on = all ? all.filter((p) => p.started).length : products.filter((p) => p.on).length;
  const total = all ? all.length : products.length;

  return (
    <Stack gap="lg" pb={28}>
      <PageBand title={
        <Group gap="md" wrap="nowrap">
          <ProjectAvatar version={projectState.data?.imageVersion} size={52} radius={13} />
          <div>
            <div>{project.name}</div>
            <Text size="sm" fw={400} c="var(--w-faint)" mt={2} style={{ letterSpacing: 0 }}>
              {total > 0 ? `${on} of ${total} products on · ` : ""}<Text span ff="monospace" fz="sm">{project.id}</Text>
            </Text>
          </div>
        </Group>}
        actions={<Button component={Link} to="/settings/general" variant="default" leftSection={<IconPlus size={16} />}>Add an app</Button>} />

      <Stack gap="sm">
        <Title order={2} fz={15}>Products</Title>
        {products.length === 0 && <EmptyState icon={IconLock} title="Nothing for your role yet" description="Ask an admin for access to the parts of this project you work on." />}
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
          {products.map((p) => {
            const Icon = ICONS[p.id] ?? IconApps;
            const open = p.on || !project.setup;
            return (
              <Paper key={p.id} withBorder p="lg" data-testid="product" component={Link} to={p.path} className="winche-card-link"
                aria-label={open ? `Open ${p.name}` : `Get started with ${p.name}`}
                style={{ borderStyle: p.on ? "solid" : "dashed", display: "flex", flexDirection: "column", gap: 16, color: "inherit", textDecoration: "none" }}>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
                    background: p.on ? "var(--w-accent-soft)" : surface.subtle, color: p.on ? "var(--w-accent)" : surface.muted }}>
                    <Icon size={20} stroke={1.8} />
                  </div>
                  <StatusPill tone={p.on ? "on" : "off"}>{p.on ? "On" : project.setup ? "Not started" : "Not set up"}</StatusPill>
                </Group>
                <div>
                  <Text fw={600} fz={16}>{p.name}</Text>
                  <Text size="sm" c={surface.faint} mt={2}>{p.about}</Text>
                </div>
                <Group mt="auto" justify="space-between" align="flex-end" wrap="nowrap">
                  {p.stats.length > 0 && open ? (
                    <Group gap="lg" wrap="nowrap">
                      {p.stats.map((s) => (
                        <div key={s.label}>
                          <Text fz={20} fw={700} lh={1.2}>{s.value}</Text>
                          <Text size="xs" c={surface.faint}>{s.label}</Text>
                        </div>
                      ))}
                    </Group>
                  ) : <span />}
                  <Group gap={4} c={surface.accent} wrap="nowrap">
                    <Text size="sm" fw={600}>{open ? "Open" : "Get started"}</Text>
                    <IconArrowRight size={15} />
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      </Stack>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Paper withBorder p="lg" style={{ gridColumn: "span 2" }} className="winche-span-2">
          <Title order={2} fz={15} mb="xs">Recent changes</Title>
          {changes.length === 0 && <EmptyState compact bordered={false} icon={IconHistory} title="Nothing has changed yet" description="Saved changes show here." />}
          {changes.map((c, i) => (
            <Group key={i} gap="md" py={8} wrap="nowrap" data-testid="change" align="baseline"
              style={{ borderTop: i === 0 ? undefined : `1px solid ${surface.subtle}` }}>
              <Text size="sm" style={{ flex: 1, minWidth: 0 }}>{c.what}</Text>
              <Text size="xs" c={surface.faint} style={{ whiteSpace: "nowrap" }} visibleFrom="sm">{c.by ?? "—"}</Text>
              <Text size="xs" c={surface.faint} style={{ whiteSpace: "nowrap" }} w={160} ta="right">{when(c.at)}</Text>
            </Group>
          ))}
        </Paper>
        {integrity.data?.available ? <IntegritySummary data={integrity.data} /> : (
          <Paper withBorder p="lg">
            <Group gap={10} mb={6}>
              <IconApps size={18} color="var(--w-accent)" />
              <Title order={2} fz={15}>Your apps</Title>
            </Group>
            <Text size="sm" c={surface.muted}>No apps yet.</Text>
            {session?.state?.capabilities?.integrity && (
              <Anchor component={Link} to="/integrity" fw={600} size="sm" mt="md" display="inline-block">Manage apps →</Anchor>
            )}
          </Paper>
        )}
      </SimpleGrid>
    </Stack>
  );
}

/** Integrity at a glance: the apps (and any that can't prove themselves), what's enforced, today's verified share. */
function IntegritySummary({ data }: { data: IntegrityData }) {
  const enforced = data.products.filter((p) => data.enforcement[p] === "enforce");
  const ok = data.apps.reduce((n, a) => n + Object.values(a.usage).reduce((m, u) => m + u.today, 0), 0);
  const no = Object.values(data.unverified).reduce((n, u) => n + u.today, 0);
  const unready = data.apps.filter((a) => readiness(a, data).some((r) => r.color === "red")).length;
  const label = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  const allOff = data.products.every((p) => data.enforcement[p] === "off");
  return (
    <Paper withBorder p="lg" data-testid="integrity-summary">
      <Group gap={10} mb={6}>
        <IconShieldCheck size={18} color="var(--w-accent)" />
        <Title order={2} fz={15}>Integrity</Title>
      </Group>
      <Stack gap={4}>
        <Text size="sm">{data.apps.length === 0 ? "No apps yet" : `${data.apps.length} app${data.apps.length === 1 ? "" : "s"}`}{unready ? <Text span c="red" size="sm">{` · ${unready} not set up`}</Text> : null}</Text>
        <Text size="sm" c={surface.muted}>{enforced.length ? `Enforced: ${enforced.map(label).join(", ")}` : allOff ? "Off: no product checks tokens" : "Monitoring: nothing refused yet"}</Text>
        <Text size="sm" c={surface.muted}>{ok + no === 0 ? "No requests today" : `Today ${Math.floor((ok / (ok + no)) * 100)}% verified (${ok.toLocaleString()} of ${(ok + no).toLocaleString()})`}</Text>
      </Stack>
      <Anchor component={Link} to="/integrity" fw={600} size="sm" mt="md" display="inline-block">{data.apps.length ? "Integrity →" : "Add an app →"}</Anchor>
    </Paper>
  );
}
