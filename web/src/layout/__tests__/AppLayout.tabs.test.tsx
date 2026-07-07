import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { AppLayout } from "../AppLayout";
import { api } from "../../api/client";
import { SessionContext } from "../../auth/session";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, consoleTabs: vi.fn(), logout: vi.fn() } };
});

const session = {
  state: {
    provider: "identity", initialized: true, selfServiceResetEnabled: false,
    capabilities: { manageUsers: true, database: true, storage: true, invites: true, twoFactor: true, changePassword: true, editProfile: true },
    user: { id: "1", email: "a@x.com", firstName: null, lastName: null, role: "Admin", twoFactorEnabled: false, twoFactorRequired: false, mustSetupTwoFactor: false },
  },
  user: { id: "1", email: "a@x.com", firstName: null, lastName: null, role: "Admin", twoFactorEnabled: false, twoFactorRequired: false, mustSetupTwoFactor: false },
  refresh: async () => {},
} as any;

test("custom tabs from the manifest appear in the nav", async () => {
  (api.consoleTabs as ReturnType<typeof vi.fn>).mockResolvedValue({
    tabs: [{ id: "analytics", label: "Analytics", icon: "chart-bar", kind: "declarative", widgets: [], filters: [] }],
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={session}>
          <MemoryRouter initialEntries={["/database"]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="database" element={<div>data</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  await waitFor(() => expect(screen.getByText("Analytics")).toBeInTheDocument());
});

test("hides the Database nav when the capability is off", async () => {
  (api.consoleTabs as ReturnType<typeof vi.fn>).mockResolvedValue({ tabs: [] });
  const s = { ...session, state: { ...session.state, capabilities: { ...session.state.capabilities, database: false } } } as any;
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={s}>
          <MemoryRouter initialEntries={["/storage"]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="storage" element={<div>storage</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  await waitFor(() => expect(screen.queryByText("Database")).not.toBeInTheDocument());
});
