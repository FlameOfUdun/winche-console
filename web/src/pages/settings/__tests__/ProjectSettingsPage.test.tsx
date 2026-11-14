import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ProjectSettingsPage } from "../ProjectSettingsPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn(), listUsers: vi.fn(), listInvites: vi.fn(), consoleTokens: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
function renderAt(path: string) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="settings/:tab" element={<><ProjectSettingsPage /><Where /></>} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.apps).mockResolvedValue({
    setup: { projectId: "demo", name: "Demo", baseUrl: "https://api.example.com", services: [], providers: [] },
    platforms: ["android"], file: "x", snippet: "y",
  });
  mock(api.listUsers).mockResolvedValue([]);
  mock(api.listInvites).mockResolvedValue([]);
  mock(api.consoleTokens).mockResolvedValue({ available: true, scopes: ["functions", "rules"], tokens: [] });
});

test("admins get General, Users and permissions, and CLI and CI, each at its own address", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: { manageUsers: true } }, user: { role: "Admin" } });
  renderAt("/settings/general");
  expect(await screen.findByText("Your project")).toBeInTheDocument();
  expect(screen.getByText("Your apps")).toBeInTheDocument();
  expect(screen.getByText("Demo")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Members" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/settings/users");
  expect(await screen.findByText(/Who can use this console/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "CLI and CI" }));
  expect(await screen.findByText("CI tokens")).toBeInTheDocument();
});

test("others see only General; a Keycloak console says its users live there", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Member" } });
  const { unmount } = renderAt("/settings/users");
  expect(await screen.findByTestId("where")).toHaveTextContent("/settings/general");
  expect(screen.queryByRole("tab", { name: "CLI and CI" })).not.toBeInTheDocument();
  unmount();
  mock(useSession).mockReturnValue({ state: { provider: "keycloak", capabilities: { manageUsers: false } }, user: { role: "Admin" } });
  renderAt("/settings/users");
  expect(await screen.findByText(/managed in Keycloak/)).toBeInTheDocument();
});
