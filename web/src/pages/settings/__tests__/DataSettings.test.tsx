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
      restoreDataSettings: vi.fn(), indexSuggestions: vi.fn(), storageLocation: vi.fn(), testStorageLocation: vi.fn(), startStorageMove: vi.fn(),
      storageMoveStep: vi.fn(),
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
  slowQueryMs: 500, expandLimit: 100, requestLog: { enabled: true, sampleRate: 0.1, slowMs: 1000 },
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
  mock(api.dataSettings).mockImplementation((a: string) =>
    a === "database.live" ? Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })) : Promise.resolve(area(a === "database" ? db : storage)));
  mock(api.dataSettingsHistory).mockResolvedValue({ versions: [], editable: true });
  mock(api.indexSuggestions).mockResolvedValue({ suggestions: [] });
  mock(api.saveDataSettings).mockResolvedValue({ number: 1 });
  mock(api.storageLocation).mockResolvedValue(location());
});

const location = (over: object = {}) => ({
  active: null, activeLabel: "a folder on the server (/srv/files)", codeLabel: "a folder on the server (/srv/files)", kinds: ["s3"], move: null,
  progress: null, editable: true, secretsAvailable: true, ...over,
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

test("moving files: choose an R2 bucket, test it, then start copying with a reason", async () => {
  mock(api.testStorageLocation).mockResolvedValue({ ok: true, steps: [{ name: "Write a file", ok: true, error: null }, { name: "Delete it", ok: true, error: null }] });
  mock(api.startStorageMove).mockResolvedValue({});
  renderIt(<StorageSettingsView />);
  expect(await screen.findByTestId("location-active")).toHaveTextContent("a folder on the server (/srv/files)");
  await userEvent.click(screen.getByRole("button", { name: "Move files…" }));
  await userEvent.click(screen.getByText("Cloudflare R2"));
  await userEvent.type(screen.getByLabelText("Bucket"), "smartairway-files");
  await userEvent.type(screen.getByLabelText("Service address"), "https://acct.r2.cloudflarestorage.com");
  await userEvent.type(screen.getByLabelText("Access key id"), "AK");
  await userEvent.type(screen.getByLabelText(/Secret access key/), "SK");
  expect(screen.queryByRole("button", { name: "Start copying" })).toBeNull();   // test first
  await userEvent.click(screen.getByRole("button", { name: "Test" }));
  expect(await screen.findByTestId("location-test")).toHaveTextContent("✓ Write a file");
  await userEvent.type(screen.getByLabelText("Reason for the move"), "Off the server's disk");
  await userEvent.click(screen.getByRole("button", { name: "Start copying" }));
  const bucket = { kind: "s3", s3: { bucket: "smartairway-files", region: "auto", serviceUrl: "https://acct.r2.cloudflarestorage.com", accessKey: "AK", forcePathStyle: false } };
  expect(mock(api.testStorageLocation)).toHaveBeenCalledWith(bucket, "SK");
  await waitFor(() => expect(mock(api.startStorageMove)).toHaveBeenCalledWith(bucket, "SK", "Off the server's disk"));
});

const move = (phase: string) => ({ id: "m1", phase, startedAt: "2026-11-12T20:00:00Z", fromLabel: "a folder on the server (/srv/files)", toLabel: "bucket smartairway-files" });

test("moving files: once everything is copied, switch; finish waits for a clean catch-up", async () => {
  mock(api.storageLocation).mockResolvedValue(location({
    move: move("ready"),
    progress: { moveId: "m1", total: 120, copied: 120, alreadyThere: 0, failed: 0, bytes: 52428800, lastError: null, passStartedAt: "2026-11-12T20:00:00Z", passFinishedAt: "2026-11-12T20:01:00Z", passes: 1 },
  }));
  mock(api.storageMoveStep).mockResolvedValue(undefined);
  renderIt(<StorageSettingsView />);
  expect(await screen.findByTestId("move-progress")).toHaveTextContent("120 of 120 files there");
  expect(screen.getByText("Every file is copied")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Reason for this step"), "All copied");
  await userEvent.click(screen.getByRole("button", { name: "Switch to the new place" }));
  await waitFor(() => expect(mock(api.storageMoveStep)).toHaveBeenCalledWith("switch", "All copied"));
});

test("moving files: after the switch, finish is held until a pass completes with no failures", async () => {
  mock(api.storageLocation).mockResolvedValue(location({
    move: move("switched"),
    progress: { moveId: "m1", total: 121, copied: 0, alreadyThere: 120, failed: 1, bytes: 0, lastError: "docs/x.pdf: timeout", passStartedAt: null, passFinishedAt: "2026-11-12T20:05:00Z", passes: 3 },
  }));
  renderIt(<StorageSettingsView />);
  expect(await screen.findByText("Last problem: docs/x.pdf: timeout")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Reason for this step"), "Done");
  expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Cancel the move" })).toBeNull();
});

test("live-connection limits show when the app has them", async () => {
  const live = { maxConnectionsPerUser: 10, maxSubscriptionsPerConnection: 100, requestsPerSecond: 50, requestBurst: 100, maxMessageKb: 1024 };
  mock(api.dataSettings).mockImplementation((a: string) => Promise.resolve(area(a === "database.live" ? live : db)));
  renderIt(<DatabaseSettingsView />);
  const perUser = await screen.findByLabelText(/Connections per user/);
  await userEvent.clear(perUser);
  await userEvent.type(perUser, "3");
  const bars = screen.getAllByLabelText("Reason for the change");
  await userEvent.type(bars[bars.length - 1], "Fewer tabs per user");
  const saves = screen.getAllByRole("button", { name: "Save changes" });
  await userEvent.click(saves[saves.length - 1]);
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("database.live", { ...live, maxConnectionsPerUser: 3 }, "Fewer tabs per user"));
});
