import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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

function renderTabs() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/documents"]}>
          <SubsystemTabs subsystem="database" primaryLabel="Documents" basePath="/documents">
            <div>primary content</div>
          </SubsystemTabs>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test("Viewer: the Rules tab is not rendered", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: viewer, state: null, refresh: vi.fn() });
  renderTabs();

  // Primary tab renders normally...
  expect(await screen.findByRole("tab", { name: "Documents" })).toBeInTheDocument();
  // ...but Rules never appears for a non-admin.
  expect(screen.queryByRole("tab", { name: "Rules" })).not.toBeInTheDocument();
  expect(api.rulesSubsystems).not.toHaveBeenCalled();
});

test("Admin with the subsystem present in rulesSubsystems(): the Rules tab is rendered", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: admin, state: null, refresh: vi.fn() });
  (api.rulesSubsystems as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "database", available: true, applyOnStartup: true, liveMatchesHead: true },
  ]);
  (api.rulesLive as ReturnType<typeof vi.fn>).mockResolvedValue({
    version: 1, isActive: true, note: null, createdAtUtc: "", createdBy: null,
    revertedFromVersion: null, rulesJson: "{}",
  });
  (api.rulesVersions as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  renderTabs();

  expect(await screen.findByRole("tab", { name: "Rules" })).toBeInTheDocument();
});

test("Admin but subsystem absent from rulesSubsystems(): the Rules tab is not rendered", async () => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: admin, state: null, refresh: vi.fn() });
  (api.rulesSubsystems as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "storage", available: true, applyOnStartup: true, liveMatchesHead: true },
  ]);

  renderTabs();

  await waitFor(() => expect(api.rulesSubsystems).toHaveBeenCalled());
  expect(screen.queryByRole("tab", { name: "Rules" })).not.toBeInTheDocument();
});
