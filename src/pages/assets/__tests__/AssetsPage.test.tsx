import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ReleasesView } from "../AssetsPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, assets: vi.fn(), assetRelease: vi.fn(), assetDiff: vi.fn(), moveAssetChannel: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const page = {
  channels: [{ name: "production", release: 2, updatedAt: "2026-11-16T10:00:00Z", by: "ann@example.com" }],
  releases: [
    { number: 2, note: "German", by: "ann@example.com", at: "2026-11-16T10:00:00Z", files: 2, size: 2048 },
    { number: 1, note: "First", by: "ann@example.com", at: "2026-11-15T10:00:00Z", files: 1, size: 1024 },
  ],
  limits: { maxFilesPerRelease: 10000, maxFileBytes: 536870912, keepReleases: 50 },
  location: "the app's own location",
  moving: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ user: { role: "Admin" } });
});

function renderView() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ReleasesView /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test("no releases: how to publish the first", async () => {
  mock(api.assets).mockResolvedValue({ ...page, channels: [], releases: [] });
  renderView();
  expect(await screen.findByText("No releases yet")).toBeInTheDocument();
  expect(screen.getByText(/winche assets deploy/)).toBeInTheDocument();
});

test("channels and releases; a release opens with its files and changes", async () => {
  mock(api.assets).mockResolvedValue(page);
  mock(api.assetRelease).mockResolvedValue({ number: 2, note: "German", by: null, at: "2026-11-16T10:00:00Z", size: 2048,
    files: [{ path: "translations/de.json", hash: "a".repeat(64), size: 1024, mimeType: "application/json" }, { path: "translations/en.json", hash: "b".repeat(64), size: 1024, mimeType: "application/json" }] });
  mock(api.assetDiff).mockResolvedValue({ added: ["translations/de.json"], changed: [], removed: [] });
  renderView();
  const channel = await screen.findByTestId("asset-channel");
  expect(within(channel).getByText("production")).toBeInTheDocument();
  expect(within(channel).getByText("#2")).toBeInTheDocument();
  expect(screen.getAllByTestId("asset-release")).toHaveLength(2);

  fireEvent.click(screen.getAllByTestId("asset-release")[0]);
  expect(await screen.findByText("Release #2")).toBeInTheDocument();
  expect(await screen.findByTestId("asset-files")).toHaveTextContent("translations/en.json");
  await waitFor(() => expect(api.assetDiff).toHaveBeenCalledWith(1, 2));
  expect(await screen.findByTestId("asset-diff")).toHaveTextContent("added");
});

test("rolling a channel back to an older release", async () => {
  mock(api.assets).mockResolvedValue(page);
  mock(api.assetDiff).mockResolvedValue({ added: [], changed: [], removed: ["translations/de.json"] });
  mock(api.moveAssetChannel).mockResolvedValue({ ...page.channels[0], release: 1 });
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Move…" }));
  fireEvent.click(await screen.findByRole("textbox", { name: "Release" }));
  fireEvent.click(await screen.findByRole("option", { name: /#1/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Roll back" }));
  await waitFor(() => expect(api.moveAssetChannel).toHaveBeenCalledWith("production", 1));
});
