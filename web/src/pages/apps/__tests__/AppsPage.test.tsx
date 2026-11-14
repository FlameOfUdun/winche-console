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

test("shows the options file for the chosen platforms, the main() lines and this server", async () => {
  renderPage();
  expect(await screen.findByTestId("options-file")).toHaveTextContent("static final android");
  expect(screen.getByTestId("options-file")).not.toHaveTextContent("static final macos");
  expect(screen.getByText(/DefaultWincheOptions.currentPlatform/)).toBeInTheDocument();
  expect(screen.getByText("/documents/v1/ws")).toBeInTheDocument();
  expect(screen.getByText("g.apps.googleusercontent.com")).toBeInTheDocument();
  expect(screen.getByText(/winche configure --url https:\/\/api.example.com/)).toBeInTheDocument();
});

test("choosing another platform asks for a file with it", async () => {
  renderPage();
  await screen.findByTestId("options-file");
  await userEvent.click(screen.getByText("macOS"));
  await waitFor(() => expect(api.apps).toHaveBeenLastCalledWith(["android", "ios", "web", "macos"]));
  expect(await screen.findByTestId("options-file")).toHaveTextContent("static final macos");
});
