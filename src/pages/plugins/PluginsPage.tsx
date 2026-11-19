import { useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Alert, Badge, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { IconArrowRight, IconArrowUp, IconDownload, IconKey, IconPlus, IconPuzzle, IconSearch } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorMessage } from "../../api/appAuth";
import type { InstalledPlugin } from "../../api/functions";
import { EmptyState } from "../../components/EmptyState";
import { PageBand } from "../../components/NavPageHeader";
import { surface } from "../../theme";
import { CatalogBadge, PluginIcon } from "./shared";
import { PackagePage } from "./PackagePage";
import { InstallWizard } from "./InstallWizard";
import { InstalledPluginPage } from "./InstalledPluginPage";

/** Where a package's page is (its name in the query: npm names have slashes). */
export const packagePath = (pkg: string, version?: string | null) => `/plugins/browse/package?name=${encodeURIComponent(pkg)}${version ? `&version=${encodeURIComponent(version)}` : ""}`;
export const installPath = (pkg: string, version?: string | null) => `/plugins/install?name=${encodeURIComponent(pkg)}${version ? `&version=${encodeURIComponent(version)}` : ""}`;
export const installedPath = (id: string) => `/plugins/installed/${encodeURIComponent(id)}`;

/**
 * Plugins: packages of functions the project installs instead of writing them. Installed copies, browsing the server's
 * catalog and npm, a page about each package, installing it step by step, and a page for each installed copy.
 */
export function PluginsPage() {
  return (
    <Routes>
      <Route index element={<Home tab="installed" />} />
      <Route path="browse" element={<Home tab="browse" />} />
      <Route path="browse/package" element={<PackagePage />} />
      <Route path="install" element={<InstallWizard />} />
      <Route path="installed/:id" element={<InstalledPluginPage />} />
      <Route path="*" element={<Navigate to="/plugins" replace />} />
    </Routes>
  );
}

function Home({ tab }: { tab: "installed" | "browse" }) {
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.plugins });
  const count = plugins.data?.plugins.length;
  return (
    <>
      <PageBand title="Plugins" description="Ready-made functions, such as an integration with another service: install one, give its settings and keys, and apps call its functions."
        tabs={[
          { label: count ? `Installed (${count})` : "Installed", to: "/plugins", active: tab === "installed" },
          { label: "Browse", to: "/plugins/browse", active: tab === "browse" },
        ]} />
      <div style={{ paddingBottom: 28 }}>
        {tab === "installed" ? <Installed query={plugins} /> : <Browse installed={plugins.data?.plugins ?? []} />}
      </div>
    </>
  );
}

function Installed({ query }: { query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.plugins>>>> }) {
  if (query.isLoading) return <Loader size="sm" />;
  if (query.isError || !query.data) return <Alert color="red">Couldn't load the plugins: {errorMessage(query.error)}</Alert>;
  const list = query.data.plugins;
  if (list.length === 0) return (
    <EmptyState icon={IconPuzzle} title="No plugins yet"
      description="Browse the plugins this server offers, or any on npm, and install one in a few steps."
      action={<Button component={Link} to="/plugins/browse" leftSection={<IconSearch size={16} />}>Browse plugins</Button>} />
  );
  return (
    <Stack gap="sm">
      <Group justify="flex-end"><Button component={Link} to="/plugins/browse" leftSection={<IconPlus size={16} />}>Add plugin</Button></Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {list.map((p) => <InstalledCard key={p.id} p={p} />)}
      </SimpleGrid>
    </Stack>
  );
}

