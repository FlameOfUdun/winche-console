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
  return {
    ...actual,
    api: { ...actual.api, browseStorage: vi.fn(), deleteFile: vi.fn(), deleteDirectory: vi.fn(), uploadUrl: vi.fn() },
  };
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

test("shows each file's upload status", async () => {
  const pending = { ...file, path: "docs/b.txt", uploadStatus: "pending" };
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [file, pending] });
  renderPage();
  await waitFor(() => screen.getByText("a.txt"));
  expect(screen.getByText("complete")).toBeInTheDocument();
  expect(screen.getByText("pending")).toBeInTheDocument();
});

test("deletes a file via the row menu", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [file] });
  (api.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  renderPage();
  await waitFor(() => screen.getByText("a.txt"));

  await userEvent.click(screen.getByRole("button", { name: "File menu" }));
  await userEvent.click(await screen.findByText("Delete"));
  // Confirmation gate — the file is only deleted after confirming.
  expect(api.deleteFile).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole("button", { name: "Delete file" }));
  expect(api.deleteFile).toHaveBeenCalledWith("docs/a.txt");
});

test("deletes a folder (cascade) after confirmation", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: ["images"], files: [] });
  (api.deleteDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  renderPage();
  await waitFor(() => screen.getByText("images"));

  await userEvent.click(screen.getByRole("button", { name: "Folder menu" }));
  await userEvent.click(await screen.findByText("Delete folder"));
  // Confirmation modal — the destructive action runs only after confirming.
  expect(api.deleteDirectory).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole("button", { name: "Delete folder" }));
  expect(api.deleteDirectory).toHaveBeenCalledWith("images");
});

async function createFolder(name: string) {
  await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
  await userEvent.type(await screen.findByLabelText("Folder name"), name);
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
}

test("creates an empty in-memory folder without forcing an upload", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: ["images"], files: [] });
  renderPage();
  await waitFor(() => screen.getByText("images"));

  await createFolder("reports");

  // The new folder is listed in place, marked as an unsaved/empty in-memory folder...
  expect(await screen.findByText("reports")).toBeInTheDocument();
  expect(screen.getAllByText("empty")).toHaveLength(1); // only the ephemeral one, not the real "images"
  // ...and nothing was uploaded to materialize it.
  expect(api.uploadUrl).not.toHaveBeenCalled();
});

test("nests an in-memory subfolder by navigating into a created folder", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [] });
  renderPage();
  await waitFor(() => screen.getByText("This folder is empty."));

  await createFolder("reports");
  await userEvent.click(screen.getByText("reports"));     // navigate into it
  await waitFor(() => expect(api.browseStorage).toHaveBeenCalledWith("reports"));
  await createFolder("2026");

  expect(await screen.findByText("2026")).toBeInTheDocument();
});

test("discards an empty in-memory folder locally after confirmation (no API call)", async () => {
  (api.browseStorage as ReturnType<typeof vi.fn>).mockResolvedValue({ folders: [], files: [] });
  renderPage();
  await waitFor(() => screen.getByText("This folder is empty."));

  await createFolder("reports");
  await screen.findByText("reports");

  await userEvent.click(screen.getByRole("button", { name: "Folder menu" }));
  await userEvent.click(await screen.findByText("Delete folder"));
  await userEvent.click(await screen.findByRole("button", { name: "Delete folder" }));

  await waitFor(() => expect(screen.queryByText("reports")).not.toBeInTheDocument());
  expect(api.deleteDirectory).not.toHaveBeenCalled();
});
