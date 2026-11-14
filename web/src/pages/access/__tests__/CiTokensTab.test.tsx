import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { CiTokensTab } from "../CiTokensTab";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, consoleTokens: vi.fn(), createCiToken: vi.fn(), revokeConsoleToken: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const ci = { id: "t1", kind: "ci", name: "gitlab-main", user: "ann@example.com", role: "Admin", scopes: ["functions"],
  createdAt: "2026-11-14T10:00:00Z", expiresAt: "2027-02-12T10:00:00Z", lastUsedAt: null };
const cli = { ...ci, id: "t2", kind: "cli", name: "winche CLI on laptop", scopes: [] };

function renderTab() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CiTokensTab /></QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.consoleTokens).mockResolvedValue({ available: true, scopes: ["functions", "rules"], tokens: [ci, cli] });
});

test("an admin makes a CI token (shown once), and revokes tokens and CLI sign-ins", async () => {
  mock(api.createCiToken).mockResolvedValue({ token: ci, secret: "wct_abc_def" });
  mock(api.revokeConsoleToken).mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderTab();
  expect(within(await screen.findByTestId("ci-token")).getByText("gitlab-main")).toBeInTheDocument();
  expect(within(screen.getByTestId("cli-token")).getByText("winche CLI on laptop")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Create token" }));   // opens the dialog
  await userEvent.type(await screen.findByLabelText(/^Name/), "github-release");
  await userEvent.click(screen.getByLabelText("Deploy rules"));   // off: functions only
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create token" }));
  await waitFor(() => expect(api.createCiToken).toHaveBeenCalledWith("github-release", ["functions"], 90));
  expect(await screen.findByTestId("ci-token-secret")).toHaveTextContent("wct_abc_def");
  await userEvent.click(screen.getByRole("button", { name: "Done" }));

  await userEvent.click(within(screen.getByTestId("cli-token")).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(api.revokeConsoleToken).toHaveBeenCalledWith("t2"));
});

test("with no tokens, each list shows its empty state, and the empty CI list offers Create token", async () => {
  mock(api.consoleTokens).mockResolvedValue({ available: true, scopes: ["functions", "rules"], tokens: [] });
  renderTab();
  const empties = await screen.findAllByTestId("empty-state");
  expect(empties).toHaveLength(2);
  expect(within(empties[0]).getByText("No CI tokens")).toBeInTheDocument();
  expect(within(empties[1]).getByText("Nobody has signed in with the CLI")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Create token" })).toHaveLength(1);   // only the empty state's
  await userEvent.click(within(empties[0]).getByRole("button", { name: "Create token" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
