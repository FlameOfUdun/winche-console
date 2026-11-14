import { useState, type ReactNode } from "react";
import { Anchor, Button, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { IconDatabase, IconFolder, IconLambda, IconUsers, IconWebhook } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { ProductId } from "../../api/project";
import { ProductWizard } from "./ProductWizard";
import { useSession } from "../../auth/session";
import { PageHeader } from "../../components/PageHeader";
import { surface } from "../../theme";

const INFO: Record<ProductId, { name: string; title: string; about: ReactNode; icon: typeof IconDatabase; rules?: "database" | "storage" }> = {
  database: {
    name: "Database", title: "Start your database", icon: IconDatabase, rules: "database",
    about: "Documents and collections, live queries and offline sync for your apps, kept in this server's PostgreSQL.",
  },
  storage: {
    name: "Storage", title: "Start storage", icon: IconFolder, rules: "storage",
    about: "Files your apps upload and download, on this server's disk or in a bucket.",
  },
  authentication: {
    name: "Authentication", title: "Start authentication", icon: IconUsers,
    about: "Sign-in for your apps' users: email and password, guests, email links, Google, Apple or your own identity provider.",
  },
  functions: {
    name: "Functions", title: "Start functions", icon: IconLambda,
    about: "Your TypeScript, run on this server when data changes, on a schedule, or when your apps call it.",
  },
  hooks: {
    name: "Hooks", title: "Start hooks", icon: IconWebhook,
    about: "Call an address of yours, or run a ready-made action, when documents, files or users change.",
  },
};

/** Whether a product's page can show: started (or no project setup on this console). Otherwise its Get started page. (The project itself always exists here: RequireProject sees to it.) */
export function ProductGate({ product, children }: { product: ProductId; children: ReactNode }) {
  const project = useQuery({ queryKey: ["project"], queryFn: api.project, staleTime: 30_000 });
  if (project.isLoading) return <Loader size="sm" />;
  const p = project.data;
  if (!p || !p.setup) return <>{children}</>;
  if (p.products.find((x) => x.id === product)?.started) return <>{children}</>;
  return <GetStarted product={product} />;
}

function GetStarted({ product }: { product: ProductId }) {
  const info = INFO[product];
  const Icon = info.icon;
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const admin = user?.role === "Admin";
  return (
    <>
      <PageHeader eyebrow="Build" title={info.name} />
      <Paper withBorder p={32} maw={880} data-testid="get-started">
        <Stack gap="lg">
          <Group gap="md" align="flex-start" wrap="nowrap">
            <div style={{ width: 48, height: 48, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0,
              background: "var(--mantine-color-winche-0)", color: "var(--mantine-color-winche-6)" }}>
              <Icon size={24} stroke={1.8} />
            </div>
            <div>
              <Title order={2} fz={20}>{info.title}</Title>
              <Text size="sm" c={surface.muted} mt={6} lh={1.55}>{info.about}</Text>
            </div>
          </Group>
          <Group justify="flex-end" gap="sm">
            <Anchor component={Link} to="/overview" size="sm" c="dimmed">Not now</Anchor>
            <Button size="md" onClick={() => setOpen(true)} disabled={!admin}>{admin ? "Get started" : "Ask an admin to set it up"}</Button>
          </Group>
        </Stack>
      </Paper>
      <ProductWizard product={product} opened={open} onClose={() => setOpen(false)} />
    </>
  );
}
