import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import type { RuleVersionSummary } from "../../../api/rules";

const TEXT: Record<number, string> = {
  2: "match users/{uid} {\n  allow read: if request.auth.uid == uid;\n  allow write: if false;\n}\n",
  1: "match users/{uid} {\n  allow read: if true;\n}\n",
};
vi.mock("../../../api/client", () => ({
  api: {
    rulesVersion: async (_sys: string, v: number) => ({ version: v, rulesJson: JSON.stringify({ v }) }),
    rulesFormatText: async (json: string) => ({ text: TEXT[JSON.parse(json).v] }),
  },
}));
const { VersionHistory } = await import("../VersionHistory");

const versions: RuleVersionSummary[] = [
  { version: 2, isActive: true, note: "owner only", createdAtUtc: "2026-11-10T10:00:00Z", createdBy: "admin", revertedFromVersion: null },
  { version: 1, isActive: false, note: "open", createdAtUtc: "2026-11-09T10:00:00Z", createdBy: "admin", revertedFromVersion: null },
];

function renderHistory() {
  const onOpenInEditor = vi.fn();
  const onRevert = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <VersionHistory subsystem="database" opened onClose={() => {}} versions={versions} onOpenInEditor={onOpenInEditor} onRevert={onRevert} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { onOpenInEditor, onRevert };
}

test("the active version shows as the file", async () => {
  renderHistory();
  expect(await screen.findByText("allow write: if false;", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText("Revert to this")).toBeNull();
});

test("an older version shows its changes against the active one, and can be opened or reverted", async () => {
  const { onOpenInEditor, onRevert } = renderHistory();
  await userEvent.click(await screen.findByText("#1"));

  await waitFor(() => expect(screen.getByText(/lines compared with the active version/)).toBeInTheDocument());
  expect(screen.getByText("+1")).toBeInTheDocument();    // allow read: if true;
  expect(screen.getByText("−2")).toBeInTheDocument();    // the two v2 allow lines
  expect(screen.getByText("allow read: if true;", { exact: false }).closest("div")).toHaveStyle({ background: "#e6ffec" });

  await userEvent.click(screen.getByText("Open in editor"));
  expect(onOpenInEditor).toHaveBeenCalledWith(1);
  await userEvent.click(screen.getByText("Revert to this"));
  expect(onRevert).toHaveBeenCalledWith(versions[1]);
});
