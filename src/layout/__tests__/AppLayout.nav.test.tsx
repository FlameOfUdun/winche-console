import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { AppLayout } from "../AppLayout";
import { SessionContext } from "../../auth/session";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, logout: vi.fn(), rulesSubsystems: vi.fn().mockResolvedValue([{ id: "database" }]), projects: vi.fn().mockResolvedValue({ available: true, canCreate: true, current: "p", projects: [] }), project: vi.fn().mockResolvedValue({ setup: false }), overview: vi.fn().mockResolvedValue({ project: { id: "clinic", name: "Clinic" }, products: [], changes: [] }), consolePages: vi.fn().mockResolvedValue({ pages: [{ name: "reports", title: "Weekly reports", icon: "chart-bar", order: 0 }] }) } };
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

test("hides the Database nav when the capability is off", async () => {
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

test("a flat sidebar of products (their pages are tabs); Server in the top bar for server admins; Project settings at the bottom", async () => {
  const s = { ...session, user: { ...session.user, serverAdmin: true } } as any;
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={s}>
          <MemoryRouter initialEntries={["/database/rules"]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="database/*" element={<div>db</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  const database = await screen.findByRole("link", { name: "Database" });
  expect(database).toHaveAttribute("aria-current", "page");
  expect(database).toHaveAttribute("href", "/database");
  expect(screen.queryByRole("link", { name: "Rules" })).toBeNull();   // a tab on the page, not in the sidebar
  // The server's settings are its own console's: a link there (the server's, not this project's /console/projects/<id>).
  expect(screen.getByRole("link", { name: "Server" })).toHaveAttribute("href", expect.stringMatching(/^http:\/\/[^/]+\/console\/server$/));
  expect(screen.getByRole("link", { name: /Project settings/ })).toHaveAttribute("href", "/settings/general");
  expect(await screen.findByText("Clinic")).toBeInTheDocument();
});

test("the project's own pages are listed under Project pages", async () => {
  const s = { ...session, state: { ...session.state, capabilities: { ...session.state.capabilities, consolePages: true } } } as any;
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
  expect(await screen.findByText("Project pages")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Weekly reports/ })).toHaveAttribute("href", "/pages/reports");
});

test("Integrity is in the sidebar for anyone with a role where it's set up", async () => {
  const { projectNav } = await import("../nav");
  const labels = (integrity: boolean, role: string) =>
    projectNav({ capabilities: { integrity } } as never, { role } as never).map((n) => n.label);
  expect(labels(true, "Viewer")).toContain("Integrity");
  expect(labels(false, "Admin")).not.toContain("Integrity");
});
