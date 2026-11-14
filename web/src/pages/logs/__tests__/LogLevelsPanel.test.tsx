import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { LogLevelsPanel } from "../LogLevelsPanel";
import { api } from "../../../api/client";
import type { LogLevels } from "../../../api/logs";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, logLevels: vi.fn(), saveLogLevels: vi.fn(), resetLogLevels: vi.fn() } };
});

const levels = (over: Partial<LogLevels> = {}): LogLevels => ({
  defaultLevel: "Warning", overrides: [], source: "code", updatedAt: null, updatedBy: null, codeDefaultLevel: "Warning", ...over,
});

function renderPanel(scope: "app" | "database" = "app") {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <LogLevelsPanel scope={scope} categories={["SmartAirway.Reports.ReportEmailService", "Winche.Database.Runtime.Listening"]} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.saveLogLevels as ReturnType<typeof vi.fn>).mockResolvedValue({ updatedAt: "", updatedBy: "admin" });
});

test("adds a time-limited source level and saves it", async () => {
  (api.logLevels as ReturnType<typeof vi.fn>).mockResolvedValue(levels());
  renderPanel();
  expect(await screen.findByText(/Set in the app's code \(default Warning\)/)).toBeInTheDocument();
  expect(screen.getByText(/None — every source uses the default/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Add a source" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Source"), "SmartAirway.Reports");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  const before = Date.now();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(api.saveLogLevels).toHaveBeenCalled());
  const [defaultLevel, overrides] = (api.saveLogLevels as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(defaultLevel).toBe("Warning");
  expect(overrides).toHaveLength(1);
  expect(overrides[0].category).toBe("SmartAirway.Reports");
  expect(overrides[0].level).toBe("Debug");
  const until = Date.parse(overrides[0].until);
  expect(until - before).toBeGreaterThan(59 * 60_000);   // "for 1 hour" by default
  expect(until - before).toBeLessThan(61 * 60_000);
});

test("a sub-tab shows and edits only its library's overrides, keeping the rest", async () => {
  (api.logLevels as ReturnType<typeof vi.fn>).mockResolvedValue(levels({
    source: "console", updatedBy: "admin@example.com", updatedAt: "2026-11-12T14:00:00Z",
    overrides: [
      { category: "SmartAirway.Reports", level: "Debug", until: null },
      { category: "Winche.Database.Runtime", level: "Information", until: "2026-11-12T16:00:00Z" },
    ],
  }));
  renderPanel("database");
  expect(await screen.findByText(/Set in the console by admin@example.com/)).toBeInTheDocument();
  expect(screen.getAllByTestId("level-override")).toHaveLength(1);
  expect(screen.getByDisplayValue("Winche.Database.Runtime")).toBeInTheDocument();
  expect(screen.queryByDisplayValue("SmartAirway.Reports")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Remove override" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveLogLevels).toHaveBeenCalledWith("Warning", [{ category: "SmartAirway.Reports", level: "Debug", until: null }]));

  await userEvent.click(screen.getByRole("button", { name: "Reset to the app's settings" }));
  expect(api.resetLogLevels).toHaveBeenCalled();
});

test("errors from the server are shown", async () => {
  (api.logLevels as ReturnType<typeof vi.fn>).mockResolvedValue(levels());
  const { ApiError } = await import("../../../api/client");
  (api.saveLogLevels as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, JSON.stringify({ errors: ["An override needs a source."] })));
  renderPanel();
  await screen.findByText(/Set in the app's code/);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("An override needs a source.")).toBeInTheDocument();
});
