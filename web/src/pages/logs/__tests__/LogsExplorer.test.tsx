import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { LogsPage } from "../LogsPage";
import { payload } from "../LogsExplorer";
import { queryText, EMPTY } from "../explorerQuery";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import type { LogEntry, SavedQuery } from "../../../api/logs";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: { ...actual.api, logs: vi.fn(), logCategories: vi.fn(), logHistogram: vi.fn(), logQueries: vi.fn(), saveLogQuery: vi.fn(), deleteLogQuery: vi.fn() },
  };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const entry = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({
  id, at: "2026-11-12T15:02:17Z", level: "Warning", category: "Winche.Database.Requests", eventId: 2,
  message: "u2 was denied reading users/u1: no rule allows it.", exception: null, userId: null, instance: "api-1:7",
  properties: { Operation: "database.get", Path: "users/u1", Principal: "u2", Outcome: "denied", LatencyMs: "4" },
  resource: "database", operation: "database.get", principal: "u2", path: "users/u1", outcome: "denied", latencyMs: 4, ...over,
});
const histogram = { from: "2026-11-12T14:00:00Z", to: "2026-11-12T15:00:00Z", total: 2, buckets: [{ start: "2026-11-12T14:00:00Z", info: 1, warning: 1, error: 0 }] };

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><LogsPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ state: { capabilities: { history: true } }, user: { role: "Admin" } });
  mock(api.logs).mockResolvedValue({ entries: [entry(2), entry(1, { level: "Information", message: "u1 read users/u1 (3 ms).", principal: "u1", outcome: "ok" })], minimumLevel: "Information", retentionDays: 7 });
  mock(api.logCategories).mockResolvedValue([]);
  mock(api.logHistogram).mockResolvedValue(histogram);
});

test("shows entries and the histogram; opening one shows its fields, and Show / Hide matching add filters", async () => {
  renderPage();
  const rows = await screen.findAllByTestId("log-row");
  expect(within(rows[0]).getByText("Warning")).toBeInTheDocument();
  expect(within(rows[0]).getByText(/u2 was denied reading users\/u1/)).toBeInTheDocument();
  expect(screen.getByTestId("histogram")).toBeInTheDocument();
  expect(screen.getByText("Last hour · 2 entries")).toBeInTheDocument();
  expect(screen.getByText(/2 entries · 0 errors · 1 warning ·/)).toBeInTheDocument();

  await userEvent.click(rows[0]);
  expect(screen.getByText("database.get")).toBeInTheDocument();
  expect(screen.getByText("Open this document's history →")).toHaveAttribute("href", "/database/history?path=users%2Fu1");

  await userEvent.click(screen.getAllByText("Show matching")[2]);   // principal
  await waitFor(() => expect(mock(api.logs)).toHaveBeenLastCalledWith("app", expect.objectContaining({ filters: [{ field: "principal", value: "u2" }] })));
  expect(screen.getByTestId("query-text")).toHaveTextContent("principal = u2");

  const again = await screen.findAllByTestId("log-row");
  await userEvent.click(again[0]);
  await userEvent.click(screen.getAllByText("Hide matching")[4]);   // outcome
  await waitFor(() => expect(screen.getByTestId("query-text")).toHaveTextContent("principal = u2 AND outcome != denied"));
  await userEvent.click(screen.getByLabelText("Remove principal filter"));
  await waitFor(() => expect(screen.getByTestId("query-text")).toHaveTextContent(/^outcome != denied$/));
});

test("saves the query, and opening a saved one loads it into the explorer", async () => {
  const saved: SavedQuery = { id: "q1", name: "u2's denials", createdBy: "admin@winche.local", createdAt: "2026-11-12T15:00:00Z",
    query: { resource: "database", minimumLevel: "Warning", filters: [{ field: "principal", value: "u2" }], search: null } };
  mock(api.saveLogQuery).mockResolvedValue(saved);
  mock(api.logQueries).mockResolvedValue({ queries: [
    { id: "builtin:denied", name: "Denied requests", createdBy: null, createdAt: null, query: { resource: null, minimumLevel: "Trace", filters: [{ field: "outcome", value: "denied" }], search: null } },
    saved,
  ] });
  renderPage();
  await screen.findAllByTestId("log-row");

  await userEvent.click(screen.getByText("Save this query"));
  await userEvent.type(screen.getByLabelText("Query name"), "everything{Enter}");
  await waitFor(() => expect(mock(api.saveLogQuery)).toHaveBeenCalledWith("everything", { resource: null, minimumLevel: "Trace", filters: [], search: null }));

  await userEvent.click(screen.getByRole("tab", { name: "Saved queries" }));
  const rows = await screen.findAllByTestId("saved-query");
  expect(within(rows[0]).getByText("built in")).toBeInTheDocument();
  expect(within(rows[0]).queryByText("Delete")).toBeNull();
  expect(within(rows[1]).getByText("resource = database AND principal = u2 AND severity >= Warning")).toBeInTheDocument();

  await userEvent.click(within(rows[1]).getByText("Open"));
  await waitFor(() => expect(screen.getByTestId("query-text")).toHaveTextContent("resource = database AND principal = u2 AND severity >= Warning"));
  await waitFor(() => expect(mock(api.logs)).toHaveBeenLastCalledWith("app", expect.objectContaining({ resource: "database", level: "Warning" })));
});

test("helpers", () => {
  expect(queryText(EMPTY)).toBe("everything");
  expect(queryText({ ...EMPTY, q: "report email", filters: [{ field: "path", value: "a b" }] })).toBe('path = "a b" AND "report email"');
  expect(payload(entry(1))).toBe('{\n  "eventId": 2\n}');
  expect(payload(entry(1, { eventId: 0, properties: null }))).toBeNull();
});
