import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Anchor, Badge, Button, Grid, Group, List, Loader, Paper, Select, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconArrowLeft, IconDownload, IconExternalLink, IconKey } from "@tabler/icons-react";
import { api } from "../../api/client";
import { errorWithList } from "../../api/appAuth";
import { PageBand } from "../../components/NavPageHeader";
import { when } from "../authentication/UsersView";
import { Access, CatalogBadge, Markdown, PluginIcon } from "./shared";
import { installPath, installedPath, packagePath } from "./PluginsPage";

/** A package before it's installed: its README, what it does and asks for, its versions, and Install. */
export function PackagePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const name = params.get("name") ?? "";
  const version = params.get("version");
  const pkg = useQuery({ queryKey: ["plugin-package", name, version], queryFn: () => api.pluginPackage(name, version), enabled: !!name });
  const versions = useQuery({ queryKey: ["plugin-versions", name], queryFn: () => api.pluginVersions(name), enabled: !!name, retry: false });
  const installed = useQuery({ queryKey: ["plugins"], queryFn: api.plugins });
  const back = <Anchor component={Link} to="/plugins/browse" size="sm"><Group gap={4}><IconArrowLeft size={14} />Plugins</Group></Anchor>;
  if (pkg.isLoading) return <><PageBand title={name}>{back}</PageBand><Loader size="sm" /></>;
  if (pkg.isError || !pkg.data) return (
    <><PageBand title={name}>{back}</PageBand><Alert color="red" style={{ whiteSpace: "pre-line" }} title="This package can't be shown">{errorWithList(pkg.error)}</Alert></>
  );
  const p = pkg.data, m = p.manifest, about = p.about;
  // A package says where its homepage and source are: links only to web addresses (never javascript: or the like).
  const homepage = webAddress(about?.homepage), repository = webAddress(about?.repository);
  const curated = p.curated === true;
  const copies = (installed.data?.plugins ?? []).filter((x) => x.package === p.package);
  return (
    <>
      <PageBand
        title={<Group gap={12} wrap="nowrap"><PluginIcon size={40} /><span>{m.title}</span></Group>}
        description={m.description ?? about?.description ?? undefined}
        actions={<Button component={Link} to={installPath(p.package, version ?? p.version)} leftSection={<IconDownload size={16} />}>Install</Button>}>
        <Group gap="md" mt="sm" wrap="wrap">
          {back}
          <Text size="sm" ff="monospace" c="dimmed">{p.package} {p.version}</Text>
          {about?.author && <Text size="sm" c="dimmed">by {about.author}</Text>}
          {about?.license && <Badge variant="light" color="gray" tt="none">{about.license}</Badge>}
          <CatalogBadge curated={curated} />
          {homepage && <Anchor href={homepage} target="_blank" rel="noreferrer noopener" size="sm"><Group gap={3}>Homepage<IconExternalLink size={13} /></Group></Anchor>}
          {repository && repository !== homepage && <Anchor href={repository} target="_blank" rel="noreferrer noopener" size="sm"><Group gap={3}>Source<IconExternalLink size={13} /></Group></Anchor>}
        </Group>
      </PageBand>
      <div style={{ paddingBottom: 28 }}>
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Paper withBorder radius="md" p="lg" data-testid="readme">
              {about?.readme ? <Markdown>{about.readme}</Markdown> : <Text size="sm" c="dimmed">This package has no README.</Text>}
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="md">
              {copies.length > 0 && (
                <Paper withBorder radius="md" p="md">
                  <Text size="sm" fw={600} mb={6}>Installed here as</Text>
                  <Group gap={6}>{copies.map((c) => <Badge key={c.id} component={Link} to={installedPath(c.id)} variant="light" tt="none" ff="monospace" style={{ cursor: "pointer" }}>{c.id} · {c.version}</Badge>)}</Group>
                </Paper>
              )}
              <Access manifest={m} curated={curated} compact />
              <Paper withBorder radius="md" p="md">
                <Text size="sm" fw={600} mb={6}>It asks for</Text>
                {m.settings.length + m.secrets.length === 0 ? <Text size="sm" c="dimmed">Nothing.</Text> : (
                  <>
                    <List size="sm" spacing={4}>
                      {m.settings.filter((s) => s.required).map((s) => <List.Item key={s.name}>{s.label}</List.Item>)}
                      {m.secrets.filter((s) => s.required).map((s) => <List.Item key={s.name} icon={<IconKey size={14} style={{ marginTop: 3 }} />}>{s.label}</List.Item>)}
                    </List>
                    {m.settings.some((s) => !s.required) && (
                      <Text size="xs" c="dimmed" mt={6}>
                        and {m.settings.filter((s) => !s.required).length} optional settings
                        {[...new Set(m.settings.filter((s) => !s.required && s.section).map((s) => s.section))].length > 0
                          && ` (${[...new Set(m.settings.filter((s) => !s.required && s.section).map((s) => s.section))].join(", ")})`}
                      </Text>
                    )}
                  </>
                )}
              </Paper>
              <Paper withBorder radius="md" p="md">
                <Text size="sm" fw={600} mb={6}>Version</Text>
                {versions.data ? (
                  <Select aria-label="Version" value={p.version} allowDeselect={false}
                    data={versions.data.versions.map((v) => ({ value: v.version, label: v.at ? `${v.version} · ${when(v.at)}` : v.version }))}
                    onChange={(v) => { if (v) navigate(packagePath(p.package, v), { replace: true }); }} />
                ) : <Text size="sm" c="dimmed">{p.version}</Text>}
                <Text size="xs" c="dimmed" mt={6}>An installed copy stays on its version until it's upgraded.</Text>
              </Paper>
            </Stack>
          </Grid.Col>
        </Grid>
      </div>
    </>
  );
}

/** The address when it's http(s), else null. */
export function webAddress(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : null; } catch { return null; }
}
