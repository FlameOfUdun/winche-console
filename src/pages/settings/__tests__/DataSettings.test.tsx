import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { projectNav } from "../../../layout/nav";
import { DatabaseIndexesView, DatabaseSettingsView } from "../DatabaseSettingsView";
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
      storageMoveStep: vi.fn(), parseIndexText: vi.fn(), rulesFields: vi.fn(),
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

/** The settings card with this title, opened for editing. */
async function editCard(title: string) {
  const card = (await screen.findByRole("heading", { name: title })).closest(".mantine-Paper-root") as HTMLElement;
  await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
  return card;
}

async function saveCard(card: HTMLElement, reason: string) {
  await userEvent.type(within(card).getByLabelText("Reason for the change"), reason);
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
}

const location = (over: object = {}) => ({
  active: null, activeLabel: "On this server's disk", codeLabel: "On this server's disk", kinds: ["s3"], move: null,
  progress: null, editable: true, secretsAvailable: true, ...over,
});

test("the Settings page is listed for admins when the product uses settings", () => {
  const nav = projectNav({ capabilities: { database: true, storage: true, settings: { database: true } } } as never, { role: "Admin" } as never);
  expect(nav.find((n) => n.to === "/database")!.pages.map((p) => p.label)).toContain("Settings");
  expect(nav.find((n) => n.to === "/storage")!.pages).toEqual([]);   // Files only: no pages under it
});

test("indexes and expiry are a text: shown from the settings, then history turned on and saved", async () => {
  mock(api.dataSettings).mockImplementation((a: string) =>
    a === "database.live" ? Promise.reject(Object.assign(new Error("Not Found"), { status: 404 }))
      : Promise.resolve(area(a === "database" ? { ...db, ttl: [{ collection: "sessions", field: "expiresAt" }] } : storage)));
  renderIt(<DatabaseIndexesView />);
  // A table of indexes, and of expiry rules.
  expect(within(await screen.findByTestId("index-row")).getByText("patients")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Expiry (1)"));
  expect(within(screen.getByTestId("ttl-row")).getByText("expiresAt")).toBeInTheDocument();
  // All of it as text, one block per collection.
  await userEvent.click(screen.getByRole("button", { name: "Edit as text" }));
  const editor = await screen.findByRole("textbox", { name: "Indexes and expiry" });
  expect(editor.textContent).toContain("collection patients {");
  expect(editor.textContent).toContain("index (ward)");
  expect(editor.textContent).toContain("expire when expiresAt");
  expect(screen.getByTestId("index-status")).toHaveTextContent("1 index");
  expect(screen.getByTestId("index-status")).toHaveTextContent("1 expiry");
});

test("a settings card shows what's set; Edit, change, and save with a reason", async () => {
  renderIt(<DatabaseSettingsView />);
  const card = await editCard("Document history");
  await userEvent.click(within(card).getByLabelText("Keep document history"));
  await saveCard(card, "Audit trail");
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("database",
    expect.objectContaining({ history: { enabled: true, retentionDays: 30 } }), "Audit trail", expect.any(Number)));
});

test("a slow query's suggested index is added with one click", async () => {
  mock(api.indexSuggestions).mockResolvedValue({ suggestions: [
    { collection: "visits", fields: [{ path: "patientId", direction: "asc" }, { path: "at", direction: "desc" }], kind: "ordered", collectionGroup: false,
      elapsedMs: 840, at: "2026-11-12T20:00:00Z", code: "ib.Add(...)" },
  ] });
  mock(api.parseIndexText).mockResolvedValue({
    ok: true, error: null, ttl: [],
    indexes: [...db.indexes, { collection: "visits", fields: [{ path: "patientId", direction: "asc" }, { path: "at", direction: "desc" }], kind: "ordered", collectionGroup: false }],
  });
  renderIt(<DatabaseIndexesView />);
  const box = await screen.findByTestId("index-suggestions");
  expect(within(box).getByText("visits")).toBeInTheDocument();
  await userEvent.click(within(box).getByRole("button", { name: "Add" }));
  await userEvent.type(await screen.findByLabelText("Why?"), "Visits by patient");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("database", expect.objectContaining({
    indexes: [...db.indexes, { collection: "visits", fields: [{ path: "patientId", direction: "asc" }, { path: "at", direction: "desc" }], kind: "ordered", collectionGroup: false }],
  }), "Visits by patient", expect.any(Number)));
});

