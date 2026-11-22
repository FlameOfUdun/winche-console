import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { Onboarding } from "../Onboarding";
import { ProductGate } from "../ProductGate";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import { keepValue, secretBody } from "../../../api/secrets";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, setup: vi.fn(), login: vi.fn(), project: vi.fn(), createProject: vi.fn(), projects: vi.fn(), checkProjectDatabase: vi.fn(), startProduct: vi.fn(), productSetup: vi.fn(),
    rulesParseText: vi.fn(), rulesSave: vi.fn(), apps: vi.fn(), twoFactorSetup: vi.fn(), functions: vi.fn(),
    checkSetupCode: vi.fn(), createUser: vi.fn(), serverSettings: vi.fn(), saveServerSettings: vi.fn(), setServerSecret: vi.fn(),
    secretSources: vi.fn(), testStorageLocation: vi.fn(), startStorageMove: vi.fn(), storageLocation: vi.fn(), storageMoveStep: vi.fn(), dataSettings: vi.fn(), saveDataSettings: vi.fn(),
    signInSettings: vi.fn(), saveSignInSettings: vi.fn(), appAuthConfig: vi.fn() } };
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
  mock(api.apps).mockResolvedValue({ setup: { projectId: "my-records", name: "My records", baseUrl: "https://api.example.com", services: [], providers: [] }, platforms: [], file: "", snippet: "main()" });
  mock(api.serverSettings).mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));   // a console on its own
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, sources: [], keys: [] });
});

test("first run: the account, then the project (every product off), then a skippable app", async () => {
  mock(useSession).mockReturnValue({ state: { initialized: false, capabilities: {} }, user: null, refresh: vi.fn() });
  mock(api.setup).mockResolvedValue({ email: "ann@example.com" });
  mock(api.login).mockResolvedValue({ requiresTwoFactor: false });
  mock(api.twoFactorSetup).mockResolvedValue({ sharedKey: "K", authenticatorUri: "otpauth://totp/x" });
  mock(api.createProject).mockResolvedValue({ setup: true, created: true, id: "my-records", name: "My records", products: products(["database", "authentication"]) });
  mock(api.rulesParseText).mockResolvedValue({ ok: true, rulesJson: "{}", error: null, warnings: [] });
  mock(api.rulesSave).mockResolvedValue({});
  renderIt(<Onboarding mode="first-run" />);

  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith("ann@example.com", "correct horse battery"));
  await userEvent.click(await screen.findByText("Do it later"));

  await userEvent.type(await screen.findByLabelText("Project name"), "My records");
  expect(screen.getByLabelText("Project id")).toHaveValue("my-records");
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(api.createProject).toHaveBeenCalledWith({ name: "My records", id: "my-records", products: [], database: null }));

  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  expect(await screen.findByRole("button", { name: "Go to the console" })).toBeInTheDocument();
});

test("the server's own console sets up sign-in only, then lands on its projects (no project is made)", async () => {
  mock(useSession).mockReturnValue({ state: { server: true, initialized: false, capabilities: {} }, user: null, refresh: vi.fn() });
  mock(api.setup).mockResolvedValue({ email: "ann@example.com" });
  mock(api.login).mockResolvedValue({ requiresTwoFactor: false });
  mock(api.twoFactorSetup).mockResolvedValue({ sharedKey: "K", authenticatorUri: "otpauth://totp/x" });
  renderIt(
    <Routes>
      <Route path="/" element={<Onboarding mode="first-run" />} />
      <Route path="/projects" element={<p>The projects</p>} />
    </Routes>,
  );
  expect(screen.queryByText("Project")).toBeNull();   // no project part in its steps
  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  await userEvent.click(await screen.findByText("Do it later"));
  expect(await screen.findByText("The projects")).toBeInTheDocument();
  expect(api.createProject).not.toHaveBeenCalled();
  expect(api.project).not.toHaveBeenCalled();
});

test("a server asks for the setup code first; the admin account is made with it", async () => {
  mock(useSession).mockReturnValue({ state: { initialized: false, capabilities: {}, setup: { code: true } }, user: null, refresh: vi.fn() });
  mock(api.checkSetupCode).mockRejectedValueOnce(new Error("That isn't the setup code.")).mockResolvedValue(undefined);
  mock(api.setup).mockResolvedValue({ email: "ann@example.com" });
  mock(api.login).mockResolvedValue({ requiresTwoFactor: false });
  mock(api.twoFactorSetup).mockResolvedValue({ sharedKey: "K", authenticatorUri: "otpauth://totp/x" });
  renderIt(<Onboarding mode="first-run" />);

  await userEvent.type(screen.getByLabelText("Setup code"), "nope");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByText(/isn't the setup code/)).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Setup code"));
  await userEvent.type(screen.getByLabelText("Setup code"), "K7QF-2MXP-9TWD");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));

  await userEvent.type(await screen.findByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(api.setup).toHaveBeenCalledWith(expect.objectContaining({ email: "ann@example.com", setupCode: "K7QF-2MXP-9TWD" })));
});

