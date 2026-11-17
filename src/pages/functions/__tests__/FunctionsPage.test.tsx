import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { FunctionsPage } from "../FunctionsPage";
import { api } from "../../../api/client";
import type { FunctionsPageData, FunctionVersion } from "../../../api/functions";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, functions: vi.fn(), functionVersions: vi.fn(), functionInstances: vi.fn(), rollBackFunctions: vi.fn(), runFunction: vi.fn(),
      dataSettings: vi.fn(), saveDataSettings: vi.fn(), dataSettingsHistory: vi.fn(),
    },
  };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const v1: FunctionVersion = {
  version: 1, note: "First", by: "admin@example.com", at: "2026-11-12T20:00:00Z", rolledBackFrom: null,
  functions: [
    { name: "hello", kind: "callable", events: null, path: null, cron: null, timeZone: null, description: "called by apps", timeoutSeconds: 60 },
    { name: "onVisit", kind: "documents", events: ["created"], path: "patients/{patientId}", cron: null, timeZone: null, description: "documents created at patients/{patientId}", timeoutSeconds: 60 },
  ],
};
const page = (over: Partial<FunctionsPageData> = {}): FunctionsPageData => ({
  current: v1, files: ["index.ts"], runtimeProblem: null, ...over,
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><FunctionsPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.functions).mockResolvedValue(page());
  mock(api.functionVersions).mockResolvedValue({ versions: [{ ...v1, version: 2, note: "Second" }, v1] });
});

test("the page shows what's live as cards; there's no editor and no deploy guide", async () => {
  mock(api.functions).mockResolvedValue(page({ current: null, files: [] }));
  renderPage();
  expect(await screen.findByText("No functions yet")).toBeInTheDocument();
  expect(screen.queryByText(/winche functions deploy/)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Code of/ })).not.toBeInTheDocument();
});

test("a callable opens in a dialog and runs from there with its result and logs", async () => {
  mock(api.runFunction).mockResolvedValue({ ok: true, result: { greeting: "Hello Ann" }, error: null, durationMs: 12, logs: [{ level: "log", message: "Saying hello", at: "" }] });
  renderPage();
  const cards = await screen.findAllByTestId("function");
  expect(cards[0]).toHaveTextContent("hello");
  expect(cards[0]).toHaveTextContent("called by apps");
  await userEvent.click(cards[0]);
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("tab", { name: "Run" }));
  const data = within(dialog).getByLabelText("Data (JSON)");
  await userEvent.clear(data);
  await userEvent.type(data, '{{"name":"Ann"}');
  await userEvent.type(within(dialog).getByLabelText("As user (optional)"), "u1");
  await userEvent.click(within(dialog).getByRole("button", { name: "Run" }));
  const result = await within(dialog).findByTestId("run-result");
  expect(result).toHaveTextContent("Returned in 12 ms");
  expect(result).toHaveTextContent("Hello Ann");
  expect(result).toHaveTextContent("Saying hello");
  expect(mock(api.runFunction)).toHaveBeenCalledWith("hello", { name: "Ann" }, "u1");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(cards[1]);
  expect(within(await screen.findByRole("dialog")).queryByRole("tab", { name: "Run" })).not.toBeInTheDocument();   // only callables run
});

test("a function's card says what it does; its dialog shows its shapes and starts a run from its example", async () => {
  mock(api.functions).mockResolvedValue(page({ current: { ...v1, functions: [{
    ...v1.functions[0], about: "A language's strings.", secrets: ["MAIL_KEY"],
    input: { type: "object", properties: { lang: { enum: ["de", "en"] } } }, output: { type: "object" }, example: { lang: "de" },
  }] } }));
  mock(api.runFunction).mockResolvedValue({ ok: true, result: {}, error: null, durationMs: 3, logs: [] });
  renderPage();
  const card = (await screen.findAllByTestId("function"))[0];
  expect(within(card).getByTestId("function-about")).toHaveTextContent("A language's strings.");
  await userEvent.click(card);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByTestId("function-shapes")).toHaveTextContent('"enum"');
  expect(dialog).toHaveTextContent("MAIL_KEY");
  await userEvent.click(within(dialog).getByRole("tab", { name: "Run" }));
  expect((within(dialog).getByLabelText("Data (JSON)") as HTMLTextAreaElement).value).toBe('{\n  "lang": "de"\n}');
  await userEvent.click(within(dialog).getByRole("button", { name: "Run" }));
  await waitFor(() => expect(mock(api.runFunction)).toHaveBeenCalledWith("hello", { lang: "de" }, null));
});

