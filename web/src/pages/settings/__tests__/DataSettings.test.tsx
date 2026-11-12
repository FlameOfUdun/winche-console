import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { SubsystemTabs } from "../../rules/SubsystemTabs";
import { DatabaseSettingsView } from "../DatabaseSettingsView";
import { StorageSettingsView } from "../StorageSettingsView";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import type { DatabaseSettings, StorageSettings } from "../../../api/dataSettings";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, rulesSubsystems: vi.fn(), dataSettings: vi.fn(), saveDataSettings: vi.fn(), dataSettingsHistory: vi.fn(),
      restoreDataSettings: vi.fn(), indexSuggestions: vi.fn(),
    },
  };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const db: DatabaseSettings = {
  indexes: [{ collection: "patients", fields: [{ path: "ward", direction: "asc" }], kind: "ordered", collectionGroup: false }],
  dropUndeclaredIndexes: true, ttl: [], history: { enabled: false, retentionDays: 30 }, writeLimits: { maxDocumentKb: 1024, maxDepth: 20 },
  slowQueryMs: 500, requestLog: { enabled: true, sampleRate: 0.1, slowMs: 1000 },
};
const storage: StorageSettings = {
  maxFileSizeMb: 10, requestLog: { enabled: false, sampleRate: 0.1, slowMs: 1000 }, orphanSweep: { enabled: false, intervalHours: 6, graceHours: 24, prefix: null },
};
const area = <T,>(settings: T) => ({ settings, codeDefault: settings, source: "code", version: null, editable: true, whyReadOnly: null });

function renderIt(node: React.ReactNode) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ user: { role: "Admin" }, state: { capabilities: { settings: { database: true } } }, refresh: vi.fn() });
  mock(api.rulesSubsystems).mockResolvedValue([]);
  mock(api.dataSettings).mockImplementation((a: string) => Promise.resolve(area(a === "database" ? db : storage)));
  mock(api.dataSettingsHistory).mockResolvedValue({ versions: [], editable: true });
  mock(api.indexSuggestions).mockResolvedValue({ suggestions: [] });
  mock(api.saveDataSettings).mockResolvedValue({ number: 1 });
});

test("the Settings sub-tab shows for admins when the database uses settings", async () => {
  renderIt(<SubsystemTabs subsystem="database" primaryLabel="Documents" basePath="/database"><div>docs</div></SubsystemTabs>);
  expect(await screen.findByRole("tab", { name: "Settings" })).toBeInTheDocument();
  mock(useSession).mockReturnValue({ user: { role: "Admin" }, state: { capabilities: {} }, refresh: vi.fn() });
  renderIt(<SubsystemTabs subsystem="storage" primaryLabel="Files" basePath="/storage"><div>files</div></SubsystemTabs>);
  await waitFor(() => expect(screen.getAllByRole("tab", { name: "Settings" })).toHaveLength(1));
});

test("an index is added by hand, an expiry policy too, and history turned on, saved with a reason", async () => {
  renderIt(<DatabaseSettingsView />);
  expect(await screen.findByText("These are the starting values from the app's code.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add index" }));
  await userEvent.type(screen.getAllByPlaceholderText("sessions")[0], "sessions");   // the index form comes first
  await userEvent.type(screen.getByLabelText("Fields, in order"), "userId, startedAt desc");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getAllByTestId("db-index")).toHaveLength(2);
  await userEvent.type(screen.getByPlaceholderText("expiresAt"), "expiresAt");
  await userEvent.type(screen.getAllByPlaceholderText("sessions").at(-1)!, "sessions");
  await userEvent.click(screen.getByRole("button", { name: "Add expiry" }));
  await userEvent.click(screen.getByLabelText("Keep document history"));
  await userEvent.type(screen.getByLabelText("Reason for the change"), "Session lists");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("database", {
    ...db,
    indexes: [...db.indexes, { collection: "sessions", fields: [{ path: "userId", direction: "asc" }, { path: "startedAt", direction: "desc" }], kind: "ordered", collectionGroup: false }],
    ttl: [{ collection: "sessions", field: "expiresAt" }],
    history: { enabled: true, retentionDays: 30 },
  }, "Session lists"));
});

test("a slow query's suggested index is added with one click", async () => {
  mock(api.indexSuggestions).mockResolvedValue({ suggestions: [
    { collection: "visits", fields: [{ path: "patientId", direction: "asc" }, { path: "at", direction: "desc" }], kind: "ordered", collectionGroup: false,
      elapsedMs: 840, at: "2026-11-12T20:00:00Z", code: "ib.Add(...)" },
  ] });
  renderIt(<DatabaseSettingsView />);
  const box = await screen.findByTestId("index-suggestions");
  expect(within(box).getByText("visits: patientId, at desc")).toBeInTheDocument();
  await userEvent.click(within(box).getByRole("button", { name: "Add" }));
  expect(screen.getAllByTestId("db-index")).toHaveLength(2);
  expect(screen.queryByTestId("index-suggestions")).toBeNull();   // already listed now
});

test("storage: the size limit and the clean-up change", async () => {
  renderIt(<StorageSettingsView />);
  const size = await screen.findByLabelText("Largest file (MB)");
  await userEvent.clear(size);
  await userEvent.type(size, "5");
  await userEvent.click(screen.getByLabelText("Clean up regularly"));
  await userEvent.type(screen.getByLabelText("Reason for the change"), "Smaller uploads");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("storage",
    { ...storage, maxFileSizeMb: 5, orphanSweep: { ...storage.orphanSweep, enabled: true } }, "Smaller uploads"));
});
