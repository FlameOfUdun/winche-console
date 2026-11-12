import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { HooksPage } from "../HooksPage";
import { api } from "../../../api/client";
import type { HooksPageData } from "../../../api/hooks";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: { ...actual.api, hooks: vi.fn(), saveHooks: vi.fn(), testHook: vi.fn(), hookSecret: vi.fn(), rotateHookSecret: vi.fn(), hookDeliveries: vi.fn(), retryHookDelivery: vi.fn() },
  };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const visits = {
  id: "visits", name: "New visits", enabled: true, when: { source: "database", events: ["created"], path: "patients/{patientId}" },
  do: { kind: "webhook", url: "https://ward.example.com/hooks", options: {} },
};
const page = (over: Partial<HooksPageData> = {}): HooksPageData => ({
  settings: { hooks: [visits] }, source: "console", version: { number: 1, at: "2026-11-12T20:00:00Z", by: "admin@trucorp.com", reason: "x" },
  editable: true, whyReadOnly: null, counts: { visits: { delivered: 12, failed: 1 } },
  sources: [
    { name: "database", title: "Documents", events: ["created", "updated", "deleted"], hasPaths: true, variables: ["path", "id", "collection"] },
    { name: "auth", title: "Users", events: ["created", "deleted", "signedIn"], hasPaths: false, variables: ["uid", "email", "provider"] },
  ],
  actions: [
    { name: "storage.deleteFiles", title: "Delete files", description: "Deletes every file under a folder.", sources: [],
      options: [{ name: "folder", label: "Folder to empty", placeholder: "users/{uid}/", required: true, help: null }] },
    { name: "auth.setClaims", title: "Copy fields into custom claims", description: "…", sources: ["database"], options: [] },
  ],
  ...over,
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><HooksPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.hooks).mockResolvedValue(page());
  mock(api.saveHooks).mockResolvedValue({ number: 2 });
  mock(api.hookDeliveries).mockResolvedValue({ deliveries: [] });
});

test("hooks read as sentences, with the last day's deliveries and the signing secret", async () => {
  mock(api.hookSecret).mockResolvedValue({ secret: "whsec_abc" });
  renderPage();
  const card = await screen.findByTestId("hook");
  expect(within(card).getByText("When a document is created at patients/{patientId}, call https://ward.example.com/hooks.")).toBeInTheDocument();
  expect(within(card).getByText("Last day: 12 delivered, 1 failed")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Show" }));
  expect(await within(card).findByTestId("hook-secret")).toHaveTextContent("whsec_abc");
});

test("a ready-made action: when a user is deleted, delete their files — checked, then saved with a reason", async () => {
  mock(api.testHook).mockResolvedValue({ ok: true, ran: false, options: { folder: "users/example-uid/" }, sample: {} });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add hook" }));
  const editor = screen.getByTestId("hook-editor");
  await userEvent.type(within(editor).getByLabelText("Name"), "Delete a user's files");
  await userEvent.click(within(editor).getByText("Users"));
  await userEvent.click(within(editor).getByText("deleted"));
  expect(within(editor).queryByLabelText(/Path/)).toBeNull();   // user events have no path
  await userEvent.click(within(editor).getByText("Ready-made action"));
  expect(within(editor).queryByText("Copy fields into custom claims")).toBeNull();   // that one suits document events
  await userEvent.type(within(editor).getByLabelText("Folder to empty"), "users/{{uid}/");
  expect(within(editor).getByText("Can use: {uid} {email} {provider}")).toBeInTheDocument();
  await userEvent.click(within(editor).getByRole("button", { name: "Check" }));
  expect(await within(editor).findByTestId("hook-test")).toHaveTextContent("folder = users/example-uid/");
  await userEvent.click(within(editor).getByRole("button", { name: "Done" }));
  await userEvent.type(screen.getByLabelText("Reason for the change"), "Clean up after users");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveHooks)).toHaveBeenCalled());
  const [hooks, reason] = mock(api.saveHooks).mock.calls[0];
  expect(reason).toBe("Clean up after users");
  expect(hooks[1]).toMatchObject({
    name: "Delete a user's files", enabled: true, when: { source: "auth", events: ["deleted"], path: null },
    do: { kind: "storage.deleteFiles", options: { folder: "users/{uid}/" } },
  });
});

test("deliveries: a failed one shows why and can be retried", async () => {
  mock(api.hookDeliveries).mockResolvedValue({ deliveries: [{
    id: "d1", hookId: "visits", hookName: "New visits", source: "database", type: "created", path: "patients/p1", status: "failed", attempts: 8,
    createdAt: "2026-11-12T20:00:00Z", nextAttemptAt: null, finishedAt: "2026-11-13T08:00:00Z", lastStatus: 503, lastResult: "Service Unavailable", durationMs: 40, event: { id: "e1" },
  }] });
  mock(api.retryHookDelivery).mockResolvedValue(undefined);
  renderPage();
  await userEvent.click(await screen.findByRole("tab", { name: "Deliveries" }));
  const row = await screen.findByTestId("delivery");
  expect(within(row).getByText("503 Service Unavailable")).toBeInTheDocument();
  await userEvent.click(within(row).getByRole("button", { name: "Retry" }));
  expect(mock(api.retryHookDelivery)).toHaveBeenCalledWith("d1");
});
