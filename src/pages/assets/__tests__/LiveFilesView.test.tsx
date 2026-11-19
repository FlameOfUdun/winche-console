import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { LiveFilesView } from "../LiveFilesView";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, assets: vi.fn(), assetChannelFiles: vi.fn(), assetContent: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const page = (channels: { name: string; release: number }[]) => ({
  channels: channels.map((c) => ({ ...c, updatedAt: "2026-11-19T10:00:00Z", by: null })), releases: [], limits: {}, location: "here", moving: null,
});
const live = {
  channel: "production", release: 3, publishedAt: "2026-11-19T10:00:00Z", note: "Audio", by: "ann@example.com", size: 4096,
  files: [
    { path: "audio/de/objective_completed.wav", hash: "a".repeat(64), size: 2048, mimeType: "audio/wav", since: 3 },
    { path: "translations/application_en.json", hash: "b".repeat(64), size: 1024, mimeType: "application/json", since: 2 },
    { path: "videos/bvm.mp4", hash: "c".repeat(64), size: 1024, mimeType: "video/mp4", since: 3, url: "https://cdn.example.com/app/bvm.mp4" },
  ],
};

beforeEach(() => vi.clearAllMocks());

function renderView() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LiveFilesView /></QueryClientProvider>
    </MantineProvider>,
  );
}

test("no channel yet: how to publish", async () => {
  mock(api.assets).mockResolvedValue(page([]));
  renderView();
  expect(await screen.findByText("No assets yet")).toBeInTheDocument();
});

test("the live files by folder, with when each arrived, searched, and one opened with its preview", async () => {
  mock(api.assets).mockResolvedValue(page([{ name: "beta", release: 4 }, { name: "production", release: 3 }]));
  mock(api.assetChannelFiles).mockResolvedValue(live);
  mock(api.assetContent).mockResolvedValue(new Blob(['{"hello":"Hello"}'], { type: "application/json" }));
  renderView();

  const folders = await screen.findAllByTestId("asset-folder");
  expect(folders.map((f) => within(f).getByRole("heading").textContent)).toEqual(["audio", "translations", "videos"]);
  expect(mock(api.assetChannelFiles)).toHaveBeenCalledWith("production");   // production first, whatever the order
  expect(within(folders[1]).getByText("since #2")).toBeInTheDocument();
  expect(within(folders[0]).getByText("new in this release")).toBeInTheDocument();
  expect(within(folders[2]).getByText("CDN")).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Search paths"), "json");
  expect(screen.getAllByTestId("asset-folder")).toHaveLength(1);

  await userEvent.click(screen.getByRole("button", { name: "translations/application_en.json" }));
  expect(await screen.findByTestId("asset-file-details")).toHaveTextContent("unchanged since release #2");
  expect(await screen.findByTestId("asset-preview-text")).toHaveTextContent('"hello": "Hello"');
  expect(mock(api.assetContent)).toHaveBeenCalledWith(3, "translations/application_en.json");
});
