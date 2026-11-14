import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { Onboarding } from "../Onboarding";
import { ProductGate } from "../ProductGate";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, setup: vi.fn(), login: vi.fn(), project: vi.fn(), createProject: vi.fn(), startProduct: vi.fn(),
    rulesParseText: vi.fn(), rulesSave: vi.fn(), apps: vi.fn(), twoFactorSetup: vi.fn(), functions: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const products = (started: string[]) => ["database", "storage", "authentication", "functions", "hooks"].map((id) => ({ id, started: started.includes(id) }));

function renderIt(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mock(useSession).mockReturnValue({ state: { initialized: true, capabilities: {} }, user: { role: "Admin" }, refresh: vi.fn() });
  mock(api.project).mockResolvedValue({ setup: true, created: false, id: "winche", name: "winche", products: products([]) });
  mock(api.apps).mockResolvedValue({ setup: { projectId: "clinic-records", name: "Clinic records", baseUrl: "https://api.example.com", services: [], providers: [] }, platforms: [], file: "", snippet: "main()" });
});

test("first run: the account, then the project (every product off), then a skippable app", async () => {
  mock(useSession).mockReturnValue({ state: { initialized: false, capabilities: {} }, user: null, refresh: vi.fn() });
  mock(api.setup).mockResolvedValue({ email: "ann@example.com" });
  mock(api.login).mockResolvedValue({ requiresTwoFactor: false });
  mock(api.twoFactorSetup).mockResolvedValue({ sharedKey: "K", authenticatorUri: "otpauth://totp/x" });
  mock(api.createProject).mockResolvedValue({ setup: true, created: true, id: "clinic-records", name: "Clinic records", products: products(["database", "authentication"]) });
  mock(api.rulesParseText).mockResolvedValue({ ok: true, rulesJson: "{}", error: null, warnings: [] });
  mock(api.rulesSave).mockResolvedValue({});
  renderIt(<Onboarding mode="first-run" />);

  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith("ann@example.com", "correct horse battery"));
  await userEvent.click(await screen.findByText("Do it later"));

  await userEvent.type(await screen.findByLabelText("Project name"), "Clinic records");
  expect(screen.getByLabelText("Project id")).toHaveValue("clinic-records");
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(api.createProject).toHaveBeenCalledWith({ name: "Clinic records", id: "clinic-records", products: [] }));

  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  expect(await screen.findByRole("button", { name: "Go to the console" })).toBeInTheDocument();
});

test("the project can't be skipped", async () => {
  sessionStorage.setItem("winche.onboarding", "project");
  renderIt(<Onboarding mode="first-run" />);
  expect(await screen.findByLabelText("Project name")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Skip/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

test("until the project exists, admins are taken to create it and others wait", async () => {
  const { RequireProject } = await import("../RequireProject");
  const { unmount } = renderIt(<RequireProject><div>CONSOLE</div></RequireProject>);
  expect(await screen.findByText("Name your project")).toBeInTheDocument();
  expect(screen.queryByText("CONSOLE")).not.toBeInTheDocument();
  unmount();
  mock(useSession).mockReturnValue({ state: { initialized: true, capabilities: {} }, user: { role: "Member" }, refresh: vi.fn() });
  renderIt(<RequireProject><div>CONSOLE</div></RequireProject>);
  expect(await screen.findByText("Almost ready")).toBeInTheDocument();
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
});

test("a product not started shows Get started; its wizard checks the server, then starts it", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.startProduct).mockResolvedValue({});
  mock(api.functions).mockResolvedValue({ runtimeProblem: null });
  renderIt(<ProductGate product="functions"><div>FUNCTIONS PAGE</div></ProductGate>);
  expect(await screen.findByTestId("get-started")).toBeInTheDocument();
  expect(screen.queryByText("FUNCTIONS PAGE")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(await screen.findByText("This server can run functions.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start functions" }));
  await waitFor(() => expect(api.startProduct).toHaveBeenCalledWith("functions"));
});

test("the database wizard can start in test mode: rules open for 30 days are published", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.startProduct).mockResolvedValue({});
  mock(api.rulesParseText).mockResolvedValue({ ok: true, rulesJson: "{}", error: null, warnings: [] });
  mock(api.rulesSave).mockResolvedValue({});
  renderIt(<ProductGate product="database"><div>DB</div></ProductGate>);
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.click(await screen.findByText("Test mode"));
  await userEvent.click(screen.getByRole("button", { name: "Start database" }));
  await waitFor(() => expect(api.rulesSave).toHaveBeenCalledWith("database", expect.objectContaining({ note: "Test mode: open for 30 days" })));
  expect(api.startProduct).toHaveBeenCalledWith("database");
  expect(mock(api.rulesParseText).mock.calls[0][0]).toContain("request.time < timestamp(");
});

test("without project setup, product pages show as before", async () => {
  mock(api.project).mockResolvedValue({ setup: false, created: true, id: "c", name: "C", products: products(["database"]) });
  renderIt(<ProductGate product="hooks"><div>HOOKS PAGE</div></ProductGate>);
  expect(await screen.findByText("HOOKS PAGE")).toBeInTheDocument();
});
