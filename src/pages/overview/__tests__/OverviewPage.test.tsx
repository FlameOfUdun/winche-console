import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test } from "vitest";
import { OverviewPage } from "../OverviewPage";
import { useSession } from "../../../auth/session";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, overview: vi.fn(), integrity: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn(() => ({ state: { capabilities: {} }, user: { role: "Admin" } })) };
});

test("shows each product with its status and numbers, and recent changes", async () => {
  (api.overview as ReturnType<typeof vi.fn>).mockResolvedValue({
    project: { id: "clinic-records", name: "Clinic records" },
    products: [
      { id: "database", name: "Database", path: "/database", on: true, about: "Documents", stats: [{ label: "collections", value: "14" }, { label: "rules", value: "v6" }] },
      { id: "functions", name: "Functions", path: "/functions", on: false, about: "Your TypeScript", stats: [] },
    ],
    changes: [{ at: "2026-11-14T10:42:00Z", what: "Database rules v6: Nurses read their ward", by: "gitlab-main (CI token by ann@clinic.example)" }],
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><OverviewPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  expect(await screen.findByRole("heading", { name: /Clinic records/ })).toBeInTheDocument();
  const [db, fn] = screen.getAllByTestId("product");
  expect(within(db).getByText("On")).toBeInTheDocument();
  expect(within(db).getByText("v6")).toBeInTheDocument();
  expect(within(fn).getByText("Not set up")).toBeInTheDocument();
  expect(within(screen.getByTestId("change")).getByText("Database rules v6: Nurses read their ward")).toBeInTheDocument();
});

test("with Integrity: its apps, what's enforced, and today's verified share", async () => {
  (api.overview as ReturnType<typeof vi.fn>).mockResolvedValue({ project: { id: "clinic-records", name: "Clinic records" }, products: [], changes: [] });
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ state: { capabilities: { integrity: true } }, user: { role: "Viewer" } });
  const products = ["database", "storage", "authentication", "functions", "assets"];
  (api.integrity as ReturnType<typeof vi.fn>).mockResolvedValue({
    available: true, canSign: true, editable: false, products, tokenMinutes: 60, debugTokens: [], playServiceAccount: null,
    enforcement: { database: "enforce", storage: "monitor", authentication: "enforce", functions: "monitor", assets: "off" },
    apps: [{ id: "a", name: "My app", androidPackage: "com.example.myapp", appleBundleId: null, appleTeamId: null, appleDevelopment: false,
      androidCloudProjectNumber: 1, androidSideloaded: false, androidDeviceIntegrity: "device", androidCertificates: [], webSiteKey: null, webHostnames: [],
      turnstileSecret: null, createdAt: "", devices: null, usage: { database: { today: 9, last7Days: 9, lastSeen: null } } }],
    unverified: { database: { today: 1, last7Days: 1, lastSeen: null } },
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><OverviewPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  const card = await screen.findByTestId("integrity-summary");
  expect(within(card).getByText(/1 app/)).toBeInTheDocument();
  expect(within(card).getByText(/1 not set up/)).toBeInTheDocument();   // no service account for Play Integrity
  expect(within(card).getByText("Enforced: Database, Authentication")).toBeInTheDocument();
  expect(within(card).getByText("Today 90% verified (9 of 10)")).toBeInTheDocument();
});

const renderOverview = () => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><OverviewPage /></MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
);

test("without Integrity on this server: no link to its page", async () => {
  (api.overview as ReturnType<typeof vi.fn>).mockResolvedValue({ project: { id: "p", name: "Demo" }, products: [], changes: [] });
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ state: { capabilities: {} }, user: { role: "Admin" } });
  renderOverview();
  expect(await screen.findByText("Your apps")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Manage apps/ })).toBeNull();
});

test("Integrity with every product Off doesn't say it's monitoring; the share is rounded down", async () => {
  (api.overview as ReturnType<typeof vi.fn>).mockResolvedValue({ project: { id: "p", name: "Demo" }, products: [], changes: [] });
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ state: { capabilities: { integrity: true } }, user: { role: "Viewer" } });
  const products = ["database", "storage"];
  (api.integrity as ReturnType<typeof vi.fn>).mockResolvedValue({
    available: true, canSign: true, editable: false, products, tokenMinutes: 60, debugTokens: [], playServiceAccount: null,
    enforcement: { database: "off", storage: "off" }, unverified: { database: { today: 1, last7Days: 1, lastSeen: null } },
    apps: [{ id: "a", name: "My app", androidPackage: null, appleBundleId: null, appleTeamId: null, appleDevelopment: false,
      androidCloudProjectNumber: null, androidSideloaded: false, androidDeviceIntegrity: "device", androidCertificates: [], webSiteKey: null, webHostnames: [],
      turnstileSecret: null, createdAt: "", devices: null, usage: { database: { today: 199, last7Days: 199, lastSeen: null } } }],
  });
  renderOverview();
  const card = await screen.findByTestId("integrity-summary");
  await waitFor(() => expect(within(card).getByText("Off: no product checks tokens")).toBeInTheDocument());
  expect(within(card).getByText("Today 99% verified (199 of 200)")).toBeInTheDocument();   // 99.5, not 100
});
