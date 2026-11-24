import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { RealtimeSettingsView } from "../RealtimeSettingsView";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, dataSettings: vi.fn(), saveDataSettings: vi.fn(), dataSettingsHistory: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settings = { idleCloseHours: 24, retainClosedDays: 30, archiveClosedLists: false, maxItemKb: 64, maxListItems: 200000, maxListMb: 50 };
const area = (editable: boolean) => ({ settings, codeDefault: settings, source: "console", editable, whyReadOnly: editable ? null : "Viewers can't change settings.",
  version: { number: 4, at: "2026-11-24T10:00:00Z", by: "ann@example.com", reason: "Longer sessions" } });

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.dataSettingsHistory).mockResolvedValue({ versions: [] });
});

function renderIt() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><RealtimeSettingsView /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test("lifecycle is edited in a dialog: never closing idle lists and archiving is saved with a reason, based on the version", async () => {
  mock(api.dataSettings).mockResolvedValue(area(true));
  mock(api.saveDataSettings).mockResolvedValue({ number: 5 });
  renderIt();
  const card = await screen.findByTestId("realtime-lifecycle");
  expect(card).toHaveTextContent("After 24 hours without a new item");
  expect(card).toHaveTextContent("archive.ndjson.gz");
  fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("Close idle lists"));
  fireEvent.click(within(dialog).getByLabelText("Archive closed lists"));
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Reason for the change"), { target: { value: "Keep every session" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveDataSettings).toHaveBeenCalledWith("realtime",
    { ...settings, idleCloseHours: null, archiveClosedLists: true }, "Keep every session", 4));
});

test("limits are saved from their own dialog", async () => {
  mock(api.dataSettings).mockResolvedValue(area(true));
  mock(api.saveDataSettings).mockResolvedValue({ number: 5 });
  renderIt();
  fireEvent.click(within(await screen.findByTestId("realtime-limits")).getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Largest item"), { target: { value: "128" } });
  fireEvent.change(within(dialog).getByLabelText("Reason for the change"), { target: { value: "Bigger frames" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveDataSettings).toHaveBeenCalledWith("realtime", { ...settings, maxItemKb: 128 }, "Bigger frames", 4));
});

test("read-only: no Edit", async () => {
  mock(api.dataSettings).mockResolvedValue(area(false));
  renderIt();
  expect(await screen.findByText(/Read-only/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});
