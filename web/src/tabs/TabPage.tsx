import { Loader, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { CommandSpec, ControlSpec, LayoutNode } from "../api/tabs";
import { RenderNode, type FilterState } from "./nodes/render";
import { visibleWidgetIds } from "./nodes/visible";
import { useTabLayout } from "./useTabsManifest";
import { TabRuntimeProvider, canRunFor, type RoleName, type RunOptions, type TabRuntime } from "./runtime";
import { CommandModal } from "./commands/CommandModal";
import { useSession } from "../auth/session";

// Default value for each control: first option for select, empty for date range.
function initialValues(node: LayoutNode, acc: Record<string, string>): Record<string, string> {
  if (node.type === "filter") {
    const c: ControlSpec = node.control;
    if (c.kind === "select") acc[c.id] = c.options[0] ?? "";
    const kids = node.mode === "switch" ? Object.values(node.branches).flat() : node.children;
    kids.forEach((k) => initialValues(k, acc));
  } else if (node.type !== "widget" && node.type !== "embed" && node.type !== "button") {
    node.children.forEach((k) => initialValues(k, acc));
  }
  return acc;
}

export function TabPage() {
  const { tabId } = useParams();
  const layout = useTabLayout(tabId);
  const { user } = useSession();
  const [values, setValues] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
  const [pending, setPending] = useState<{ cmd: CommandSpec; opts: RunOptions } | null>(null);

  const root = layout.data?.root;
  useEffect(() => { setValues(root ? initialValues(root, {}) : {}); setDrafts({}); }, [tabId, root]);

  const visibleIds = useMemo(() => (root ? visibleWidgetIds(root, values) : []), [root, values]);

  const data = useQuery({
    queryKey: ["console-tab-data", tabId, visibleIds, values, nonce],
    queryFn: () => api.consoleTabData(tabId!, visibleIds, values),
    enabled: !!root && visibleIds.length > 0,
    // Keep previous data only WITHIN the same tab (smooths filter/page/refresh — no reload flicker). On a tab
    // SWITCH the layout is already the new tab's tree, so serving the old tab's widgets would render every new
    // widget against a missing slice → a red "couldn't be displayed" flash. Drop it there so the loader shows.
    placeholderData: (prev, prevQuery) => (prevQuery && prevQuery.queryKey[1] === tabId ? prev : undefined),
  });

  if (layout.isLoading) return <Loader />;
  if (layout.isError || !root) return <Navigate to="/" replace />;

  // A changed filter/search invalidates the current page (a narrower result set can leave you stranded on a
  // now-empty, pager-hidden page). Drop every reserved "page:*" key so paging resets to 1; paginating itself
  // (setValue with a "page:" key) preserves the other keys.
  const dropPageKeys = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("page:")));

  const commit = () => { setValues((v) => ({ ...dropPageKeys(v), ...drafts })); setDrafts({}); };
  const refresh = () => { commit(); setNonce((n) => n + 1); };

  const filters: FilterState = {
    values, drafts,
    setValue: (k, v) => setValues((p) => ({ ...(k.startsWith("page:") ? p : dropPageKeys(p)), [k]: v })),
    setDraft: (k, v) => setDrafts((p) => ({ ...p, [k]: v })),
    commit,
  };

  const userRole = (user?.role?.toLowerCase() ?? "viewer") as RoleName;
  const runtime: TabRuntime = {
    commands: layout.data?.commands ?? {},
    userRole,
    canRun: (c) => canRunFor(userRole, c),
    runCommand: (cmd, opts) => setPending({ cmd, opts }),
    refresh, commit,
  };

  return (
    <TabRuntimeProvider value={runtime}>
      <Stack>
        <Title order={3}>{layout.data!.label}</Title>
        {data.isError && <Text c="red">Failed to load data.</Text>}
        {data.isLoading ? <Loader /> : <RenderNode node={root} filters={filters} data={data.data?.widgets ?? {}} />}
      </Stack>
      <CommandModal pending={pending} tabId={tabId!} inputs={values}
        onClose={() => setPending(null)}
        onDone={(refetch) => { setPending(null); if (refetch === "tab") refresh(); }} />
    </TabRuntimeProvider>
  );
}
