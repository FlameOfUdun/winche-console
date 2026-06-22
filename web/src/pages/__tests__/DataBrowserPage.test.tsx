import { render, screen, waitFor } from "@testing-library/react";
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
    api: { ...actual.api, listCollections: vi.fn(), queryDocuments: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), deleteDocument: vi.fn() },
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
