import { createContext, useContext, type ReactNode } from "react";
import { Text, Title } from "@mantine/core";
import type { SettingsVersionInfo } from "../api/appAuth";
import { when } from "../pages/authentication/UsersView";

/** The saved version of the settings a section shows (null: still the code's). */
export const SavedVersionContext = createContext<SettingsVersionInfo | null>(null);

/** "Version 3, Nov 14 by ann — why": nothing while the settings are still the code's. */
export function SavedVersion({ version, testId }: { version: SettingsVersionInfo | null | undefined; testId?: string }) {
  if (!version) return null;
  return (
    <Text size="xs" c="dimmed" mt={4} data-testid={testId}>
      Version {version.number}, {when(version.at)}{version.by ? ` by ${version.by}` : ""}{version.reason ? ` — ${version.reason}` : ""}
    </Text>
  );
}

/** A settings section's heading, with the saved version under it. */
export function SectionTitle({ children }: { children: ReactNode }) {
  const version = useContext(SavedVersionContext);
  return (
    <div>
      <Title order={4}>{children}</Title>
      <SavedVersion version={version} testId="saved-version" />
    </div>
  );
}