const serverPage = {
  settings: { publicUrl: "https://w.example.com", corsOrigins: [], requireTwoFactorForSettings: true, consoleSessionHours: 168, consoleProviders: [],
    consolePasswordsOnlyForAdmins: false,
    consoleEmail: { host: null, port: 587, security: "startTls", username: null, fromAddress: "", fromName: null } },
  deployment: {}, source: "deployment", version: null, secrets: [],
  consoleSignIn: { callbackUrl: "https://w.example.com/console/v1/session/oidc/callback", logoutUrl: "https://w.example.com/console/v1/session/oidc/backchannel-logout" },
};

test("after two-step sign-in: the team's identity provider, optional, saved with its secret", async () => {
  sessionStorage.setItem("winche.onboarding", "providers");
  mock(api.serverSettings).mockResolvedValue(serverPage);
  mock(api.saveServerSettings).mockResolvedValue({});
  mock(api.setServerSecret).mockResolvedValue(undefined);
  renderIt(<Onboarding mode="first-run" />);

  expect(await screen.findByText("Add your company sign-in?")).toBeInTheDocument();
  expect(await screen.findByText("https://w.example.com/console/v1/session/oidc/callback")).toBeInTheDocument();
  expect(screen.getByText("https://w.example.com/console/v1/session/oidc/backchannel-logout")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Issuer"), "https://login.example.com/realms/staff");
  await userEvent.type(screen.getByLabelText("Client ID"), "winche-console");
  await userEvent.type(screen.getByLabelText("Button"), "Sign in with Staff ID");
  await userEvent.type(screen.getByLabelText("Client secret"), "s3cret");
  await userEvent.click(screen.getByRole("button", { name: "Add provider" }));
  await waitFor(() => expect(api.saveServerSettings).toHaveBeenCalledWith(expect.objectContaining({
    consoleProviders: [expect.objectContaining({ id: "staff-id", issuer: "https://login.example.com/realms/staff", clientId: "winche-console", enabled: true })],
  }), "Set up with the server"));
  expect(api.setServerSecret).toHaveBeenCalledWith("server.consoleSignIn.staff-id.clientSecret", "s3cret");
  expect(await screen.findByLabelText("Project name")).toBeInTheDocument();
});

test("first-run identity provider: a client secret reference that isn't one keeps Add provider off", async () => {
  sessionStorage.setItem("winche.onboarding", "providers");
  mock(api.serverSettings).mockResolvedValue(serverPage);
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, keys: [], sources: [{ name: "aws-sm", title: "AWS Secrets Manager", hint: "" }] });
  renderIt(<Onboarding mode="first-run" />);
  await userEvent.type(await screen.findByLabelText("Issuer"), "https://login.example.com/realms/staff");
  await userEvent.type(screen.getByLabelText("Client ID"), "winche-console");
  expect(screen.getByRole("button", { name: "Add provider" })).toBeEnabled();
  await userEvent.click(await screen.findByText("Reference"));
  await userEvent.type(screen.getByLabelText("Client secret (reference)"), "not-a-reference");
  expect(screen.getByRole("button", { name: "Add provider" })).toBeDisabled();
  expect(api.saveServerSettings).not.toHaveBeenCalled();
});

test("the identity provider can be skipped", async () => {
  sessionStorage.setItem("winche.onboarding", "providers");
  mock(api.serverSettings).mockResolvedValue(serverPage);
  renderIt(<Onboarding mode="first-run" />);
  await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  expect(await screen.findByLabelText("Project name")).toBeInTheDocument();
  expect(api.saveServerSettings).not.toHaveBeenCalled();
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

test("signed in but refused here (no role yet): says so instead of loading forever", async () => {
  const { RequireProject } = await import("../RequireProject");
  const { ApiError } = await import("../../../api/client");
  mock(useSession).mockReturnValue({ state: { initialized: true, capabilities: {} }, user: { email: "bob@example.com", role: null }, refresh: vi.fn() });
  mock(api.project).mockRejectedValue(new ApiError(403, "Forbidden"));
  renderIt(<RequireProject><div>CONSOLE</div></RequireProject>);
  expect(await screen.findByText("You're not in this project")).toBeInTheDocument();
  expect(screen.queryByText("CONSOLE")).not.toBeInTheDocument();
});

test("a product not started shows Get started; its wizard checks the server, then starts it", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.startProduct).mockResolvedValue({ product: "x", state: "running", steps: [{ title: "Create the tables", state: "running" }], startedAt: "", finishedAt: null });
  mock(api.productSetup).mockResolvedValue({ product: "x", state: "done", steps: [{ title: "Create the tables", state: "done" }], startedAt: "", finishedAt: "" });
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
  mock(api.startProduct).mockResolvedValue({ product: "x", state: "running", steps: [{ title: "Create the tables", state: "running" }], startedAt: "", finishedAt: null });
  mock(api.productSetup).mockResolvedValue({ product: "x", state: "done", steps: [{ title: "Create the tables", state: "done" }], startedAt: "", finishedAt: "" });
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
  renderIt(<ProductGate product="storage"><div>STORAGE PAGE</div></ProductGate>);
  expect(await screen.findByText("STORAGE PAGE")).toBeInTheDocument();
});

