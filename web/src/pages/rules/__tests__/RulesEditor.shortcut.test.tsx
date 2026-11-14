import { forwardRef, useEffect, useImperativeHandle } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";

const RULES = JSON.stringify({ Matches: [] });
const api = {
  rulesLive: vi.fn().mockResolvedValue({ rulesJson: RULES }),
  rulesVersions: vi.fn().mockResolvedValue([]),
  rulesSubsystems: vi.fn().mockResolvedValue([]),
  rulesValidate: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
  rulesSave: vi.fn().mockResolvedValue({ version: 1, isActive: true, rulesJson: RULES }),
};
vi.mock("../../../api/client", () => ({ api, ApiError: class extends Error {} }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));
vi.mock("../SimulateDialog", () => ({ SimulateDialog: () => null }));
// Stand-in editor: reports an unchecked edit when `edited` is set (as typing would).
let edited = true;
vi.mock("../RuleSetEditor", () => ({
  RuleSetEditor: forwardRef((props: { json: string; onEditedChange?: (e: boolean) => void }, ref) => {
    useImperativeHandle(ref, () => ({ check: async () => props.json }));
    useEffect(() => { props.onEditedChange?.(edited); }, [props]);
    return <div>editor</div>;
  }),
}));

const { RulesEditor } = await import("../RulesEditor");

test("Ctrl+S saves: checks and validates, then confirms in the note dialog", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider><RulesEditor subsystem="database" /></MantineProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("editor");

  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(api.rulesValidate).toHaveBeenCalledWith("database", JSON.stringify(JSON.parse(RULES), null, 2)));
  expect(await screen.findByText("Save & apply")).toBeInTheDocument();

  fireEvent.keyDown(window, { key: "s", metaKey: true });
  await waitFor(() => expect(api.rulesSave).toHaveBeenCalled());
});

test("with nothing changed, Save is disabled and Ctrl+S does nothing", async () => {
  edited = false;
  api.rulesValidate.mockClear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider><RulesEditor subsystem="database" /></MantineProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("editor");
  expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await new Promise((r) => setTimeout(r, 50));
  expect(api.rulesValidate).not.toHaveBeenCalled();
  edited = true;
});

test("other keys, and Ctrl+Shift+S, are left alone", async () => {
  api.rulesValidate.mockClear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider><RulesEditor subsystem="database" /></MantineProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("editor");
  fireEvent.keyDown(window, { key: "s" });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });
  await new Promise((r) => setTimeout(r, 50));
  expect(api.rulesValidate).not.toHaveBeenCalled();
});
