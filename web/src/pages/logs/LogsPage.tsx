import { Stack, Title } from "@mantine/core";
import { LogsView } from "./LogsView";

/** The top-level Logs tab: every kept entry — the app's own code, the framework and Winche. */
export function LogsPage() {
  return (
    <Stack gap="sm">
      <Title order={3}>Logs</Title>
      <LogsView scope="app" />
    </Stack>
  );
}
