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
    rulesParseText: vi.fn(), rulesSave: vi.fn(), apps: vi.fn(), twoFactorSetup: vi.fn() } };
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

test("first run: the account, then the project with its products (test mode rules published), then a skippable app", async () => {
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
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByText("Test mode (30 days)"));   // the database's rules
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(api.createProject).toHaveBeenCalledWith({ name: "Clinic records", id: "clinic-records", products: ["database", "authentication"] }));
  expect(mock(api.rulesParseText).mock.calls[0][0]).toContain("request.time < timestamp(");
  expect(api.rulesSave).toHaveBeenCalledWith("database", expect.objectContaining({ note: "Test mode: open for 30 days" }));

  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  expect(await screen.findByRole("button", { name: "Go to the console" })).toBeInTheDocument();
});

test("the project step can be skipped: it's created later", async () => {
  sessionStorage.setItem("winche.onboarding", "project");
  renderIt(<Onboarding mode="first-run" />);
  await userEvent.click(await screen.findByRole("button", { name: "Skip: create it later" }));
  expect(api.createProject).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("winche.onboarding")).toBeNull();
});

test("a product not started shows Get started, and starting it calls the server", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.startProduct).mockResolvedValue({});
  renderIt(<ProductGate product="functions"><div>FUNCTIONS PAGE</div></ProductGate>);
  expect(await screen.findByTestId("get-started")).toBeInTheDocument();
  expect(screen.queryByText("FUNCTIONS PAGE")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start functions" }));
  await waitFor(() => expect(api.startProduct).toHaveBeenCalledWith("functions"));
});

test("without project setup, product pages show as before", async () => {
  mock(api.project).mockResolvedValue({ setup: false, created: true, id: "c", name: "C", products: products(["database"]) });
  renderIt(<ProductGate product="hooks"><div>HOOKS PAGE</div></ProductGate>);
  expect(await screen.findByText("HOOKS PAGE")).toBeInTheDocument();
});
