import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { DataBrowserPage } from "../DataBrowserPage";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listCollections: vi.fn(), queryDocuments: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(),
      deleteDocument: vi.fn(), deleteCollection: vi.fn(),
    },
  };
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DataBrowserPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const aliceDoc = {
  path: "users/alice", id: "alice", collection: "users",
  fields: { name: { stringValue: "Alice" } }, createTime: "", updateTime: "", version: 1,
};

beforeEach(() => vi.clearAllMocks());

test("adding a collection queries it and lists document ids", async () => {
  (api.queryDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: [aliceDoc], hasMore: false });
  renderPage();

  await userEvent.type(screen.getByPlaceholderText("Collection ID"), "users");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() => expect(screen.getByRole("button", { name: /alice/ })).toBeInTheDocument());
  expect(api.queryDocuments).toHaveBeenCalledWith("users");
});

test("selecting a document loads and renders its fields", async () => {
  (api.queryDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: [aliceDoc], hasMore: false });
  (api.getDocument as ReturnType<typeof vi.fn>).mockResolvedValue(aliceDoc);
  renderPage();

  await userEvent.type(screen.getByPlaceholderText("Collection ID"), "users");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => screen.getByRole("button", { name: /alice/ }));
  await userEvent.click(screen.getByRole("button", { name: /alice/ }));

  await waitFor(() => expect(api.getDocument).toHaveBeenCalledWith("users/alice"));
  // Fields render as a read-only Firestore-style tree: name : "Alice" (string).
  await waitFor(() => expect(screen.getByText('"Alice"')).toBeInTheDocument());
});

test("deleting a document asks for confirmation first", async () => {
  (api.queryDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: [aliceDoc], hasMore: false });
  (api.getDocument as ReturnType<typeof vi.fn>).mockResolvedValue(aliceDoc);
  (api.deleteDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  renderPage();

  await userEvent.type(screen.getByPlaceholderText("Collection ID"), "users");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => screen.getByRole("button", { name: /alice/ }));
  await userEvent.click(screen.getByRole("button", { name: /alice/ }));
  await waitFor(() => screen.getByRole("button", { name: "Delete document" }));

  await userEvent.click(screen.getByRole("button", { name: "Delete document" }));
  // Confirmation gate — deletion only fires after confirming in the dialog.
  expect(api.deleteDocument).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete document" }));
  expect(api.deleteDocument).toHaveBeenCalledWith("users/alice");
});

test("deleting a collection asks for confirmation first", async () => {
  (api.queryDocuments as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: [aliceDoc], hasMore: false });
  (api.deleteCollection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  renderPage();

  await userEvent.type(screen.getByPlaceholderText("Collection ID"), "users");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => screen.getByRole("button", { name: /alice/ }));

  await userEvent.click(screen.getByRole("button", { name: "Delete collection" }));
  expect(api.deleteCollection).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete collection" }));
  expect(api.deleteCollection).toHaveBeenCalledWith("users");
});
