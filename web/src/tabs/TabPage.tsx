import { Loader, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { ControlSpec, LayoutNode } from "../api/tabs";
import { RenderNode } from "./nodes/render";
import { visibleWidgetIds } from "./nodes/visible";
import { useTabLayout } from "./useTabsManifest";

// Default value for each control: first option for select, empty for date range.
function initialValues(node: LayoutNode, acc: Record<string, string>): Record<string, string> {
  if (node.type === "filter") {
    const c: ControlSpec = node.control;
    if (c.kind === "select") acc[c.id] = c.options[0] ?? "";
    const kids = node.mode === "switch" ? Object.values(node.branches).flat() : node.children;
    kids.forEach((k) => initialValues(k, acc));
  } else if (node.type !== "widget" && node.type !== "embed") {
    node.children.forEach((k) => initialValues(k, acc));
  }
  return acc;
}

export function TabPage() {
  const { tabId } = useParams();
  const layout = useTabLayout(tabId);
  const [values, setValues] = useState<Record<string, string>>({});

  // Seed control defaults whenever the tab or its layout changes.
  const root = layout.data?.root;
  useEffect(() => { setValues(root ? initialValues(root, {}) : {}); }, [tabId, root]);

  const visibleIds = useMemo(() => (root ? visibleWidgetIds(root, values) : []), [root, values]);

  const data = useQuery({
    queryKey: ["console-tab-data", tabId, visibleIds, values],
    queryFn: () => api.consoleTabData(tabId!, visibleIds, values),
    enabled: !!root && visibleIds.length > 0,
  });

  if (layout.isLoading) return <Loader />;
  if (layout.isError || !root) return <Navigate to="/" replace />;

  const filters = { values, setValue: (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v })) };

  return (
    <Stack>
      <Title order={3}>{layout.data!.label}</Title>
      {data.isError && <Text c="red">Failed to load data.</Text>}
      <RenderNode node={root} filters={filters} data={data.data?.widgets ?? {}} />
    </Stack>
  );
}