test("Settings → Change history: a panel with each deploy and what it changed; rolling back asks in a dialog", async () => {
  mock(api.functionVersions).mockResolvedValue({ versions: [
    { ...v1, version: 2, note: "Second", functions: [v1.functions[0], { ...v1.functions[1], name: "onReport" }] }, v1,
  ] });
  mock(api.rollBackFunctions).mockResolvedValue({ ...v1, version: 3 });
  renderPage();
  mock(api.dataSettingsHistory).mockResolvedValue({ versions: [] });
  mock(api.dataSettings).mockResolvedValue({ settings: { defaultTimeoutSeconds: 60, timeouts: {} }, codeDefault: { defaultTimeoutSeconds: 60, timeouts: {} },
    source: "code", version: null, editable: true, whyReadOnly: null });
  await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("button", { name: "Change history" }));
  expect(await screen.findByText("Deploys")).toBeInTheDocument();
  const rows = await screen.findAllByTestId("function-version");
  expect(within(rows[0]).getByText("Live")).toBeInTheDocument();
  expect(rows[0]).toHaveTextContent("Added");
  expect(rows[0]).toHaveTextContent("onReport");
  expect(rows[0]).toHaveTextContent("Removed");
  expect(rows[0]).toHaveTextContent("onVisit");
  await userEvent.click(within(rows[1]).getByRole("button", { name: "Roll back" }));
  const dialog = await screen.findByRole("dialog", { name: /Roll back to version 1/ });
  await userEvent.type(within(dialog).getByLabelText("Note (optional)"), "Undo");
  await userEvent.click(within(dialog).getByRole("button", { name: "Roll back" }));
  await waitFor(() => expect(mock(api.rollBackFunctions)).toHaveBeenCalledWith(1, "Undo"));
});

test("a function's own run time is set in its dialog; the Settings tab keeps the default", async () => {
  mock(api.functions).mockResolvedValue(page({ maxTimeoutSeconds: 1800, current: { ...v1, functions: [
    { ...v1.functions[0], timeoutSeconds: 60, codeTimeoutSeconds: null },
    { ...v1.functions[1], name: "backfill", kind: "schedule", timeoutSeconds: 480, codeTimeoutSeconds: 480 },
  ] } }));
  mock(api.dataSettings).mockResolvedValue({ settings: { defaultTimeoutSeconds: 60, timeouts: {} }, codeDefault: { defaultTimeoutSeconds: 60, timeouts: {} },
    source: "code", version: null, editable: true, whyReadOnly: null });
  mock(api.saveDataSettings).mockResolvedValue({ number: 1 });
  renderPage();
  await userEvent.click((await screen.findAllByTestId("function"))[1]);
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("tab", { name: "Settings" }));
  expect(await within(dialog).findByText(/In force:/)).toHaveTextContent("8 min (its code's)");
  await userEvent.type(within(dialog).getByLabelText("Run time"), "1500");
  expect(within(dialog).getByText(/In force:/)).toHaveTextContent("25 min");
  await userEvent.type(within(dialog).getByLabelText("Reason for the change"), "Longer backfill");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("functions", { defaultTimeoutSeconds: 60, timeouts: { backfill: 1500 }, limits: {} }, "Longer backfill", 0));

  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByText(/This server allows 30 min at most/)).toBeInTheDocument();
  const input = screen.getByLabelText("Default run time");
  await userEvent.clear(input);
  await userEvent.type(input, "120");
  await userEvent.type(screen.getByLabelText("Reason for the change"), "Slower API");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenLastCalledWith("functions", { defaultTimeoutSeconds: 120, timeouts: {}, defaultMemoryMb: 256, defaultMaxInstances: 10 }, "Slower API", 0));
});

