import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ProductHooks, type HookSource } from "../ProductHooks";
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
  id: "visits", name: "New visits", enabled: true, when: { source: "database", events: ["created"], path: "visits/{visitId}" },
  do: { kind: "webhook", url: "https://records.example.com/hooks", options: {} },
};
const page = (over: Partial<HooksPageData> = {}): HooksPageData => ({
  settings: { hooks: [visits] }, source: "console", version: { number: 1, at: "2026-11-12T20:00:00Z", by: "admin@example.com", reason: "x" },
  editable: true, whyReadOnly: null, counts: { visits: { delivered: 12, failed: 1 } },
  sources: [
    { name: "database", title: "Documents", events: ["created", "updated", "deleted"], hasPaths: true, variables: ["path", "id", "collection"] },
    { name: "auth", title: "Users", events: ["created", "deleted", "signedIn"], hasPaths: false, variables: ["uid", "email", "provider"] },
  ],
  ...over,
});

function renderPage(source: HookSource = "database") {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ProductHooks source={source} /></MemoryRouter>
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
  expect(within(card).getByText("When a document is created at visits/{visitId}, call https://records.example.com/hooks.")).toBeInTheDocument();
  expect(within(card).getByText("Last day: 12 delivered, 1 failed")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Show" }));
  expect(await within(card).findByTestId("hook-secret")).toHaveTextContent("whsec_abc");
});

test("a webhook for users' events: tested with a sample, then saved with a reason; no actions to pick", async () => {
  mock(api.testHook).mockResolvedValue({ ok: true, ran: true, status: 200, durationMs: 42, result: "ok", sample: {} });
  renderPage("auth");
  // Authentication → Webhooks lists only the users' webhooks: none yet (the database's isn't shown).
  expect(await screen.findByText("No webhooks yet")).toBeInTheDocument();
  expect(screen.getByText(/write a function with that trigger/)).toBeInTheDocument();
  expect(screen.queryByText("New visits")).toBeNull();
  await userEvent.click(await screen.findByRole("button", { name: "Add webhook" }));
  const editor = await screen.findByTestId("hook-editor");
  expect(within(editor).queryByLabelText("Source")).toBeNull();   // the tab says whose events
  expect(within(editor).queryByText("Ready-made action")).toBeNull();
  await userEvent.type(within(editor).getByLabelText("Name"), "Tell the CRM");
  await userEvent.click(within(editor).getByText("deleted"));
  expect(within(editor).queryByLabelText(/Path/)).toBeNull();   // user events have no path
  await userEvent.type(within(editor).getByLabelText(/^Address/), "https://crm.example.com/winche");
  expect(within(editor).getByText("The body's vars carry: {uid} {email} {provider}")).toBeInTheDocument();
  await userEvent.click(within(editor).getByRole("button", { name: "Send a test" }));
  expect(await within(editor).findByTestId("hook-test")).toHaveTextContent("Delivered (200) in 42 ms");
  await userEvent.click(within(editor).getByRole("button", { name: "Done" }));
  // The dialog hands focus back to its opener once its closing transition ends: type the reason after that.
  await waitFor(() => expect(screen.queryByTestId("hook-editor")).toBeNull());
  await new Promise((r) => setTimeout(r, 400));
  await userEvent.type(screen.getByLabelText("Reason for the change"), "CRM sync");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveHooks)).toHaveBeenCalled());
  const [hooks, reason] = mock(api.saveHooks).mock.calls[0];
  expect(reason).toBe("CRM sync");
  expect(hooks[1]).toMatchObject({
    name: "Tell the CRM", enabled: true, when: { source: "auth", events: ["deleted"], path: null },
    do: { kind: "webhook", url: "https://crm.example.com/winche" },
  });
});

test("deliveries: a failed one shows why and can be retried", async () => {
  mock(api.hookDeliveries).mockResolvedValue({ deliveries: [{
    id: "d1", hookId: "visits", hookName: "New visits", source: "database", type: "created", path: "visits/v1", status: "failed", attempts: 8,
    createdAt: "2026-11-12T20:00:00Z", nextAttemptAt: null, finishedAt: "2026-11-13T08:00:00Z", lastStatus: 503, lastResult: "Service Unavailable", durationMs: 40, event: { id: "e1" },
  }] });
  mock(api.retryHookDelivery).mockResolvedValue(undefined);
  renderPage();
  await userEvent.click(await screen.findByText("Deliveries"));
  const row = await screen.findByTestId("delivery");
  expect(within(row).getByText("503 Service Unavailable")).toBeInTheDocument();
  await userEvent.click(within(row).getByRole("button", { name: "Retry" }));
  expect(mock(api.retryHookDelivery)).toHaveBeenCalledWith("d1");
});
