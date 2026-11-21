import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { GeneralSettings as AppsPage } from "../AppsPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import type { AppsPageData } from "../../../api/apps";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.apps).mockImplementation(async (platforms: string[]) => data(platforms));
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

test("its apps are under Integrity, not here", async () => {
  renderPage();
  expect(await screen.findByTestId("project-name")).toBeInTheDocument();
  expect(screen.queryByText("Your apps")).toBeNull();
  expect(screen.queryByText("Browser access")).toBeNull();
});
