import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ListsView } from "../RealtimePage";
import { PresenceView } from "../PresenceView";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, realtimeLists: vi.fn(), realtimeItems: vi.fn(), realtimePresence: vi.fn(), closeRealtimeList: vi.fn(), deleteRealtimeList: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const open = { path: "sessions/s1", state: "open", count: 120, bytes: 4096, openedAt: "2026-11-24T10:00:00Z", closedAt: null };
const closed = { path: "sessions/s0", state: "closed", count: 3, bytes: 300, openedAt: "2026-11-23T10:00:00Z", closedAt: "2026-11-23T11:00:00Z" };
const item = (position: number) => ({ key: `dev1:${position}`, position, at: "2026-11-24T10:00:00Z", by: "u1", size: 20, text: `{"bpm":${position}}` });

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ user: { role: "Admin" } });
});

function renderIt(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test("no lists: an empty state; a filter with no match says so", async () => {
  mock(api.realtimeLists).mockResolvedValue({ lists: [], next: null });
  renderIt(<ListsView />);
  expect(await screen.findByText("No lists yet")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Closed"));
  expect(await screen.findByText("No lists match")).toBeInTheDocument();
  await waitFor(() => expect(api.realtimeLists).toHaveBeenLastCalledWith(expect.objectContaining({ state: "closed" })));
});

test("lists with their state, items and size; more are loaded by the next path", async () => {
  mock(api.realtimeLists).mockResolvedValueOnce({ lists: [open], next: "sessions/s1" }).mockResolvedValueOnce({ lists: [closed], next: null });
  renderIt(<ListsView />);
  const row = await screen.findByTestId("realtime-list");
  expect(row).toHaveTextContent("sessions/s1");
  expect(row).toHaveTextContent("open");
  expect(row).toHaveTextContent("120");
  expect(row).toHaveTextContent("4 KB");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(screen.getAllByTestId("realtime-list")).toHaveLength(2));
  expect(api.realtimeLists).toHaveBeenLastCalledWith(expect.objectContaining({ after: "sessions/s1" }));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

test("a list opens with its items as text; Load more reads after the last position", async () => {
  mock(api.realtimeLists).mockResolvedValue({ lists: [open], next: null });
  mock(api.realtimeItems)
    .mockResolvedValueOnce({ list: open, items: Array.from({ length: 100 }, (_, i) => item(i + 1)) })
    .mockResolvedValueOnce({ list: open, items: [item(101), { ...item(102), text: null }] });
  renderIt(<ListsView />);
  fireEvent.click(await screen.findByTestId("realtime-list"));
  const dialog = await screen.findByTestId("realtime-list-dialog");
  await waitFor(() => expect(within(dialog).getAllByTestId("realtime-item")).toHaveLength(100));
  expect(api.realtimeItems).toHaveBeenCalledWith("sessions/s1", 0, 100);
  expect(within(dialog).getByText('{"bpm":1}')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(within(dialog).getAllByTestId("realtime-item")).toHaveLength(102));
  expect(api.realtimeItems).toHaveBeenLastCalledWith("sessions/s1", 100, 100);
  expect(within(dialog).getByText(/Binary/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
});

test("a list of exactly a page of items offers no Load more that would load nothing", async () => {
  mock(api.realtimeLists).mockResolvedValue({ lists: [{ ...open, count: 100 }], next: null });
  mock(api.realtimeItems).mockResolvedValue({ list: { ...open, count: 100 }, items: Array.from({ length: 100 }, (_, i) => item(i + 1)) });
  renderIt(<ListsView />);
  fireEvent.click(await screen.findByTestId("realtime-list"));
  const dialog = await screen.findByTestId("realtime-list-dialog");
  await waitFor(() => expect(within(dialog).getAllByTestId("realtime-item")).toHaveLength(100));
  expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
});

test("a long item opens in full when clicked, saying where it was cut", async () => {
  const long = "x".repeat(4000) + "…";
  mock(api.realtimeLists).mockResolvedValue({ lists: [closed], next: null });
  mock(api.realtimeItems).mockResolvedValue({ list: closed, items: [{ ...item(1), text: long }] });
  renderIt(<ListsView />);
  fireEvent.click(await screen.findByTestId("realtime-list"));
  const dialog = await screen.findByTestId("realtime-list-dialog");
  fireEvent.click(await within(dialog).findByTestId("realtime-item"));
  expect(await within(dialog).findByText(/first 4,000 characters/)).toBeInTheDocument();
});

test("an open list's items refresh while its dialog is open", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mock(api.realtimeLists).mockResolvedValue({ lists: [open], next: null });
    mock(api.realtimeItems).mockResolvedValue({ list: open, items: [item(1)] });
    renderIt(<ListsView />);
    fireEvent.click(await screen.findByTestId("realtime-list"));
    await screen.findByTestId("realtime-list-dialog");
    await waitFor(() => expect(api.realtimeItems).toHaveBeenCalledTimes(1));
    mock(api.realtimeItems).mockResolvedValue({ list: { ...open, count: 2 }, items: [item(2)] });
    await vi.advanceTimersByTimeAsync(6000);
    // Only what came after the last item shown is asked for, and added: the loaded pages aren't read again.
    await waitFor(() => expect(api.realtimeItems).toHaveBeenLastCalledWith("sessions/s1", 1, 100));
    expect(mock(api.realtimeItems).mock.calls.filter((c) => c[1] === 0)).toHaveLength(1);
    const dialog = await screen.findByTestId("realtime-list-dialog");
    await waitFor(() => expect(within(dialog).getAllByTestId("realtime-item")).toHaveLength(2));
  } finally {
    vi.useRealTimers();
  }
});

test("a list with no items: an empty state", async () => {
  mock(api.realtimeLists).mockResolvedValue({ lists: [open], next: null });
  mock(api.realtimeItems).mockResolvedValue({ list: { ...open, count: 0 }, items: [] });
  renderIt(<ListsView />);
  fireEvent.click(await screen.findByTestId("realtime-list"));
  expect(await screen.findByText("No items yet")).toBeInTheDocument();
});

test("admins close an open list and delete a closed one, each after asking", async () => {
  mock(api.realtimeLists).mockResolvedValue({ lists: [open, closed], next: null });
  mock(api.closeRealtimeList).mockResolvedValue({ list: { ...open, state: "closed" } });
  mock(api.deleteRealtimeList).mockResolvedValue(undefined);
  renderIt(<ListsView />);
  const [openRow, closedRow] = await screen.findAllByTestId("realtime-list");
  expect(within(openRow).queryByRole("button", { name: "Delete" })).toBeNull();
  expect(within(closedRow).queryByRole("button", { name: "Close" })).toBeNull();

  fireEvent.click(within(openRow).getByRole("button", { name: "Close" }));
  expect(api.realtimeItems).not.toHaveBeenCalled();   // the row's button doesn't open the list
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(api.closeRealtimeList).toHaveBeenCalledWith("sessions/s1"));

  fireEvent.click(within(closedRow).getByRole("button", { name: "Delete" }));
  const confirm = await screen.findByRole("dialog", { name: "Delete the list" });
  expect(confirm).toHaveTextContent("sessions/s0");
  fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.deleteRealtimeList).toHaveBeenCalledWith("sessions/s0"));
});

test("viewers see the lists without Close or Delete", async () => {
  mock(useSession).mockReturnValue({ user: { role: "Viewer" } });
  mock(api.realtimeLists).mockResolvedValue({ lists: [open, closed], next: null });
  renderIt(<ListsView />);
  expect(await screen.findAllByTestId("realtime-list")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});

test("presence: an empty state until a path is given; then who's there, or nobody", async () => {
  mock(api.realtimePresence).mockResolvedValueOnce({ members: [{ uid: "u1", data: { name: "Ann", role: "lead" }, joinedAt: "2026-11-24T10:00:00Z" }] })
    .mockResolvedValueOnce({ members: [] });
  renderIt(<PresenceView />);
  expect(screen.getByText("See who's here")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Path"), { target: { value: "rooms/lobby" } });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
  const member = await screen.findByTestId("presence-member");
  expect(member).toHaveTextContent("u1");
  expect(member).toHaveTextContent('{"name":"Ann","role":"lead"}');
  expect(api.realtimePresence).toHaveBeenCalledWith("rooms/lobby");
  fireEvent.change(screen.getByLabelText("Path"), { target: { value: "rooms/empty" } });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
  expect(await screen.findByText("Nobody's here")).toBeInTheDocument();
});
