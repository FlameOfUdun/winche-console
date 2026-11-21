import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { IntegrityPage } from "../IntegrityPage";
import { api } from "../../../api/client";
import type { AppsPageData, IntegrityApp, IntegrityData } from "../../../api/apps";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn(), integrity: vi.fn(), addApp: vi.fn(), updateApp: vi.fn(), removeApp: vi.fn(),
    setIntegrityEnforcement: vi.fn(), makeDebugToken: vi.fn(), removeDebugToken: vi.fn() } };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const page = (platforms: string[]): AppsPageData => ({
  setup: { projectId: "demo", name: null, baseUrl: "https://api.example.com", services: [], providers: [] },
  platforms: ["android", "ios", "macos", "web", "windows", "linux"],
  file: platforms.map((p) => `static final ${p} = WincheOptions(`).join("\n"),
  snippet: "WincheFlutter.initializeApp(options: DefaultWincheOptions.currentPlatform)",
});
const PRODUCTS = ["database", "storage", "authentication", "functions", "assets"];
const clinic: IntegrityApp = {
  id: "app-abc234def567", name: "Clinic app", sdk: "flutter", androidPackage: "com.example.clinic", appleBundleId: "com.example.clinic", appleTeamId: "ABCDE12345",
  createdAt: "2026-11-14T10:00:00Z", appleDevelopment: true, devices: { count: 3, development: 1, lastUsed: new Date().toISOString() },
  usage: { database: { today: 10, last7Days: 70, lastSeen: new Date().toISOString() }, authentication: { today: 2, last7Days: 10, lastSeen: null } },
};
const integrity = (over: Partial<IntegrityData> = {}): IntegrityData => ({
  available: true, canSign: true, editable: true, products: PRODUCTS,
  enforcement: Object.fromEntries(PRODUCTS.map((p) => [p, "monitor"])) as IntegrityData["enforcement"],
  tokenMinutes: 60, apps: [], unverified: {}, debugTokens: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.apps).mockImplementation(async (platforms: string[]) => page(platforms));
  mock(api.integrity).mockResolvedValue(integrity());
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><IntegrityPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test("no apps: an empty state; Add app asks for the SDK (only Flutter), adds it with its identifiers, then shows its own command and download", async () => {
  mock(api.addApp).mockResolvedValue({ id: "app-abc234def567" });
  renderPage();
  expect(await screen.findByText("No apps yet")).toBeInTheDocument();
  expect(screen.getByText("Add an app first.")).toBeInTheDocument();   // no debug tokens without one
  await userEvent.click(screen.getByRole("button", { name: "Add app" }));
  expect(await screen.findByRole("button", { name: "macOS: not available yet" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Flutter" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("App name"), "Clinic app");
  await userEvent.type(within(dialog).getByLabelText("Android package"), "com.example.clinic");
  await userEvent.type(within(dialog).getByLabelText("Apple bundle id"), "com.example.clinic");
  await userEvent.type(within(dialog).getByLabelText("Apple team id"), "abcde12345");
  expect(within(dialog).getByLabelText("App id")).toHaveValue("clinic-app");   // follows the name until edited
  await userEvent.clear(within(dialog).getByLabelText("App id"));
  await userEvent.type(within(dialog).getByLabelText("App id"), "clinic-ios");
  expect(within(dialog).queryByLabelText("Web addresses")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Add app" }));
  await waitFor(() => expect(api.addApp).toHaveBeenCalledWith({ name: "Clinic app", sdk: "flutter", androidPackage: "com.example.clinic",
    appleBundleId: "com.example.clinic", appleTeamId: "ABCDE12345", appleDevelopment: false, id: "clinic-ios" }));
  expect(await screen.findByText("winche configure --url https://api.example.com --app app-abc234def567")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Download winche_options.dart/ }));
  await waitFor(() => expect(api.apps).toHaveBeenLastCalledWith(["android", "ios", "macos", "web", "windows", "linux"], "app-abc234def567"));
});

test("with apps: each with its identifiers and verified requests; enforcement per product with today's counts, saved with a reason", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic], unverified: { database: { today: 3, last7Days: 5, lastSeen: null } } }));
  mock(api.setIntegrityEnforcement).mockResolvedValue({});
  renderPage();
  const row = await screen.findByTestId("integrity-app");
  expect(within(row).getByText("Clinic app")).toBeInTheDocument();
  expect(within(row).getByText("com.example.clinic")).toBeInTheDocument();
  expect(within(row).getByText("ABCDE12345.com.example.clinic")).toBeInTheDocument();
  expect(within(row).getByText(/12 verified requests today · 80 this week · last seen just now/)).toBeInTheDocument();
  expect(within(row).getByTestId("app-attest-devices")).toHaveTextContent("App Attest: 3 devices (1 development) · last proof just now · development builds accepted");

  const card = screen.getByTestId("integrity-enforcement");
  expect(within(card).getByText("Today: 10 verified · 3 without a token")).toBeInTheDocument();
  expect(within(card).getByText("60 minutes")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
  await userEvent.click(within(within(card).getByRole("radiogroup", { name: "Database mode" })).getByLabelText("Enforce"));
  await userEvent.click(within(within(card).getByRole("radiogroup", { name: "Assets mode" })).getByLabelText("Off"));
  const minutes = within(card).getByLabelText("Tokens last (minutes)");
  await userEvent.clear(minutes);
  await userEvent.type(minutes, "120");
  await userEvent.type(within(card).getByLabelText("Reason for the change"), "Our apps all send tokens");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.setIntegrityEnforcement).toHaveBeenCalledWith(
    { database: "enforce", storage: "monitor", authentication: "monitor", functions: "monitor", assets: "off" }, 120, "Our apps all send tokens"));
});

test("a debug token is made for an app and shown once; removing one asks first", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic],
    debugTokens: [{ id: "dt-1", app: clinic.id, name: "Ann's simulator", createdAt: "2026-11-20T10:00:00Z", createdBy: "admin@example.com" }] }));
  mock(api.makeDebugToken).mockResolvedValue({ id: "dt-2", app: clinic.id, name: "CI", token: "wdt_secret-value" });
  mock(api.removeDebugToken).mockResolvedValue(undefined);
  renderPage();
  const tokens = await screen.findByTestId("integrity-debug-tokens");
  expect(within(tokens).getByText("Ann's simulator")).toBeInTheDocument();
  expect(within(tokens).getByText("Clinic app")).toBeInTheDocument();

  await userEvent.click(within(tokens).getByRole("button", { name: "Make debug token" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Name"), "CI");
  await userEvent.click(within(dialog).getByRole("button", { name: "Make token" }));
  await waitFor(() => expect(api.makeDebugToken).toHaveBeenCalledWith(clinic.id, "CI"));
  expect(await screen.findByTestId("debug-token-value")).toHaveTextContent("wdt_secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Done" }));

  await userEvent.click(within(tokens).getByRole("button", { name: "Remove Ann's simulator" }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove token" }));
  await waitFor(() => expect(api.removeDebugToken).toHaveBeenCalledWith("dt-1"));
});

test("viewers see it all and change nothing; without a master key it says so", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic], editable: false, canSign: false }));
  renderPage();
  expect(await screen.findByTestId("integrity-app")).toBeInTheDocument();
  expect(screen.getByText(/no master key/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add app" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Make debug token" })).toBeNull();
  expect(within(screen.getByTestId("integrity-enforcement")).queryByRole("button", { name: "Edit" })).toBeNull();
});
