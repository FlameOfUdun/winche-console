import { cleanup, render, screen } from "@testing-library/react";
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

test("admins get General, Users and permissions, and CI tokens, each at its own address", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: { manageUsers: true } }, user: { role: "Admin" } });
  renderAt("/settings/general");
  expect(await screen.findByText("Your apps")).toBeInTheDocument();
  expect(await screen.findByTestId("project-name")).toHaveTextContent("Demo");
  cleanup();
  renderAt("/settings/users");   // the old address
  expect(await screen.findByTestId("where")).toHaveTextContent("/settings/members");
  expect(await screen.findByRole("button", { name: "New user" })).toBeInTheDocument();
  cleanup();
  renderAt("/settings/ci");
  expect(await screen.findByText("CI tokens")).toBeInTheDocument();
});

test("others see only General", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Member" } });
  renderAt("/settings/ci");
  expect(await screen.findByTestId("where")).toHaveTextContent("/settings/general");
});