test("storage: the size limit and the clean-up change", async () => {
  renderIt(<StorageSettingsView />);
  const uploads = await editCard("Uploads");
  const size = within(uploads).getByLabelText("Largest file");
  await userEvent.clear(size);
  await userEvent.type(size, "5");
  await saveCard(uploads, "Smaller uploads");
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("storage", { ...storage, maxFileSizeMb: 5 }, "Smaller uploads", expect.any(Number)));
  const cleanup = await editCard("Clean-up");
  await userEvent.click(within(cleanup).getByLabelText("Regularly delete stored files no file record points to"));
  await saveCard(cleanup, "Tidy up");
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("storage",
    { ...storage, orphanSweep: { ...storage.orphanSweep, enabled: true } }, "Tidy up", expect.any(Number)));
});

test("moving files: choose an R2 bucket, test it, then start copying with a reason", async () => {
  mock(api.testStorageLocation).mockResolvedValue({ ok: true, steps: [{ name: "Write a file", ok: true, error: null }, { name: "Delete it", ok: true, error: null }] });
  mock(api.startStorageMove).mockResolvedValue({});
  renderIt(<StorageSettingsView />);
  expect(await screen.findByTestId("location-active")).toHaveTextContent("On this server's disk");
  await userEvent.click(screen.getByRole("button", { name: "Move files…" }));
  await userEvent.click(screen.getByText("Cloudflare R2"));
  await userEvent.type(screen.getByLabelText("Bucket"), "clinic-files");
  await userEvent.type(screen.getByLabelText("Service address"), "https://acct.r2.cloudflarestorage.com");
  await userEvent.type(screen.getByLabelText("Access key id"), "AK");
  await userEvent.type(screen.getByLabelText(/Secret access key/), "SK");
  expect(screen.queryByRole("button", { name: "Start copying" })).toBeNull();   // test first
  await userEvent.click(screen.getByRole("button", { name: "Test" }));
  expect(await screen.findByTestId("location-test")).toHaveTextContent("✓ Write a file");
  await userEvent.type(screen.getByLabelText("Reason for the move"), "Off the server's disk");
  await userEvent.click(screen.getByRole("button", { name: "Start copying" }));
  const bucket = { kind: "s3", s3: { bucket: "clinic-files", region: "auto", serviceUrl: "https://acct.r2.cloudflarestorage.com", accessKey: "AK", forcePathStyle: false } };
  expect(mock(api.testStorageLocation)).toHaveBeenCalledWith(bucket, "SK");
  await waitFor(() => expect(mock(api.startStorageMove)).toHaveBeenCalledWith(bucket, "SK", "Off the server's disk"));
});

const move = (phase: string) => ({ id: "m1", phase, startedAt: "2026-11-12T20:00:00Z", fromLabel: "On this server's disk", toLabel: "bucket clinic-files" });

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
  const card = await editCard("Live connections");
  const perUser = within(card).getByLabelText(/Connections per user/);
  await userEvent.clear(perUser);
  await userEvent.type(perUser, "3");
  await saveCard(card, "Fewer tabs per user");
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("database.live", { ...live, maxConnectionsPerUser: 3 }, "Fewer tabs per user", expect.any(Number)));
});

test("a mistake in the text is shown and stops formatting until it's fixed", async () => {
  mock(api.parseIndexText).mockResolvedValue({ ok: false, indexes: null, ttl: null, error: { message: "Expected ',' or ')', found 'b'.", line: 2, column: 12, offset: 30 } });
  mock(api.indexSuggestions).mockResolvedValue({ suggestions: [{ collection: "visits", fields: [{ path: "at", direction: "asc" }], kind: "ordered", collectionGroup: false, elapsedMs: 900, at: "2026-11-14T10:00:00Z", code: "x" }] });
  renderIt(<DatabaseIndexesView />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit as text" }));
  await userEvent.click(await within(await screen.findByTestId("index-suggestions")).findByRole("button", { name: "Add" }));
  expect(await screen.findByText(/Line 2: Expected ',' or '\)'/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
});
