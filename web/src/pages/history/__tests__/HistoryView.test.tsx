import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { HistoryView, summary, who } from "../HistoryView";
import { api } from "../../../api/client";
import { valueText, type HistoryEntry } from "../../../api/history";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, history: vi.fn() } };
});
const history = api.history as ReturnType<typeof vi.fn>;

const entry = (seq: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  seq, type: "modified", path: "users/u1", version: 2, at: "2026-11-12T15:01:58Z", actor: "console:admin@winche.local",
  recorded: true,
  fields: [
    { field: "name", kind: "changed", before: { stringValue: "Ann" }, after: { stringValue: "Annie" } },
    { field: "phone", kind: "added", before: null, after: { stringValue: "+44 7700 900123" } },
  ],
  ...over,
});

function renderView(url = "/database/history") {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[url]}>
          <HistoryView />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test("lists changes with who, what and a summary, and opens one for old and new values", async () => {
  history.mockResolvedValue({ entries: [entry(9), entry(8, { type: "added", actor: "u1", fields: [{ field: "name", kind: "added", before: null, after: { stringValue: "Ann" } }] })] });
  renderView();

  const rows = await screen.findAllByTestId("history-row");
  expect(within(rows[0]).getByText("admin@winche.local (console)")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Changed")).toBeInTheDocument();
  expect(within(rows[0]).getByText("name changed · phone added")).toBeInTheDocument();
  expect(within(rows[1]).getByText("u1")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Added")).toBeInTheDocument();

  await userEvent.click(rows[0]);
  expect(await screen.findByText('"Ann"')).toBeInTheDocument();
  expect(screen.getByText('"Annie"')).toBeInTheDocument();
  expect(screen.getByText('"+44 7700 900123"')).toBeInTheDocument();
});

test("a document path shows its history; a collection path everything under it", async () => {
  history.mockResolvedValue({ entries: [] });
  renderView("/database/history?path=users/u1");
  await waitFor(() => expect(history).toHaveBeenCalledWith({ path: "users/u1", actor: "", limit: 50 }));

  const input = screen.getByLabelText("Document or path");
  await userEvent.clear(input);
  await userEvent.type(input, "users");
  await waitFor(() => expect(history).toHaveBeenLastCalledWith({ under: "users", actor: "", limit: 50 }));
  expect(await screen.findByText(/No changes match/)).toBeInTheDocument();
});

test("wording helpers", () => {
  expect(who(null)).toBe("the app (no user)");
  expect(who("u7")).toBe("u7");
  expect(summary(entry(1, { recorded: false, fields: null }))).toMatch(/weren't recorded/);
  expect(summary(entry(1, { type: "removed", fields: [{ field: "a", kind: "removed", before: 1, after: null }] }))).toBe("1 field");
  expect(valueText({ mapValue: { fields: { a: { integerValue: "1" }, b: { arrayValue: { values: [{ booleanValue: true }] } } } } })).toBe('{"a":1,"b":[true]}');
});
