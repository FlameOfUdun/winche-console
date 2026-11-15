import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { SubsystemTabs } from "../SubsystemTabs";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import type { SessionUser } from "../../../api/types";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      rulesSubsystems: vi.fn(),
      rulesLive: vi.fn(),
      rulesVersions: vi.fn(),
    },
  };
});

vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const viewer: SessionUser = {
  id: "1", email: "viewer@example.com", firstName: null, lastName: null,
  role: "Viewer", twoFactorEnabled: false, twoFactorRequired: false, mustSetupTwoFactor: false,
};
const admin: SessionUser = { ...viewer, id: "2", email: "admin@example.com", role: "Admin" };

const state = { capabilities: { database: true } };

/** Opens /database/rules: the page if the user may edit rules, else the browser (primary content). */
function renderTabs() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/database/rules"]}>
          <Routes>
            <Route path="database/*" element={
              <SubsystemTabs subsystem="database" basePath="/database"><div>primary content</div></SubsystemTabs>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test("Viewer: the Rules page sends them to the data", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: viewer, state, refresh: vi.fn() });
  renderTabs();
  expect(await screen.findByText("primary content")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Database" })).toBeInTheDocument();
  expect(api.rulesSubsystems).not.toHaveBeenCalled();
});

test("Admin with the subsystem present in rulesSubsystems(): the Rules page opens", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: admin, state, refresh: vi.fn() });
  (api.rulesSubsystems as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "database", available: true, applyOnStartup: true, liveMatchesHead: true },
  ]);
  (api.rulesLive as ReturnType<typeof vi.fn>).mockResolvedValue({
    version: 1, isActive: true, note: null, createdAtUtc: "", createdBy: null,
    revertedFromVersion: null, rulesJson: "{}",
  });
  (api.rulesVersions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  renderTabs();

  expect(await screen.findByRole("link", { name: "Rules" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByText("primary content")).not.toBeInTheDocument();
});

test("Admin but subsystem absent from rulesSubsystems(): the Rules page sends them to the data", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: admin, state, refresh: vi.fn() });
  (api.rulesSubsystems as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "storage", available: true, applyOnStartup: true, liveMatchesHead: true },
  ]);

  renderTabs();

  expect(await screen.findByText("primary content")).toBeInTheDocument();
});
