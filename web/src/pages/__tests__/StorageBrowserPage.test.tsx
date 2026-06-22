import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { StorageBrowserPage } from "../StorageBrowserPage";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, browseStorage: vi.fn(), deleteFile: vi.fn() } };
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <StorageBrowserPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const file = {
  id: "1", path: "docs/a.txt", directory: "docs", mimeType: "text/plain", sizeBytes: 3,
  uploadStatus: "complete", uploadId: null, metadata: {}, version: 1, createdAt: "", updatedAt: "",
};

beforeEach(() => vi.clearAllMocks());

test("browses folders and files at the current path", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: ["images"], files: [file] });
  renderPage();
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(screen.getByText("images")).toBeInTheDocument();
  expect(api.browseStorage).toHaveBeenCalledWith("");
});

test("deletes a file via the row menu", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [file] });
  (api.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  renderPage();
  await waitFor(() => screen.getByText("a.txt"));

  await userEvent.click(screen.getByRole("button", { name: "File menu" }));
  await userEvent.click(await screen.findByText("Delete"));
  expect(api.deleteFile).toHaveBeenCalledWith("docs/a.txt");
});
