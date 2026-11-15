import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ServerSettingsPage } from "./ServerSettingsPage";
import { api, serverAuthApi } from "../../api/client";
import { type ServerSettings } from "../../api/server";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return {
    ...actual,
    api: { ...actual.api, serverSettings: vi.fn(), saveServerSettings: vi.fn(), serverSettingsHistory: vi.fn(), setServerSecret: vi.fn(), testConsoleSignIn: vi.fn(), updateUser: vi.fn() },
    // The console accounts' Winche Auth (Server settings → Authentication).
    serverAuthApi: { ...actual.serverAuthApi, signInSettings: vi.fn(), saveSignInSettings: vi.fn(), appUsers: vi.fn(), appUser: vi.fn(), appAuthConfig: vi.fn(), settingsHistory: vi.fn() },
  };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const deployment: ServerSettings = {
  publicUrl: "https://api.example.com", requireTwoFactorForSettings: true, consoleProviders: [], consolePasswordsOnlyForAdmins: false,
};
const accountsSignIn = {
  emailPassword: { enabled: true, minLength: 8, requireVerifiedEmail: false }, anonymous: false, emailLink: { enabled: false, linkUrl: "" },
  twoStep: { enabled: true, issuer: "Winche console", recoveryCodes: 10 }, providers: [],
  sessions: { accessTokenMinutes: 15, refreshTokenDays: 60 }, lockout: { maxFailedSignIns: 5, lockoutMinutes: 15 },
  email: { enabled: true, appName: "Winche", actionUrl: null, sendVerificationOnSignUp: false, maxPerAddressPerHour: 5, verifyLinkHours: 24, resetLinkHours: 1, sender: "logLinks", smtp: null },
};
const renderIt = (section = "sign-in") => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/server/authentication/${section}`]}>
        <Routes><Route path="server/:section/:tab?" element={<ServerSettingsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.serverSettings).mockResolvedValue({
    settings: { ...deployment, requireTwoFactorForSettings: false }, deployment, source: "console",
    version: { number: 2, at: "2026-11-14T10:00:00Z", by: "admin@example.com", reason: "Web app" },
    secrets: [],
    consoleSignIn: { callbackUrl: "https://api.example.com/_console/api/auth/oidc/callback", logoutUrl: "https://api.example.com/_console/api/auth/oidc/backchannel-logout" },
  });
  mock(api.saveServerSettings).mockResolvedValue({});
  mock(api.serverSettingsHistory).mockResolvedValue({ versions: [] });
  mock(serverAuthApi.signInSettings).mockResolvedValue({
    available: true, settings: accountsSignIn, codeDefault: accountsSignIn, source: "code", version: null, editable: true, whyReadOnly: null,
    smtpPassword: null, secretsAvailable: true, appSender: false,
  });
  mock(serverAuthApi.saveSignInSettings).mockResolvedValue({});
  mock(serverAuthApi.appAuthConfig).mockResolvedValue({ wincheAuth: true, emailPassword: { minLength: 8, requireVerifiedEmail: false }, email: null, emailLink: null, identityProviders: [], anonymous: false,
    trustsWincheTokens: true, trustedIssuers: [], tokens: null, keys: [], protection: null, hooks: null });
  mock(serverAuthApi.settingsHistory).mockResolvedValue({ versions: [] });
});

async function editCard(title: string) {
  const card = (await screen.findByRole("heading", { name: title })).closest(".mantine-Paper-root") as HTMLElement;
  await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
  return card;
}

test("changing settings: the two-step rule says whether it's the deployment's or changed here; a change is saved with a reason", async () => {
  renderIt("sign-in");
  await screen.findByRole("heading", { name: "Changing settings" });
  expect(screen.getByText(/Changed here · deployment:/)).toBeInTheDocument();
  expect(screen.queryByText("Public address")).toBeNull();   // the deployment knows it: not shown
  const card = await editCard("Changing settings");
  await userEvent.click(within(card).getByLabelText("Use the deployment's two-step sign-in to change settings"));
  await userEvent.type(within(card).getByLabelText("Reason for the change"), "Back to the deployment");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveServerSettings).toHaveBeenCalledWith(expect.objectContaining({ requireTwoFactorForSettings: true }), "Back to the deployment", expect.any(Number)));
});

test("users: Authentication's own list, of the console's accounts; one made a server admin, another's email changed", async () => {
  const root = { uid: "u1", email: "root@example.com", emailVerified: true, displayName: "Root Admin", photoUrl: null,
    isAnonymous: false, disabled: false, providers: ["password"], customClaims: { role: "Admin" }, createdAt: "2026-11-14T10:00:00Z", lastSignInAt: null };
  const ann = { ...root, uid: "u2", email: "ann@example.com", displayName: "Ann", customClaims: {} };
  mock(serverAuthApi.appUsers).mockResolvedValue({ total: 2, users: [root, ann] });
  mock(serverAuthApi.appUser).mockResolvedValue({ user: ann, sessions: [], mfa: null });
  mock(api.updateUser).mockResolvedValue(undefined);
  renderIt("users");
  expect(await screen.findByText("root@example.com")).toBeInTheDocument();
  expect(screen.getAllByText("Server admin")).toHaveLength(1);   // root's badge
  await userEvent.click(screen.getByText("ann@example.com"));
  const panel = await screen.findByTestId("console-account");
  await userEvent.click(within(panel).getByLabelText(/^Server admin/));
  await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("u2", { role: "Admin" }));
  await userEvent.click(within(panel).getByRole("button", { name: "Change email" }));
  const field = within(panel).getByLabelText(/^New email/);
  await userEvent.clear(field);
  await userEvent.type(field, "ann.new@example.com");
  await userEvent.click(within(panel).getByRole("button", { name: "Save email" }));
  await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("u2", { email: "ann.new@example.com" }));
});

test("email and password: the accounts' shortest password and two-step, saved to their Winche Auth", async () => {
  renderIt("sign-in");
  const row = await screen.findByTestId("console-method-password");
  await waitFor(() => expect(row).toHaveTextContent("shortest password 8"));
  await userEvent.click(within(row).getByRole("button", { name: /Email and password/ }));
  const min = within(row).getByLabelText("Shortest password");
  await userEvent.clear(min);
  await userEvent.type(min, "12");
  await userEvent.type(within(row).getByLabelText("Reason for the change"), "Longer");
  await userEvent.click(within(row).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(serverAuthApi.saveSignInSettings).toHaveBeenCalledWith(
    expect.objectContaining({ emailPassword: expect.objectContaining({ minLength: 12 }) }), null, "Longer"));
});

test("no changes yet: Change history says so", async () => {
  renderIt("sign-in");
  await userEvent.click(await screen.findByRole("button", { name: "Change history" }));
  expect(await screen.findByText("No changes yet")).toBeInTheDocument();
});

test("console sign-in: email and password always there; a provider added in the list and tried with a test sign-in", async () => {
  mock(api.testConsoleSignIn).mockResolvedValue({ url: "api/auth/oidc/start?test=t", callbackUrl: "https://api.example.com/_console/api/auth/oidc/callback" });
  mock(api.setServerSecret).mockResolvedValue(undefined);
  const opened = { location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
  renderIt("sign-in");
  expect(await screen.findByTestId("console-method-password")).toHaveTextContent("Enabled");
  await userEvent.click(screen.getByRole("button", { name: "Add new provider" }));
  const row = await screen.findByRole("dialog");
  expect(screen.queryByTestId("console-provider")).toBeNull();   // nothing in the list until it's added
  expect(within(row).getByText("https://api.example.com/_console/api/auth/oidc/callback")).toBeInTheDocument();
  expect(within(row).getByText("https://api.example.com/_console/api/auth/oidc/backchannel-logout")).toBeInTheDocument();
  await userEvent.type(within(row).getByLabelText(/^Issuer/), "https://login.example.com");
  await userEvent.type(within(row).getByLabelText(/^Client ID/), "winche-console");
  await userEvent.click(within(row).getByRole("textbox", { name: "Kind" }));
  await userEvent.click(await screen.findByRole("option", { name: "Okta" }));
  await userEvent.click(within(row).getByText(/More settings/));
  expect(within(row).getByLabelText(/^Claim with groups or roles/)).toHaveValue("groups");   // Okta's
  await userEvent.type(within(row).getByLabelText(/^Shown as/), "Sign in with Okta");
  await userEvent.type(within(row).getByRole("textbox", { name: "Server admin" }), "winche-admins{enter}");
  await userEvent.click(within(row).getByRole("button", { name: "Test sign-in" }));
  await waitFor(() => expect(opened.location.href).toContain("api/auth/oidc/start?test=t"));
  expect(api.testConsoleSignIn).toHaveBeenCalledWith(expect.objectContaining({ issuer: "https://login.example.com", roleClaim: "groups", adminValues: ["winche-admins"] }), null);
  window.dispatchEvent(new MessageEvent("message", {
    origin: window.location.origin,
    data: { type: "winche-oidc-test", ok: true, error: null, email: "bob@example.com", name: "Bob", subject: "u-1", roleValues: ["winche-admins"], role: "Admin", claims: { sub: "u-1" } },
  }));
  expect(await within(row).findByText("The test sign-in worked")).toBeInTheDocument();

  await userEvent.type(within(row).getByLabelText("Client secret"), "s3cret");
  await userEvent.type(within(row).getByLabelText("Reason for the change"), "Staff sign-in");
  await userEvent.click(within(row).getByRole("button", { name: "Add provider" }));
  await waitFor(() => expect(api.saveServerSettings).toHaveBeenCalledWith(expect.objectContaining({
    consoleProviders: [expect.objectContaining({ id: "okta", issuer: "https://login.example.com", enabled: true })],
  }), "Staff sign-in"));
  expect(api.setServerSecret).toHaveBeenCalledWith("server.consoleSignIn.okta.clientSecret", "s3cret");
  open.mockRestore();
});

test("console sign-in: passwords for server admins only; a provider turned off, then removed, with a reason", async () => {
  const staff = { id: "staff", enabled: true, issuer: "https://login.example.com", clientId: "winche-console", scopes: "openid profile email",
    buttonLabel: "Sign in with Staff ID", roleClaim: null, adminValues: [], memberValues: [], viewerValues: [], createAccounts: true, trustProviderTwoStep: true };
  mock(api.serverSettings).mockResolvedValue({
    settings: { ...deployment, consoleProviders: [staff], consolePasswordsOnlyForAdmins: true }, deployment, source: "console", version: null,
    secrets: [{ name: "server.consoleSignIn.staff.clientSecret", about: "x", setAt: "2026-11-14T10:00:00Z", setBy: "admin@example.com" }],
  });
  renderIt("sign-in");
  expect(await screen.findByText(/Server admins only/)).toBeInTheDocument();
  const row = await screen.findByTestId("console-provider");
  await userEvent.click(within(row).getByRole("button", { name: /Sign in with Staff ID/ }));
  expect(within(row).getByText(/One is saved/)).toBeInTheDocument();
  await userEvent.click(within(row).getByLabelText(/^Enable/));
  await userEvent.type(within(row).getByLabelText("Reason for the change"), "Paused");
  await userEvent.click(within(row).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveServerSettings).toHaveBeenCalledWith(expect.objectContaining({ consoleProviders: [{ ...staff, enabled: false }] }), "Paused", expect.any(Number)));
  expect(api.setServerSecret).not.toHaveBeenCalled();   // no new secret typed: the saved one stays

  await userEvent.click(within(row).getByRole("button", { name: /Sign in with Staff ID/ }));
  await userEvent.click(within(row).getByRole("button", { name: "Remove (on Save)" }));
  await userEvent.type(within(row).getByLabelText("Reason for the change"), "Gone");
  await userEvent.click(within(row).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveServerSettings).toHaveBeenLastCalledWith(expect.objectContaining({ consoleProviders: [] }), "Gone", expect.any(Number)));
});

test("a Keycloak provider's sync: its client and secret, saved with the provider", async () => {
  const staff = { id: "staff", enabled: true, issuer: "https://login.example.com/realms/staff", clientId: "winche-console", scopes: "openid profile email",
    buttonLabel: "Sign in with Staff ID", roleClaim: null, adminValues: [], memberValues: [], viewerValues: [], createAccounts: true, trustProviderTwoStep: true };
  mock(api.serverSettings).mockResolvedValue({ settings: { ...deployment, consoleProviders: [staff] }, deployment, source: "console", version: null, secrets: [] });
  mock(api.setServerSecret).mockResolvedValue(undefined);
  renderIt("sign-in");
  const row = await screen.findByTestId("console-provider");
  await userEvent.click(within(row).getByRole("button", { name: /Sign in with Staff ID/ }));
  await userEvent.click(within(row).getByLabelText(/^Keep its users in step with Keycloak/));
  await userEvent.type(within(row).getByLabelText(/^Sync client id/), "winche-sync");
  await userEvent.type(within(row).getByLabelText("Sync client secret"), "sync-s3cret");
  await userEvent.type(within(row).getByLabelText("Reason for the change"), "Follow Keycloak");
  await userEvent.click(within(row).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveServerSettings).toHaveBeenCalledWith(expect.objectContaining({
    consoleProviders: [expect.objectContaining({ id: "staff", keycloakSync: expect.objectContaining({ clientId: "winche-sync" }) })],
  }), "Follow Keycloak", expect.any(Number)));
  expect(api.setServerSecret).toHaveBeenCalledWith("server.consoleSignIn.staff.keycloakSync.clientSecret", "sync-s3cret");
});
