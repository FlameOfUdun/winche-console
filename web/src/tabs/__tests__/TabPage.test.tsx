import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { TabPage } from "../TabPage";
import { api } from "../../api/client";
import { SessionContext } from "../../auth/session";
import type { SessionUser } from "../../api/types";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, consoleTabLayout: vi.fn(), consoleTabData: vi.fn() } };
});

const LAYOUT = {
  id: "analytics", label: "Analytics",
  root: {
    type: "filter", control: { kind: "select", id: "range", options: ["7d", "30d"] }, mode: "reactive",
    children: [{ type: "widget", kind: "statRow", id: "kpis", flex: 1 }],
  },
  commands: {},
};

const adminSession = {
  state: null,
  user: { role: "Admin" } as SessionUser,
  refresh: async () => {},
};

function renderTab() {
  return render(
    <MantineProvider><QueryClientProvider client={new QueryClient()}>
      <SessionContext.Provider value={adminSession}>
        <MemoryRouter initialEntries={["/analytics"]}>
          <Routes><Route path=":tabId" element={<TabPage />} /><Route index element={<div>data-home</div>} /></Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider></MantineProvider>,
  );
}

test("renders widgets from layout + data and re-fetches on filter change", async () => {
  (api.consoleTabLayout as ReturnType<typeof vi.fn>).mockResolvedValue(LAYOUT);
  (api.consoleTabData as ReturnType<typeof vi.fn>).mockResolvedValue({
    widgets: { kpis: { stats: [{ label: "Users", value: 42, trend: "neutral" }] } },
  });
  renderTab();
  await waitFor(() => expect(screen.getByText("Users")).toBeInTheDocument());
  await waitFor(() => expect(api.consoleTabData).toHaveBeenCalledWith("analytics", ["kpis"], { range: "7d" }));

  await userEvent.click(screen.getByPlaceholderText("range"));
  await userEvent.click(await screen.findByText("30d"));
  await waitFor(() => expect(api.consoleTabData).toHaveBeenCalledWith("analytics", ["kpis"], { range: "30d" }));
});

test("shows a loader (not a red widget error) while data is loading", async () => {
  (api.consoleTabLayout as ReturnType<typeof vi.fn>).mockResolvedValue(LAYOUT);
  (api.consoleTabData as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves
  renderTab();
  await waitFor(() => expect(screen.queryByText("This section couldn't be displayed.")).not.toBeInTheDocument());
});

test("redirects home for an unknown tab", async () => {
  (api.consoleTabLayout as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("404"));
  renderTab();
  await waitFor(() => expect(screen.getByText("data-home")).toBeInTheDocument());
});

const MANUAL_LAYOUT = {
  id: "analytics", label: "Analytics",
  root: {
    type: "filter", control: { kind: "text", id: "q", apply: "manual", placeholder: "Search" }, mode: "reactive",
    children: [
      { type: "widget", kind: "table", id: "log", flex: 1 },
      { type: "button", intent: "refresh", label: "Refresh" },
    ],
  },
  commands: {},
};

test("manual filter defers fetch until Refresh is clicked", async () => {
  (api.consoleTabLayout as ReturnType<typeof vi.fn>).mockResolvedValue(MANUAL_LAYOUT);
  (api.consoleTabData as ReturnType<typeof vi.fn>).mockResolvedValue({
    widgets: { log: { columns: ["User"], total: 1, rows: [{ key: "1", cells: ["alice"] }] } },
  });
  renderTab();
  await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
  await waitFor(() => expect(api.consoleTabData).toHaveBeenCalledWith("analytics", ["log"], {}));

  const callsAfterLoad = (api.consoleTabData as ReturnType<typeof vi.fn>).mock.calls.length;

  // Typing into a manual input must NOT trigger a new data fetch.
  await userEvent.type(screen.getByPlaceholderText("Search"), "bob");
  expect((api.consoleTabData as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterLoad);

  // Clicking Refresh DOES trigger a fetch (drafts committed + nonce bumped).
  await userEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect((api.consoleTabData as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterLoad),
  );
  expect(api.consoleTabData).toHaveBeenLastCalledWith("analytics", ["log"], { q: "bob" });
});