function InstalledCard({ p }: { p: InstalledPlugin }) {
  return (
    <UnstyledButton component={Link} to={installedPath(p.id)} data-testid="plugin" aria-label={`${p.manifest.title} (${p.id})`}>
      <Paper withBorder p="lg" className="winche-card-link" h="100%" style={{ display: "flex", flexDirection: "column" }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <PluginIcon />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} fz={16} truncate>{p.manifest.title}</Text>
            <Group gap={6} wrap="nowrap" mt={2}>
              <Badge variant="light" tt="none" ff="monospace" size="sm" style={{ flexShrink: 0, maxWidth: "60%" }}>{p.id}</Badge>
              <Text size="xs" c="dimmed" ff="monospace" truncate>{p.package} {p.version}</Text>
            </Group>
          </div>
        </Group>
        {p.manifest.description && <Text size="sm" mt={10} lineClamp={2}>{p.manifest.description}</Text>}
        <Group gap={6} mt={10}>
          {p.secretsNeeded.length > 0 && <Badge color="orange" variant="light" tt="none" leftSection={<IconKey size={12} />}>Needs {p.secretsNeeded.length === 1 ? "a secret" : `${p.secretsNeeded.length} secrets`}</Badge>}
          {p.update && <Badge color="blue" variant="light" tt="none" leftSection={<IconArrowUp size={12} />}>{p.latest} is out</Badge>}
          {p.source === "deploy" && <Badge color="gray" variant="light" tt="none">From winche.json</Badge>}
          {!p.curated && <Badge color="yellow" variant="light" tt="none">Not in the catalog</Badge>}
        </Group>
        <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap" style={{ marginTop: "auto", paddingTop: 16 }}>
          <Text size="xs" c="dimmed">{p.functions.length} {p.functions.length === 1 ? "function" : "functions"}</Text>
          <Group gap={4} c={surface.accent} wrap="nowrap"><Text size="sm" fw={600}>Manage</Text><IconArrowRight size={15} /></Group>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

/** 5400 → "5.4k". */
export const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

/** One package in a list: its title (or name), what it is, its version, publisher and use, and whether the server offers it. */
function PackageCard({ pkg, title, description, version, publisher, curated, installed, problem, downloads }: {
  pkg: string; title: string; description: string | null; version: string | null; publisher?: string | null; curated: boolean; installed: number;
  problem?: string | null; downloads?: number | null;
}) {
  return (
    <UnstyledButton component={Link} to={packagePath(pkg)} data-testid="package" aria-label={title}>
      <Paper withBorder p="lg" className="winche-card-link" h="100%" style={{ display: "flex", flexDirection: "column" }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <PluginIcon />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} fz={16} truncate>{title}</Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>{pkg}{version ? ` ${version}` : ""}</Text>
          </div>
        </Group>
        {description && <Text size="sm" mt={10} lineClamp={3}>{description}</Text>}
        {problem && <Text size="xs" c="red" mt={6}>{problem}</Text>}
        <Group justify="space-between" align="flex-end" gap="xs" style={{ marginTop: "auto", paddingTop: 16 }}>
          <Group gap={6}>
            <CatalogBadge curated={curated} />
            {installed > 0 && <Badge color="gray" variant="light" tt="none">Installed{installed > 1 ? ` ×${installed}` : ""}</Badge>}
          </Group>
          <Group gap={8} wrap="nowrap">
            {downloads != null && <Group gap={3} wrap="nowrap" c="dimmed"><IconDownload size={13} /><Text size="xs" title={`${downloads} downloads in the last month`}>{compact(downloads)}/mo</Text></Group>}
            {publisher && <Text size="xs" c="dimmed" truncate maw={110}>by {publisher}</Text>}
          </Group>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

function Browse({ installed }: { installed: InstalledPlugin[] }) {
  const catalog = useQuery({ queryKey: ["plugin-catalog"], queryFn: api.pluginCatalog, staleTime: 60_000 });
  const [text, setText] = useState("");
  const [q] = useDebouncedValue(text.trim(), 300);
  const search = useQuery({ queryKey: ["plugin-search", q], queryFn: () => api.pluginSearch(q), staleTime: 60_000 });
  const copies = (pkg: string) => installed.filter((p) => p.package === pkg).length;
  const offered = catalog.data?.plugins ?? [];
  const isOffered = (pkg: string) => offered.some((c) => c.package === pkg);
  const results = search.data?.results ?? [];
  const looksLikeName = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(q);
  const grid = (children: React.ReactNode) => <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">{children}</SimpleGrid>;
  const npmCard = (r: (typeof results)[number]) => (
    <PackageCard key={r.package} pkg={r.package} title={offered.find((c) => c.package === r.package)?.title ?? r.package} description={r.description}
      version={r.version} publisher={r.publisher} curated={r.curated || isOffered(r.package)} installed={copies(r.package)} downloads={r.downloads} />
  );
  const catalogCard = (c: (typeof offered)[number]) => (
    <PackageCard key={c.package} pkg={c.package} title={c.title} description={c.description} version={c.version}
      publisher={c.author} curated installed={copies(c.package)} problem={c.problem} downloads={results.find((r) => r.package === c.package)?.downloads} />
  );
  // Searching: the catalog's matches first, then npm's (its best matches first).
  const lower = q.toLowerCase();
  const catalogMatches = offered.filter((c) => [c.package, c.title, c.description ?? ""].some((x) => x.toLowerCase().includes(lower)));
  const searchHits = [...catalogMatches.map(catalogCard), ...results.filter((r) => !catalogMatches.some((c) => c.package === r.package)).map(npmCard)];
  return (
    <Stack gap="xl">
      <TextInput size="md" radius="md" placeholder="Search plugins on npm and this server, or type a package name"
        leftSection={<IconSearch size={18} />} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Search plugins"
        rightSection={search.isFetching ? <Loader size={16} /> : null} />
      {q ? (
        <Stack gap="sm">
          <Text fw={600}>Results for “{q}”</Text>
          {search.isLoading ? <Loader size="sm" /> : searchHits.length === 0
            ? <Text size="sm" c="dimmed">Nothing found.{looksLikeName && <> Open <Link to={packagePath(q)}>{q}</Link> by its name.</>}</Text>
            : grid(searchHits)}
        </Stack>
      ) : (
        <>
          <Stack gap="sm">
            <div>
              <Text fw={600}>Offered by this server</Text>
              <Text size="sm" c="dimmed">The plugins this server's admins trust (Server settings → Plugins).</Text>
            </div>
            {catalog.isLoading ? <Loader size="sm" /> : offered.length === 0 ? <Text size="sm" c="dimmed">None yet.</Text> : grid(offered.map(catalogCard))}
          </Stack>
          <Stack gap="sm">
            <div>
              <Text fw={600}>Popular on npm</Text>
              <Text size="sm" c="dimmed">The most downloaded packages with the keyword winche-plugin, and this server's plugin folder. Nobody here has vouched for them.</Text>
            </div>
            {search.isLoading ? <Loader size="sm" /> : results.filter((r) => !isOffered(r.package)).length === 0
              ? <Text size="sm" c="dimmed">Nothing else found.</Text>
              : grid(results.filter((r) => !isOffered(r.package)).map(npmCard))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
