import { useState } from "react";
import { Stack, Tabs, Title } from "@mantine/core";
import { LogsExplorer } from "./LogsExplorer";
import { SavedQueriesView } from "./SavedQueriesView";
import { EMPTY, fromSpec, type ExplorerState } from "./explorerQuery";

/** The top-level Logs tab: the explorer over every kept entry, and the saved queries. */
export function LogsPage() {
  const [tab, setTab] = useState<string | null>("explorer");
  const [state, setState] = useState<ExplorerState>(EMPTY);
  return (
    <Stack gap="sm">
      <Title order={3}>Logs</Title>
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
