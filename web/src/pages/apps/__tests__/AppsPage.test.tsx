import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { GeneralSettings as AppsPage } from "../AppsPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import type { AppsPageData, RegisteredApp } from "../../../api/apps";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn(), registeredApps: vi.fn(), registerApp: vi.fn(), removeApp: vi.fn(), setAppsPolicy: vi.fn(),
    project: vi.fn(), renameProject: vi.fn(), setProjectImage: vi.fn(), removeProjectImage: vi.fn(), projectImage: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
vi.mock("../../../components/ProjectAvatar", async (orig) => {
  const actual = await orig<typeof import("../../../components/ProjectAvatar")>();
  // jsdom can't draw: the thumbnail is the file itself.
  return { ...actual, squareThumbnail: vi.fn(async (f: Blob) => f) };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const data = (platforms: string[]): AppsPageData => ({
  setup: {
    projectId: "demo", name: null, baseUrl: "https://api.example.com",
    services: [{ id: "database", path: "/documents/v1", livePath: "/documents/v1/ws" }, { id: "storage", path: "/files/v1", livePath: null }],
    providers: [{ name: "google", kind: "google", displayName: "Google", clientIds: ["g.apps.googleusercontent.com"] }],
  },
  platforms: ["android", "ios", "macos", "web", "windows", "linux"],
  file: platforms.map((p) => `static final ${p} = WincheOptions(`).join("\n"),
  snippet: "WincheFlutter.initializeApp(options: DefaultWincheOptions.currentPlatform)",
});

const clinic: RegisteredApp = {
  id: "app-abc234def567", name: "Clinic app", sdk: "flutter", androidPackage: "com.example.clinic", appleBundleId: null,
  webOrigins: ["https://app.example.com"], createdAt: "2026-11-14T10:00:00Z",
  usage: { today: 12, last7Days: 80, lastSeen: new Date().toISOString() },
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.apps).mockImplementation(async (platforms: string[]) => data(platforms));
  mock(api.registeredApps).mockResolvedValue({ available: true, editable: true, registeredOnly: false, apps: [], unregistered: null });
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Admin" } });
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "clinic-records", name: "Clinic records", products: [], imageVersion: null });
  mock(api.projectImage).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><AppsPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test("the project: name and id, no addresses; admins rename it (the id stays) and give it an image", async () => {
  mock(api.renameProject).mockResolvedValue({});
  mock(api.setProjectImage).mockResolvedValue({ imageVersion: "1" });
  renderPage();
  await waitFor(() => expect(screen.getByTestId("project-name")).toHaveTextContent("Clinic records"));
  expect(screen.getByText("clinic-records")).toBeInTheDocument();
  expect(screen.queryByText("https://api.example.com")).toBeNull();   // no server or console address
  expect(screen.queryByText("What apps see")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Project name");
  await userEvent.clear(input);
  await userEvent.type(input, "Clinic");
  await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(api.renameProject).toHaveBeenCalledWith("Clinic", "clinic-records"));

  const file = new File(["png"], "logo.png", { type: "image/png" });
  await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
  await waitFor(() => expect(api.setProjectImage).toHaveBeenCalledWith(file));
});

test("non-admins can't rename or change the image", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Viewer" } });
  renderPage();
  expect(await screen.findByTestId("project-name")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add image" })).toBeNull();
});

test("no apps: an empty state; Add app asks for the SDK (only Flutter), registers it, then shows its own command and download", async () => {
  mock(api.registerApp).mockResolvedValue({ id: "app-abc234def567" });
  renderPage();
  expect(await screen.findByText("No apps yet")).toBeInTheDocument();
  expect(screen.queryByTestId("registered-app")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Add app" }));
  expect(await screen.findByRole("button", { name: "macOS: not available yet" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Flutter" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("App name"), "Clinic app");
  await userEvent.type(within(dialog).getByLabelText("Android package"), "com.example.clinic");
  // The id follows the name until it's edited; it's sent as chosen.
  expect(within(dialog).getByLabelText("App id")).toHaveValue("clinic-app");
  await userEvent.clear(within(dialog).getByLabelText("App id"));
  await userEvent.type(within(dialog).getByLabelText("App id"), "clinic-ios");
  await userEvent.click(within(dialog).getByRole("button", { name: "Register app" }));
  await waitFor(() => expect(api.registerApp).toHaveBeenCalledWith({ name: "Clinic app", sdk: "flutter", androidPackage: "com.example.clinic", appleBundleId: null, webOrigins: [], id: "clinic-ios" }));
  expect(await screen.findByText("winche configure --url https://api.example.com --app app-abc234def567")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Download winche_options.dart/ }));
  await waitFor(() => expect(api.apps).toHaveBeenLastCalledWith(["android", "ios", "macos", "web", "windows", "linux"], "app-abc234def567"));
});

test("with apps: the list with each app's identifiers and requests, and the registered-only switch", async () => {
  mock(api.registeredApps).mockResolvedValue({ available: true, editable: true, registeredOnly: false, apps: [clinic],
    unregistered: { today: 3, last7Days: 5, lastSeen: null } });
  mock(api.setAppsPolicy).mockResolvedValue({ registeredOnly: true });
  renderPage();
  const row = await screen.findByTestId("registered-app");
  expect(screen.queryByText("No apps yet")).toBeNull();
  expect(within(row).getByText("Clinic app")).toBeInTheDocument();
  expect(within(row).getByText("com.example.clinic")).toBeInTheDocument();
  expect(within(row).getByText("https://app.example.com")).toBeInTheDocument();
  expect(within(row).getByText(/12 requests today · 80 this week · last seen just now/)).toBeInTheDocument();
  expect(screen.getByText(/Without an app id: 3 requests today/)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Only registered apps may call"));
  await waitFor(() => expect(api.setAppsPolicy).toHaveBeenCalledWith(true));
});
