import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { FunctionsPage } from "../FunctionsPage";
import { api } from "../../../api/client";
import { STARTER, type FunctionsPageData, type FunctionVersion } from "../../../api/functions";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: { ...actual.api, functions: vi.fn(), functionVersions: vi.fn(), functionVersion: vi.fn(), deployFunctions: vi.fn(), rollBackFunctions: vi.fn(), runFunction: vi.fn(), newDeployKey: vi.fn() },
  };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const v1: FunctionVersion = {
  version: 1, note: "First", by: "admin@trucorp.com", at: "2026-11-12T20:00:00Z", rolledBackFrom: null,
  functions: [
    { name: "hello", kind: "callable", events: null, path: null, cron: null, timeZone: null, description: "called by apps", timeoutSeconds: 60 },
    { name: "onVisit", kind: "documents", events: ["created"], path: "patients/{patientId}", cron: null, timeZone: null, description: "documents created at patients/{patientId}", timeoutSeconds: 60 },
  ],
};
const page = (over: Partial<FunctionsPageData> = {}): FunctionsPageData => ({
  current: v1, files: { "index.ts": "export const hello = 1;" }, runtimeProblem: null, deployKey: null, secretsAvailable: true, ...over,
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

test("a first project starts from the example, and deploying needs a note", async () => {
  mock(api.functions).mockResolvedValueOnce(page({ current: null, files: {} })).mockResolvedValue(page({ files: STARTER }));
  mock(api.deployFunctions).mockResolvedValue({ ...v1, version: 1 });
  renderPage();
  expect(await screen.findByText("Nothing deployed yet.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("What changed"), "First functions");
  await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
  await waitFor(() => expect(mock(api.deployFunctions)).toHaveBeenCalledWith(STARTER, "First functions"));
  expect(await screen.findByText("Version 1 is live: hello, onVisit.")).toBeInTheDocument();
});

test("files can be added, and build problems are shown", async () => {
  mock(api.deployFunctions).mockRejectedValue(new Error(JSON.stringify({ error: { message: "The code doesn't build.", errors: ["index.ts:1: Expected ';'"] } })));
  renderPage();
  await userEvent.type(await screen.findByLabelText("New file"), "lib/greet.ts");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await userEvent.type(screen.getByLabelText("What changed"), "Split");
  await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
  expect(await screen.findByText(/Expected ';'/)).toBeInTheDocument();
  expect(mock(api.deployFunctions).mock.calls[0][0]).toEqual({ "index.ts": "export const hello = 1;", "lib/greet.ts": "" });
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

test("versions: roll back an older one; the deploy key is shown once", async () => {
  mock(api.rollBackFunctions).mockResolvedValue({ ...v1, version: 3 });
  mock(api.newDeployKey).mockResolvedValue({ key: "wfd_secret" });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await userEvent.click(await screen.findByRole("tab", { name: "Versions" }));
  const rows = await screen.findAllByTestId("function-version");
  expect(within(rows[0]).getByText("Live")).toBeInTheDocument();
  await userEvent.click(within(rows[1]).getByRole("button", { name: "Roll back" }));
  await waitFor(() => expect(mock(api.rollBackFunctions)).toHaveBeenCalledWith(1, null));
  await userEvent.click(screen.getByRole("tab", { name: "VS Code" }));
  await userEvent.click(await screen.findByRole("button", { name: "Make a deploy key" }));
  expect(await screen.findByTestId("deploy-key")).toHaveTextContent("wfd_secret");
});