test("a function's instances: memory, how many, its own process, over its code's, with where each comes from", async () => {
  mock(api.functions).mockResolvedValue(page({ maxTimeoutSeconds: 540, maxMemoryMb: 1024, maxConcurrency: 16, current: { ...v1, functions: [
    { ...v1.functions[0], name: "report", timeoutSeconds: 60, codeTimeoutSeconds: null,
      limits: { memoryMb: 768, minInstances: 1, maxInstances: 3, reservedInstances: 0, isolate: true,
        from: { memoryMb: "code", minInstances: "default", maxInstances: "code", reservedInstances: "default", isolate: "code" } },
      codeLimits: { memoryMb: 768, maxInstances: 3, isolate: true } },
  ] } }));
  mock(api.dataSettings).mockResolvedValue({ settings: { defaultTimeoutSeconds: 60, timeouts: {}, limits: { other: { memoryMb: 128 } } },
    codeDefault: { defaultTimeoutSeconds: 60, timeouts: {} }, source: "code", version: { number: 4 }, editable: true, whyReadOnly: null });
  mock(api.saveDataSettings).mockResolvedValue({ number: 5 });
  renderPage();
  await userEvent.click((await screen.findAllByTestId("function"))[0]);
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("tab", { name: "Settings" }));
  const memory = await within(dialog).findByLabelText("Memory");
  expect(memory).toHaveAttribute("placeholder", "768 MB (its code)");
  expect(within(dialog).getByLabelText("Kept loaded")).toHaveAttribute("placeholder", "1 (the default)");
  await userEvent.type(memory, "512");
  await userEvent.type(within(dialog).getByLabelText("Reserved"), "2");
  await userEvent.click(within(dialog).getByRole("textbox", { name: "Process" }));
  await userEvent.click(await screen.findByRole("option", { name: "The shared process" }));
  await userEvent.type(within(dialog).getByLabelText("Reason for the change"), "Smaller, shared");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveDataSettings)).toHaveBeenCalledWith("functions", {
    defaultTimeoutSeconds: 60, timeouts: {},
    limits: { other: { memoryMb: 128 }, report: { memoryMb: 512, reservedInstances: 2, isolate: false } },
  }, "Smaller, shared", 4));
});

test("a function's instances: busy and idle with their heap, its process, and what happened to them", async () => {
  mock(api.functions).mockResolvedValue(page({ current: { ...v1, functions: [{ ...v1.functions[0], name: "report" }] } }));
  mock(api.functionInstances).mockResolvedValue({
    server: "task-1", refused: true, budget: { totalMb: 2400, usedMb: 2300 },
    limits: { memoryMb: 256, minInstances: 1, maxInstances: 4, reservedInstances: 0, isolate: true },
    process: { own: false, running: true, pid: 33, heapMb: 1024, startedAt: new Date(Date.now() - 600_000).toISOString(), restarts: 2 },
    instances: [
      { state: "busy", heapMb: 240, runs: 12, ageSeconds: 300, busySeconds: 4 },
      { state: "idle", heapMb: 31, runs: 3, ageSeconds: 90, busySeconds: null },
    ],
    events: [{ at: new Date().toISOString(), kind: "memory", message: "Instance replaced: holding 312 MB after a run, over its 256 MB." }],
  });
  renderPage();
  await userEvent.click((await screen.findAllByTestId("function"))[0]);
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("tab", { name: "Instances" }));
  const summary = await within(dialog).findByTestId("instances-summary");
  expect(summary).toHaveTextContent("Busy1 of 4 at most");
  expect(summary).toHaveTextContent("Idle1 (1 kept loaded)");
  expect(summary).toHaveTextContent("Shared · up 10 min · started again 2×");
  expect(within(dialog).getByText(/asks for a process of its own but runs in the shared one/)).toHaveTextContent("2300 of 2400 MB");
  const rows = within(within(dialog).getByTestId("instances")).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("busy 4 s240 MB125 min");
  expect(within(dialog).getByTestId("instance-events")).toHaveTextContent("Over its memoryInstance replaced: holding 312 MB");
  expect(within(dialog).getByText(/On server task-1/)).toBeInTheDocument();
});
