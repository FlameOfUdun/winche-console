import { useState, type ReactNode } from "react";
import { Alert, Anchor, Button, Code, Group, Loader, Paper, SimpleGrid, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { IconDatabase, IconFolder, IconLambda, IconUsers, IconWebhook } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import { testModeRules, type ProductId, type RulesMode } from "../../api/project";
import { useSession } from "../../auth/session";
import { PageHeader } from "../../components/PageHeader";
import { surface } from "../../theme";

const INFO: Record<ProductId, { name: string; title: string; about: ReactNode; icon: typeof IconDatabase; rules?: "database" | "storage"; extra?: ReactNode }> = {
  database: {
    name: "Database", title: "Start your database", icon: IconDatabase, rules: "database",
    about: "Documents and collections, live queries and offline sync for your apps, kept in this server's PostgreSQL.",
  },
  storage: {
    name: "Storage", title: "Start storage", icon: IconFolder, rules: "storage",
    about: "Files your apps upload and download. They're kept on this server's disk; move them to a bucket any time in Storage → Settings.",
  },
  authentication: {
    name: "Authentication", title: "Start authentication", icon: IconUsers,
    about: "Sign-in for your apps' users. Email and password is on to start; add Google, Apple or your own identity provider in Sign-in methods.",
  },
  functions: {
    name: "Functions", title: "Start functions", icon: IconLambda,
    about: "Your TypeScript, run on this server when data changes, on a schedule, or when your apps call it.",
    extra: <Text size="sm" c={surface.muted}>Then deploy from your editor: <Code>winche functions deploy</Code>.</Text>,
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
  const qc = useQueryClient();
  const { user } = useSession();
  const [mode, setMode] = useState<RulesMode>("locked");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = user?.role === "Admin";

  const start = async () => {
    setBusy(true); setError(null);
    try {
      await api.startProduct(product);
      if (info.rules && mode === "test") {
        const parsed = await api.rulesParseText(testModeRules(info.rules, new Date(Date.now() + 30 * 24 * 3600 * 1000)));
        if (parsed.ok && parsed.rulesJson) await api.rulesSave(info.rules, { rulesJson: parsed.rulesJson, note: "Test mode: open for 30 days" });
      }
      await Promise.all(["project", "overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

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

          {info.rules && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>Starting rules</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {([["locked", "Locked", "Nothing can be read or written until you publish rules. Right for real data."],
                   ["test", "Test mode", "Everything allowed for 30 days, then locked. For trying things out."]] as const).map(([value, label, about]) => (
                  <UnstyledButton key={value} onClick={() => setMode(value)} aria-pressed={mode === value}
                    style={{ border: `1px solid ${mode === value ? "var(--mantine-color-winche-6)" : surface.border}`, borderRadius: 12, padding: 16,
                      background: mode === value ? "#F5F7FF" : surface.card }}>
                    <Text fw={600}>{label}</Text>
                    <Text size="sm" c={surface.muted} mt={4}>{about}</Text>
                  </UnstyledButton>
                ))}
              </SimpleGrid>
              {mode === "test" && <Alert color="yellow" p="sm">Anyone with your app's address can read and change everything for 30 days. Not for real data.</Alert>}
            </Stack>
          )}
          {info.extra}
          {error && <Alert color="red" p="xs">{error}</Alert>}
          <Group justify="flex-end" gap="sm">
            <Anchor component={Link} to="/overview" size="sm" c="dimmed">Not now</Anchor>
            <Button size="md" onClick={start} loading={busy} disabled={!admin}>{admin ? `Start ${info.name.toLowerCase()}` : "Ask an admin to start it"}</Button>
          </Group>
        </Stack>
      </Paper>
    </>
  );
}
