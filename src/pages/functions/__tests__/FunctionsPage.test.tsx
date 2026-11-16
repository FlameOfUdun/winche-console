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
      ...actual.api, functions: vi.fn(), functionVersions: vi.fn(), rollBackFunctions: vi.fn(), runFunction: vi.fn(),
      functionSecrets: vi.fn(), setFunctionSecret: vi.fn(), removeFunctionSecret: vi.fn(),
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

test("the page shows what's live and how to deploy from the CLI; there's no editor", async () => {
  mock(api.functions).mockResolvedValue(page({ current: null, files: [] }));
  renderPage();
  expect(await screen.findByText("No functions yet")).toBeInTheDocument();
  expect(screen.getByText(/winche functions deploy/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Code of/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "VS Code" })).not.toBeInTheDocument();
});

test("a callable runs from the page with its result and logs", async () => {
  mock(api.runFunction).mockResolvedValue({ ok: true, result: { greeting: "Hello Ann" }, error: null, durationMs: 12, logs: [{ level: "log", message: "Saying hello", at: "" }] });
  renderPage();
  const fn = (await screen.findAllByTestId("function"))[0];
  expect(within(fn).getByText("hello")).toBeInTheDocument();
  await userEvent.click(within(fn).getByRole("button", { name: "Run" }));
  const data = within(fn).getByLabelText("Data (JSON)");
  await userEvent.clear(data);
  await userEvent.type(data, '{{"name":"Ann"}');
  await userEvent.type(within(fn).getByLabelText("As user (optional)"), "u1");
  await userEvent.click(within(fn).getAllByRole("button", { name: "Run" }).at(-1)!);
  const result = await within(fn).findByTestId("run-result");
  expect(result).toHaveTextContent("Returned in 12 ms");
  expect(result).toHaveTextContent("Hello Ann");
  expect(result).toHaveTextContent("Saying hello");
  expect(mock(api.runFunction)).toHaveBeenCalledWith("hello", { name: "Ann" }, "u1");
  expect(screen.queryAllByTestId("function")[1]).not.toHaveTextContent("Run");   // only callables run from here
});

test("versions: roll back an older one", async () => {
  mock(api.rollBackFunctions).mockResolvedValue({ ...v1, version: 3 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Versions" }));
  const rows = await screen.findAllByTestId("function-version");
  expect(within(rows[0]).getByText("Live")).toBeInTheDocument();
  await userEvent.click(within(rows[1]).getByRole("button", { name: "Roll back" }));
  await waitFor(() => expect(mock(api.rollBackFunctions)).toHaveBeenCalledWith(1, null));
});

test("secrets: listed without values, set, replaced and removed", async () => {
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "MAIL_KEY", isSet: false, setAt: null, setBy: null, usedBy: ["sendReport"] },
    { name: "OLD_TOKEN", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: "admin@example.com", usedBy: [] },
  ] });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  mock(api.removeFunctionSecret).mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Secrets" }));
  const rows = await screen.findAllByTestId("function-secret");
  expect(rows[0]).toHaveTextContent("Not set");
  expect(rows[0]).toHaveTextContent("used by sendReport");
  expect(rows[1]).toHaveTextContent("no function declares it");

  await userEvent.click(within(rows[0]).getByRole("button", { name: "Set" }));
  await userEvent.type(within(rows[0]).getByLabelText("New value of MAIL_KEY"), "k-123");
  await userEvent.click(within(rows[0]).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("MAIL_KEY", "k-123"));

  await userEvent.click(within(rows[1]).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(mock(api.removeFunctionSecret)).toHaveBeenCalledWith("OLD_TOKEN"));

  await userEvent.click(screen.getByRole("button", { name: "Add a secret" }));
  await userEvent.type(screen.getByLabelText("Name"), "bad-name");
  expect(screen.getByText(/Capitals, digits and underscores/)).toBeInTheDocument();
});
