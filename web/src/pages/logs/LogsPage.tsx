import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { LogResource } from "../../api/logs";
import { Stack, Tabs } from "@mantine/core";
import { LogsExplorer } from "./LogsExplorer";
import { SavedQueriesView } from "./SavedQueriesView";
import { EMPTY, fromSpec, type ExplorerState } from "./explorerQuery";
import { PageHeader } from "../../components/PageHeader";

/** The top-level Logs tab: the explorer over every kept entry, and the saved queries. */
export function LogsPage() {
  const [tab, setTab] = useState<string | null>("explorer");
  const [params] = useSearchParams();
  // ?resource=auth (from the Authentication tab) opens the explorer on that resource.
  const [state, setState] = useState<ExplorerState>(() => ({ ...EMPTY, resource: (params.get("resource") ?? "") as LogResource | "" }));
  return (
    <Stack gap="sm">
      <PageHeader eyebrow="Monitor" title="Logs" />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="explorer">Explorer</Tabs.Tab>
          <Tabs.Tab value="saved">Saved queries</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="explorer">
          <LogsExplorer scope="app" state={state} onChange={setState} />
        </Tabs.Panel>
        <Tabs.Panel value="saved">
          <SavedQueriesView onOpen={(q) => { setState(fromSpec(q.query, state.range)); setTab("explorer"); }} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
