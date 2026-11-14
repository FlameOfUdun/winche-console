import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { GeneralSettings as AppsPage } from "../AppsPage";
import { api } from "../../../api/client";
import type { AppsPageData } from "../../../api/apps";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn() } };
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
  mock(api.apps).mockReset();
  mock(api.apps).mockImplementation(async (platforms: string[]) => data(platforms));
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

test("shows the project's details and what apps see, without the options file", async () => {
  renderPage();
  expect(await screen.findByText("Your project")).toBeInTheDocument();
  expect(screen.getAllByText("https://api.example.com").length).toBeGreaterThan(0);
  expect(screen.getByText("/documents/v1")).toBeInTheDocument();
  expect(screen.getByText("g.apps.googleusercontent.com")).toBeInTheDocument();
  expect(screen.queryByTestId("options-file")).not.toBeInTheDocument();
});

test("Add app asks for the SDK (only Flutter for now), then shows the command and a download", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add app" }));
  expect(await screen.findByRole("button", { name: "macOS: not available yet" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Flutter" }));
  expect(await screen.findByText("winche configure --url https://api.example.com")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Download winche_options.dart/ }));
  await waitFor(() => expect(api.apps).toHaveBeenLastCalledWith(["android", "ios", "macos", "web", "windows", "linux"]));
});
