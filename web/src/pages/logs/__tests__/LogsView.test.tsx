import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach, afterEach } from "vitest";
import { LogsView } from "../LogsView";
import { SubsystemTabs } from "../../rules/SubsystemTabs";
import { builtinNav } from "../../../layout/nav";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import type { LogEntry } from "../../../api/logs";
import type { AuthState, SessionUser } from "../../../api/types";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, logs: vi.fn(), logCategories: vi.fn(), rulesSubsystems: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const entry = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({
  id, at: "2026-11-12T14:00:00Z", level: "Error", category: "SmartAirway.Reports.ReportEmailService", eventId: 0,
  message: `Report email failed ${id}`, exception: null, userId: "u42", instance: "api-1:7", properties: null, ...over,
});

const logs = api.logs as ReturnType<typeof vi.fn>;
const page = (entries: LogEntry[]) => ({ entries, minimumLevel: "Warning", retentionDays: 7 });

function renderView(scope: "app" | "database" = "app") {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LogsView scope={scope} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.logCategories as ReturnType<typeof vi.fn>).mockResolvedValue(["SmartAirway.Reports.ReportEmailService", "Winche.Database.Runtime"]);
});
afterEach(() => vi.useRealTimers());

test("lists entries newest first and opens one for its exception and values", async () => {
  logs.mockResolvedValue(page([
    entry(2, { exception: "System.InvalidOperationException: SES rejected\n   at Send()", properties: { ErrorId: "3f9c0a1b2c4d" } }),
    entry(1, { level: "Warning", message: "Slow query", category: "Winche.Database.Runtime.Listening" }),
  ]));
  renderView();

  const rows = await screen.findAllByTestId("log-row");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText(/Report email failed 2/)).toBeInTheDocument();
  expect(within(rows[0]).getByText("u42")).toBeInTheDocument();
  expect(within(rows[1]).getByText("…Runtime.Listening")).toBeInTheDocument();
  expect(screen.getByText(/Keeps Warning and above for 7 days/)).toBeInTheDocument();

  await userEvent.click(rows[0]);
  expect(await screen.findByText(/SES rejected/)).toBeInTheDocument();
  expect(screen.getByText("ErrorId: 3f9c0a1b2c4d")).toBeInTheDocument();
  expect(logs).toHaveBeenCalledWith("app", { level: "", category: "", q: "", limit: 100 });
});

test("searching asks the server (debounced), e.g. for an error id", async () => {
  logs.mockResolvedValue(page([entry(1)]));
  renderView();
  await screen.findAllByTestId("log-row");

  await userEvent.type(screen.getByLabelText("Search"), "3f9c");
  await waitFor(() => expect(logs).toHaveBeenLastCalledWith("app", expect.objectContaining({ q: "3f9c" })));
});

test("older entries page back from the oldest shown", async () => {
  logs.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => entry(200 - i))));
  logs.mockResolvedValueOnce(page([entry(50)]));
  renderView();
  await screen.findByText(/Report email failed 200/);

  await userEvent.click(screen.getByRole("button", { name: "Older entries" }));
  expect(await screen.findByText(/Report email failed 50/)).toBeInTheDocument();
  expect(logs).toHaveBeenLastCalledWith("app", expect.objectContaining({ before: 101 }));
  expect(screen.queryByRole("button", { name: "Older entries" })).not.toBeInTheDocument();
});

test("live mode adds newer entries on top", async () => {
  logs.mockResolvedValueOnce(page([entry(5)]));
  logs.mockResolvedValue(page([entry(6), entry(7)]));   // `after` answers oldest first
  renderView();
  await screen.findByText(/Report email failed 5/);

  vi.useFakeTimers({ shouldAdvanceTime: true });
  await userEvent.click(screen.getByLabelText("Live"));
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  await waitFor(() => expect(screen.getAllByTestId("log-row")).toHaveLength(3));
  expect(within(screen.getAllByTestId("log-row")[0]).getByText(/failed 7/)).toBeInTheDocument();
  expect(logs).toHaveBeenCalledWith("app", expect.objectContaining({ after: 5 }));
});

// ── where the views appear ──────────────────────────────────────────────────

const admin: SessionUser = {
  id: "2", email: "admin@example.com", firstName: null, lastName: null,
  role: "Admin", twoFactorEnabled: false, twoFactorRequired: false, mustSetupTwoFactor: false,
};
const state = (logsCaps: { app: boolean; database: boolean; storage: boolean }) => ({
  provider: "identity", initialized: true, selfServiceResetEnabled: false, user: admin,
  capabilities: { manageUsers: true, database: true, storage: true, invites: true, twoFactor: true, changePassword: true, editProfile: true, logs: logsCaps },
}) as unknown as AuthState;

test("the Logs nav entry follows capabilities.logs.app", () => {
  expect(builtinNav(state({ app: true, database: false, storage: false }), admin).map((n) => n.label)).toContain("Logs");
  expect(builtinNav(state({ app: false, database: true, storage: true }), admin).map((n) => n.label)).not.toContain("Logs");
});

test("the Database tab gets a Logs sub-tab showing the database scope", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: admin, state: state({ app: false, database: true, storage: false }), refresh: vi.fn() });
  (api.rulesSubsystems as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  logs.mockResolvedValue(page([entry(1, { category: "Winche.Database.Runtime", message: "Slow query" })]));
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/database/logs"]}>
          <Routes>
            <Route path="/database/*" element={
              <SubsystemTabs subsystem="database" primaryLabel="Documents" basePath="/database"><div>docs</div></SubsystemTabs>
            } />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  expect(await screen.findByRole("tab", { name: "Logs" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText("Slow query")).toBeInTheDocument();
  expect(logs).toHaveBeenCalledWith("database", expect.anything());
});