test("starting a product follows its setup on the server; a failed step says why, with Retry", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.startProduct).mockResolvedValue({ product: "storage", state: "running", steps: [{ title: "Create the file tables", state: "running" }], startedAt: "", finishedAt: null });
  mock(api.productSetup).mockResolvedValue({ product: "storage", state: "failed", steps: [{ title: "Create the file tables", state: "failed", error: "permission denied for schema public" }], startedAt: "", finishedAt: "" });
  renderIt(<ProductGate product="storage"><div>STORAGE PAGE</div></ProductGate>);
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  for (let i = 0; i < 5 && !screen.queryByRole("button", { name: "Start storage" }); i++)
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Start storage" }));
  expect(await screen.findByText("Create the file tables didn't work")).toBeInTheDocument();
  expect(screen.getByText("permission denied for schema public")).toBeInTheDocument();
  mock(api.productSetup).mockResolvedValue({ product: "storage", state: "done", steps: [{ title: "Create the file tables", state: "done" }], startedAt: "", finishedAt: "" });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.startProduct).toHaveBeenCalledTimes(2));
});

test("storage in a bucket: the secret key can be kept in AWS like everywhere else, and the server's warning is shown", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, keys: [],
    sources: [{ name: "aws-sm", title: "AWS Secrets Manager", hint: "", key: null, access: { read: true, write: true, delete: true, missing: [], problem: null } }] });
  mock(api.dataSettings).mockResolvedValue({ settings: { maxFileSizeMb: 25 } });
  mock(api.saveDataSettings).mockResolvedValue({});
  mock(api.testStorageLocation).mockResolvedValue({ ok: true, steps: [] });
  mock(api.startStorageMove).mockResolvedValue({ warning: "The secret key couldn't be kept in AWS, so it's kept on this server." });
  mock(api.storageLocation).mockResolvedValue({ move: { phase: "ready" } });
  mock(api.storageMoveStep).mockResolvedValue(undefined);
  mock(api.startProduct).mockResolvedValue({ product: "storage", state: "done", steps: [{ title: "Create the file tables", state: "done" }], startedAt: "", finishedAt: "" });
  mock(api.productSetup).mockResolvedValue({ product: "storage", state: "done", steps: [{ title: "Create the file tables", state: "done" }], startedAt: "", finishedAt: "" });
  renderIt(<ProductGate product="storage"><div>STORAGE PAGE</div></ProductGate>);
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.click(await screen.findByText("A bucket"));
  await userEvent.type(screen.getByLabelText("Bucket"), "my-files");
  await userEvent.click(await screen.findByText("In AWS"));
  await userEvent.type(screen.getByLabelText("Secret key"), "  SK  ");
  await userEvent.click(screen.getByRole("button", { name: "Test the bucket" }));
  expect(await screen.findByText("It works.")).toBeInTheDocument();
  const kept = mock(api.testStorageLocation).mock.calls[0][1] as string;
  expect(secretBody(kept)).toEqual({ value: "SK", reference: "keep:aws-sm" });   // trimmed when sent
  for (let i = 0; i < 5 && !screen.queryByRole("button", { name: "Start storage" }); i++)
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByRole("button", { name: "Start storage" }));
  expect(await screen.findByTestId("move-warning", {}, { timeout: 3000 })).toHaveTextContent("couldn't be kept in AWS");
  expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  // The move is started with the same In AWS value: its store and the key, not a plain value.
  const [where, key, why] = mock(api.startStorageMove).mock.calls[0];
  expect(where).toEqual(expect.objectContaining({ kind: "s3", s3: expect.objectContaining({ bucket: "my-files" }) }));
  expect(key).toBe(keepValue("aws-sm", "  SK  "));
  expect(why).toBe("Setup: files kept in a bucket");
});

test("the authentication wizard: an SMTP password reference that isn't one keeps Continue off, so nothing is started", async () => {
  mock(api.project).mockResolvedValue({ setup: true, created: true, id: "c", name: "C", products: products([]) });
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, keys: [], sources: [{ name: "aws-sm", title: "AWS Secrets Manager", hint: "" }] });
  mock(api.appAuthConfig).mockResolvedValue({ serverEmail: null });
  mock(api.signInSettings).mockResolvedValue({ available: true, settings: {
    emailPassword: { enabled: true, minLength: 10, requireVerifiedEmail: false }, anonymous: false, emailLink: { enabled: false, linkUrl: "" },
    twoStep: { enabled: false }, email: { enabled: false, sender: "logLinks", smtp: null } } });
  renderIt(<ProductGate product="authentication"><div>AUTH PAGE</div></ProductGate>);
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await userEvent.click(await screen.findByText("Send with SMTP"));
  await userEvent.click(await screen.findByText("Reference"));
  await userEvent.type(screen.getByLabelText("Password (reference)"), "not-a-reference");
  expect(screen.getByText("Not a reference")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(api.startProduct).not.toHaveBeenCalled();
});
