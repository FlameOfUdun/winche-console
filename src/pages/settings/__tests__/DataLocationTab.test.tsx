import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { DataLocationTab } from "../DataLocationTab";
import { ApiError, api } from "../../../api/client";
import type { DataLocationInfo } from "../../../api/dataLocation";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, dataLocation: vi.fn(), checkDataTarget: vi.fn(), moveData: vi.fn(), finishDataMove: vi.fn(), setDataPool: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const own: DataLocationInfo = {
  host: null, port: null, database: "winche_p_records", username: null, sslMode: null, sizeBytes: 2_400_000, version: "17.2",
  maxConnections: null, commandTimeoutSeconds: null, previous: null, lastMoveFailed: null, suggestedDatabase: "winche_p_records",
};
const renderIt = () => render(
  <MantineProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DataLocationTab /></QueryClientProvider></MantineProvider>,
);
beforeEach(() => vi.clearAllMocks());

test("a project's database: checked, moved through the pause, then the old copy is deleted", async () => {
  mock(api.dataLocation).mockResolvedValue(own);
  mock(api.checkDataTarget).mockResolvedValue({ ok: true, problem: null, version: "17.2", exists: false, rowsToCopy: 1234 });
  mock(api.moveData).mockResolvedValue(undefined);
  mock(api.finishDataMove).mockResolvedValue(undefined);
  renderIt();
  expect(await screen.findByText("2.3 MB")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Move…" }));
  const dialog = await screen.findByRole("dialog");
  const name = within(dialog).getByLabelText(/Database/);
  expect(name).toHaveValue("winche_p_records");
  await userEvent.clear(name);
  await userEvent.type(name, "records_new");
  expect(within(dialog).getByRole("button", { name: "Move now" })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
  expect(await within(dialog).findByText(/The database will be created\. About 1,234 rows to copy\./)).toBeInTheDocument();

  // Paused: the project answers 503 with the move's progress; then it answers again, moved.
  const progress = { stage: "copying", table: "auth_users", tablesDone: 3, tablesTotal: 12, rows: 0, startedAt: "" };
  mock(api.dataLocation).mockRejectedValue(new ApiError(503, JSON.stringify({ error: { reason: "project-moving" }, move: progress })));
  await userEvent.click(within(dialog).getByRole("button", { name: "Move now" }));
  expect(api.moveData).toHaveBeenCalledWith({ database: "records_new" });
  expect(await screen.findByText("Copying tables: auth_users", undefined, { timeout: 3000 })).toBeInTheDocument();
  mock(api.dataLocation).mockResolvedValue({ ...own, database: "records_new",
    previous: { host: null, database: "winche_p_records", movedAt: new Date().toISOString() } });
  expect(await screen.findByTestId("finish-move", undefined, { timeout: 3000 })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Delete the old copy" }));
  await waitFor(() => expect(api.finishDataMove).toHaveBeenCalledWith(true));
});

test("a failed move says why; connections are saved", async () => {
  mock(api.dataLocation).mockResolvedValue({ ...own, lastMoveFailed: { error: "x has rows, but its product isn't started here.", at: new Date().toISOString() } });
  mock(api.setDataPool).mockResolvedValue(undefined);
  renderIt();
  expect(await screen.findByText("The last move didn't happen")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("At most"), "40");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.setDataPool).toHaveBeenCalledWith(40, null));
});
