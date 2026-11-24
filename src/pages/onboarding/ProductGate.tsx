import { useState, type ReactNode } from "react";
import { Anchor, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import {
  IconArrowRight, IconBolt, IconBroadcast, IconList, IconUsersGroup, IconBrandGoogle, IconBucket, IconClock, IconCloudOff, IconDatabase, IconFolder, IconHistory, IconLambda, IconMail, IconPackage, IconRoute, IconPlugConnected,
  IconShieldCheck, IconShieldLock, IconUpload, IconUsers,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SetupProgress } from "./SetupProgress";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { ProductId } from "../../api/project";
import { ProductWizard } from "./ProductWizard";
import { useSession } from "../../auth/session";
import { PageBand } from "../../components/NavPageHeader";
import { surface } from "../../theme";

type Feature = { icon: typeof IconDatabase; title: string; about: string };
const INFO: Record<ProductId, { name: string; title: string; about: ReactNode; icon: typeof IconDatabase; features: Feature[] }> = {
  database: {
    name: "Database", title: "Start your database", icon: IconDatabase,
    about: "Documents and collections for your apps, kept in this server's PostgreSQL.",
    features: [
      { icon: IconBolt, title: "Live queries", about: "Apps see changes as they happen." },
      { icon: IconCloudOff, title: "Offline", about: "Reads and writes keep working without a connection." },
      { icon: IconShieldCheck, title: "Rules", about: "Who reads and writes what, checked on the server." },
    ],
  },
  storage: {
    name: "Storage", title: "Start storage", icon: IconFolder,
    about: "Files your apps upload and download.",
    features: [
      { icon: IconUpload, title: "Uploads and downloads", about: "Resumable, through signed links." },
      { icon: IconBucket, title: "Disk or bucket", about: "This server's disk, S3, R2 or MinIO." },
      { icon: IconShieldCheck, title: "Rules", about: "Who reads and writes which files." },
    ],
  },
  authentication: {
    name: "Authentication", title: "Start authentication", icon: IconUsers,
    about: "Sign-in for your apps' users.",
    features: [
      { icon: IconMail, title: "Email and password", about: "With verification, reset and email links." },
      { icon: IconBrandGoogle, title: "Google, Apple and more", about: "Or any OpenID Connect provider." },
      { icon: IconShieldLock, title: "Two-step sign-in", about: "Authenticator apps and recovery codes." },
    ],
  },
  functions: {
    name: "Functions", title: "Start functions", icon: IconLambda,
    about: "Your TypeScript, run on this server.",
    features: [
      { icon: IconPlugConnected, title: "Called by your apps", about: "With the signed-in user passed in." },
      { icon: IconBolt, title: "On changes", about: "When documents, files or users change." },
      { icon: IconClock, title: "On a schedule", about: "Every few minutes, hours or days." },
    ],
  },
  assets: {
    name: "Assets", title: "Start assets", icon: IconPackage,
    about: "Content your apps download and keep offline: translations, pages, images and videos, published in releases.",
    features: [
      { icon: IconHistory, title: "Releases", about: "Numbered and kept, so going back is one click." },
      { icon: IconRoute, title: "Channels", about: "Production, beta or one per app version." },
      { icon: IconShieldCheck, title: "Rules", about: "Who may read which paths." },
    ],
  },
  realtime: {
    name: "Realtime", title: "Start realtime", icon: IconBroadcast,
    about: "Live lists, channels and presence for sessions.",
    features: [
      { icon: IconList, title: "Lists", about: "Ordered items devices add to and follow live." },
      { icon: IconBroadcast, title: "Channels", about: "Messages for whoever is listening, not kept." },
      { icon: IconUsersGroup, title: "Presence", about: "Who's here now, and what they share." },
    ],
  },
};

/** Whether a product's page can show: started (or no project setup on this console). Otherwise its Get started page. (The project itself always exists here: RequireProject sees to it.) */
export function ProductGate({ product, children }: { product: ProductId; children: ReactNode }) {
  const project = useQuery({ queryKey: ["project"], queryFn: api.project, staleTime: 30_000 });
  if (project.isLoading) return <Loader size="sm" />;
  const p = project.data;
  if (!p || !p.setup) return <>{children}</>;
  const state = p.products.find((x) => x.id === product);
  // Started and set up (older servers don't say: started is enough).
  if (state?.started && state.ready !== false) return <>{children}</>;
  // Being set up, or its setup failed: follow it here.
  if (state?.setup && (state.setup.state === "running" || state.setup.state === "failed") || (state?.started && state.ready === false))
    return <SettingUp product={product} />;
  return <GetStarted product={product} />;
}

function SettingUp({ product }: { product: ProductId }) {
  const qc = useQueryClient();
  return (
    <>
      <PageBand title={INFO[product].name} />
      <Paper withBorder radius="md" p="lg">
        <Stack gap="md">
          <Title order={4}>Setting up {INFO[product].name.toLowerCase()}</Title>
          <SetupProgress product={product} onDone={() => void qc.invalidateQueries({ queryKey: ["project"] })} />
        </Stack>
      </Paper>
    </>
  );
}

function GetStarted({ product }: { product: ProductId }) {
  const info = INFO[product];
  const Icon = info.icon;
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const admin = user?.role === "Admin";
  return (
    <>
      <PageBand title={info.name} />
      <Stack gap="lg" data-testid="get-started">
        <Paper withBorder radius="lg" p={{ base: 24, sm: 40 }} style={{
          position: "relative", overflow: "hidden",
          background: "radial-gradient(circle at 85% 20%, var(--w-accent-soft) 0%, transparent 45%), linear-gradient(135deg, var(--w-accent-soft) 0%, var(--w-card) 65%)",
        }}>
          <Icon size={220} stroke={1} color="var(--w-accent)"
            style={{ position: "absolute", right: -20, bottom: -40, opacity: 0.07, pointerEvents: "none" }} />
          <Stack gap="lg" style={{ position: "relative" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, display: "grid", placeItems: "center",
              background: "var(--mantine-color-winche-6)", color: "#fff", boxShadow: "0 8px 24px rgba(47, 79, 216, 0.25)" }}>
              <Icon size={28} stroke={1.8} />
            </div>
            <div>
              <Title order={2} fz={{ base: 24, sm: 30 }} style={{ letterSpacing: "-0.02em" }}>{info.title}</Title>
              <Text c={surface.muted} mt={8} fz={16} maw={560}>{info.about}</Text>
            </div>
            <Group gap="md">
              <Button size="md" onClick={() => setOpen(true)} disabled={!admin} rightSection={admin ? <IconArrowRight size={18} /> : undefined}>
                {admin ? "Get started" : "Ask an admin to set it up"}
              </Button>
              <Anchor component={Link} to="/overview" size="sm" c="dimmed">Not now</Anchor>
            </Group>
          </Stack>
        </Paper>
        {info.features.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            {info.features.map((f) => {
              const FIcon = f.icon;
              return (
                <Paper key={f.title} withBorder radius="md" p="lg">
                  <div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center",
                    background: "var(--w-accent-soft)", color: "var(--w-accent)" }}>
                    <FIcon size={19} stroke={1.8} />
                  </div>
                  <Text fw={600} mt="sm">{f.title}</Text>
                  <Text size="sm" c={surface.muted} mt={4}>{f.about}</Text>
                </Paper>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>
      <ProductWizard product={product} opened={open} onClose={() => setOpen(false)} />
    </>
  );
}
