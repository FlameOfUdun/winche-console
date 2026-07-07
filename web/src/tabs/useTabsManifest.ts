import {
  IconChartBar, IconLayoutDashboard, IconReportAnalytics, IconTable,
  type IconProps,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { api } from "../api/client";
import type { TabLayout, TabNav } from "../api/tabs";

// Curated icon names custom tabs may reference. Unknown names fall back to a dashboard icon.
const ICONS: Record<string, ComponentType<IconProps>> = {
  "layout-dashboard": IconLayoutDashboard,
  "chart-bar": IconChartBar,
  "report-analytics": IconReportAnalytics,
  table: IconTable,
};

export function tabIcon(name: string): ComponentType<IconProps> {
  return ICONS[name] ?? IconLayoutDashboard;
}

/** Fetches the role-filtered tab nav once; shared (cached) across nav and TabPage. */
export function useTabsManifest() {
  return useQuery<{ tabs: TabNav[] }>({
    queryKey: ["console-tabs"],
    queryFn: () => api.consoleTabs(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useTabLayout(tabId: string | undefined) {
  return useQuery<TabLayout>({
    queryKey: ["console-tab-layout", tabId],
    queryFn: () => api.consoleTabLayout(tabId!),
    enabled: !!tabId,
    staleTime: Infinity,
    retry: false,
  });
}
