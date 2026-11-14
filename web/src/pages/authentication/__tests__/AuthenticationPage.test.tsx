import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { AuthenticationPage } from "../AuthenticationPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import { statusOf, errorMessage, type AppUser, type AppAuthConfig } from "../../../api/appAuth";
import { builtinNav } from "../../../layout/nav";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, appUsers: vi.fn(), appUser: vi.fn(), createAppUser: vi.fn(), setAppUserDisabled: vi.fn(), setAppUserClaims: vi.fn(),
      signOutAppUser: vi.fn(), authProviders: vi.fn(), saveAuthProviders: vi.fn(), checkAuthProvider: vi.fn(), testAuthToken: vi.fn(),
      settingsHistory: vi.fn(), restoreSettings: vi.fn(), resetSettings: vi.fn(), resetAppUserMfa: vi.fn(), unlinkAppUserProvider: vi.fn(), sendAppUserPasswordReset: vi.fn(), sendAppUserVerification: vi.fn(), setAppUserVerified: vi.fn(),
      appEmailTemplates: vi.fn(), saveAppEmailTemplate: vi.fn(), resetAppEmailTemplate: vi.fn(), testAppEmailTemplate: vi.fn(), revokeAppSession: vi.fn(), unlockAppUser: vi.fn(), deleteAppUser: vi.fn(), appAuthConfig: vi.fn(), rotateAppAuthKeys: vi.fn(), keycloakSyncs: vi.fn(), syncKeycloakNow: vi.fn(),
      userDirectory: vi.fn(), saveUserDirectory: vi.fn(), testUserDirectory: vi.fn(),
      signInSettings: vi.fn(), saveSignInSettings: vi.fn(), testSignInEmail: vi.fn(),
    },
  };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const user = (over: Partial<AppUser> = {}): AppUser => ({
  uid: "Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", email: "anna.k@example.com", emailVerified: true, displayName: "Anna", photoUrl: null,
  isAnonymous: false, disabled: false, providers: ["password"], customClaims: { role: "clinician" }, createdAt: "2026-11-03T10:00:00Z",
  lastSignInAt: "2026-11-12T15:41:00Z", lockedOutUntil: null, ...over,
});
const wincheCaps = { create: true, claims: true, claimsLabel: "Custom claims", sessions: true, unlock: true, resetMfa: true, unlinkProviders: true,
  passwordReset: true, verify: true, delete: true, disable: true, groups: false };
const config: AppAuthConfig = {
  directory: { kind: "wincheAuth", label: "Winche Auth", capabilities: wincheCaps }, trustedProviders: true,
  emailPassword: { minLength: 10, requireVerifiedEmail: false }, anonymous: true,
  email: { appName: "SmartAirway", actionUrl: "https://api.example.com/auth/v1/action", sendVerificationOnSignUp: true, maxPerAddressPerHour: 5, logLinksOnly: false, sender: "SesEmailSender" },
  emailLink: null,
  mfa: { issuer: "SmartAirway", recoveryCodes: 10, pendingMinutes: 5 },
  identityProviders: [{ name: "google", kind: "google", displayName: "Google", authority: "https://accounts.google.com", audiences: ["x.apps.googleusercontent.com"], useSubjectAsUid: false, copiedClaims: [], testingOnly: false }], trustsWincheTokens: true,
  trustedIssuers: [{ name: "keycloak", issuer: "https://auth.example.com/realms/trucorp", authority: "https://auth.example.com/realms/trucorp", audience: "smartairway-api", uidClaim: "sub", claims: ["role"] }],
  tokens: { issuer: "https://api.example.com", audience: "https://api.example.com", accessTokenMinutes: 15, refreshTokenDays: 60, keyRotationDays: 90, keysEncrypted: false },
  keys: [{ kid: "k-20261112-abc123", createdAt: "2026-11-12T10:00:00Z", retiredAt: null }],
  protection: { maxFailedSignIns: 5, lockoutMinutes: 15 },
  hooks: { beforeCreate: true, afterCreate: false, beforeSignIn: false },
};

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><AuthenticationPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ state: { capabilities: { logs: { app: true } } }, user: { role: "Admin" } });
  mock(api.appUsers).mockResolvedValue({ users: [user(), user({ uid: "guest1", email: null, displayName: null, isAnonymous: true, providers: ["anonymous"], customClaims: {} })], total: 2 });
  mock(api.appUser).mockResolvedValue({ user: user({ providers: ["password", "google"], mfaEnabled: true }), mfa: { recoveryCodesLeft: 7 }, sessions: [{ id: "s1", provider: "password", createdAt: "2026-11-12T10:00:00Z", lastUsedAt: "2026-11-12T15:41:00Z", expiresAt: "2027-01-11T10:00:00Z", userAgent: "SmartAirway/2.4.1 iOS", ipAddress: "10.0.0.7" }] });
  mock(api.appAuthConfig).mockResolvedValue(config);
  mock(api.keycloakSyncs).mockResolvedValue({ syncs: [] });
  mock(api.authProviders).mockResolvedValue(providersResponse());
  mock(api.settingsHistory).mockResolvedValue({ editable: true, versions: [] });
  mock(api.signInSettings).mockResolvedValue(signInResponse());
});

const keycloak = {
  name: "keycloak", displayName: "TruCorp Keycloak", kind: "keycloak", issuer: "https://auth.trucorp.com/realms/smartairway", authority: null,
  audiences: ["smartairway-api"], validateAudience: true, uidClaim: "sub", claims: [{ from: "realm_access.roles", to: "roles" }], requireHttps: true,
};
const signInSettings = {
  emailPassword: { enabled: true, minLength: 10, requireVerifiedEmail: false }, anonymous: true, emailLink: { enabled: false, linkUrl: "" },
  twoStep: { enabled: true, issuer: "SmartAirway", recoveryCodes: 10 },
  providers: [{ name: "google", kind: "google" as const, displayName: "Google", authority: "https://accounts.google.com", audiences: ["x.apps.googleusercontent.com"], useSubjectAsUid: false, copiedClaims: [] }],
  sessions: { accessTokenMinutes: 15, refreshTokenDays: 60 }, lockout: { maxFailedSignIns: 5, lockoutMinutes: 15 },
  email: { enabled: true, appName: "SmartAirway", actionUrl: null, sendVerificationOnSignUp: true, maxPerAddressPerHour: 5, verifyLinkHours: 24, resetLinkHours: 1, sender: "app" as const, smtp: null },
};
const signInResponse = (over: object = {}) => ({
  available: true, settings: signInSettings, codeDefault: signInSettings, source: "code", version: null, editable: true, whyReadOnly: null,
  smtpPassword: null, secretsAvailable: true, appSender: false, ...over,
});
const providersResponse = (over: object = {}) => ({
  settings: { trustWincheAuth: false, providers: [keycloak] }, codeDefault: { trustWincheAuth: false, providers: [] },
  source: "console", version: { id: 7, area: "auth.identityProviders", areaTitle: "Identity providers", number: 3, at: "2026-11-12T16:05:00Z", by: "admin@trucorp.com", reason: "Clinic rules", restoredFrom: null, reset: false },
  editable: true, whyReadOnly: null, ...over,
});

test("lists users; opening one shows sessions and claims, and its actions call the API", async () => {
  renderPage();
  const rows = await screen.findAllByTestId("app-user");
  expect(within(rows[0]).getByText("anna.k@example.com")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Anonymous user")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Guest")).toBeInTheDocument();
  expect(screen.getByText("Sign-ins and failures in Logs →")).toHaveAttribute("href", "/logs?resource=auth");

  await userEvent.click(rows[0]);
  expect(await screen.findByText("SmartAirway/2.4.1 iOS")).toBeInTheDocument();
  const claims = screen.getByLabelText("Custom claims (JSON)") as HTMLTextAreaElement;
  expect(JSON.parse(claims.value)).toEqual({ role: "clinician" });

  await userEvent.clear(claims);
  await userEvent.type(claims, "{{ \"role\": \"admin\" }");
  await userEvent.click(screen.getByText("Save claims"));
  await waitFor(() => expect(mock(api.setAppUserClaims)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", { role: "admin" }));

  await userEvent.clear(claims);
  await userEvent.type(claims, "[[1]");
  await userEvent.click(screen.getByText("Save claims"));
  expect(await screen.findByText("Custom claims must be a JSON object.")).toBeInTheDocument();

  expect(screen.getByTestId("app-user-mfa")).toHaveTextContent("7 recovery codes left");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(within(screen.getByTestId("app-user-mfa")).getByText("Turn off"));
  await waitFor(() => expect(mock(api.resetAppUserMfa)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w"));
  const providers = screen.getAllByTestId("app-user-provider");
  expect(within(providers[0]).queryByText("Unlink")).toBeNull();   // a password isn't unlinked
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(within(providers[1]).getByText("Unlink"));
  await waitFor(() => expect(mock(api.unlinkAppUserProvider)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "google"));
  await userEvent.click(within(screen.getByTestId("app-session")).getByText("Sign out"));
  await waitFor(() => expect(mock(api.revokeAppSession)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "s1"));
  await userEvent.click(screen.getByText("Send password reset"));
  await waitFor(() => expect(mock(api.sendAppUserPasswordReset)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w"));
  expect(await screen.findByText("A reset link is on its way to anna.k@example.com.")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Disable user"));
  await waitFor(() => expect(mock(api.setAppUserDisabled)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", true));
});

test("sign-in methods and settings show what's configured; keys can be rotated", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Sign-in methods" }));
  const methods = await screen.findAllByTestId("sign-in-method");
  expect(methods).toHaveLength(7);
  expect(within(methods[1]).getByText("Off")).toBeInTheDocument();   // email link
  expect(within(methods[3]).getByText("x.apps.googleusercontent.com")).toBeInTheDocument();
  expect(within(methods[4]).getByText("SmartAirway")).toBeInTheDocument();   // two-step
  expect(within(methods[6]).getByText("keycloak (trusted issuer)")).toBeInTheDocument();
  expect(within(methods[6]).getByText("role")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: /Tokens and keys/ }));
  expect(await screen.findByText("k-20261112-abc123")).toBeInTheDocument();
  expect(screen.getByText(/Stored unencrypted/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Rotate now"));
  await waitFor(() => expect(mock(api.rotateAppAuthKeys)).toHaveBeenCalled());
});

test("helpers and nav", () => {
  expect(statusOf(user({ disabled: true }))).toBe("Disabled");
  expect(statusOf(user({ lockedOutUntil: new Date(Date.now() + 60_000).toISOString() }))).toBe("Locked out");
  expect(statusOf(user({ emailVerified: false }))).toBe("Not verified");
  expect(errorMessage(new Error('{"error":{"code":"EMAIL_EXISTS","message":"An account with that email already exists."}}'))).toBe("An account with that email already exists.");
  const nav = builtinNav({ capabilities: { authentication: true, database: true } } as never, null);
  expect(nav.map((n) => n.label)).toEqual(["Database", "Authentication"]);   // Apps and Access are in Project settings
});

test("email templates: edit with a live preview, save, test and reset", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const reset = { kind: "resetPassword", name: "Reset password", subject: "Reset your %APP_NAME% password", body: "Hello %DISPLAY_NAME%,\n\nReset %EMAIL%:\n\n%LINK%",
    isCustom: true, defaultSubject: "d", defaultBody: "d", linkLifetime: "1 hour", updatedAt: "2026-11-12T10:00:00Z", updatedBy: "admin@winche.local" };
  mock(api.appEmailTemplates).mockResolvedValue({ templates: [
    { ...reset, kind: "verifyEmail", name: "Verify email", isCustom: false, linkLifetime: "1 day" }, reset,
  ] });
  mock(api.testAppEmailTemplate).mockResolvedValue({ sentTo: "admin@winche.local" });
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Email templates" }));
  await userEvent.click(await screen.findByRole("tab", { name: /Reset password/ }));
  expect(await screen.findByText(/admin@winche.local/)).toBeInTheDocument();
  expect(screen.getByTestId("preview-subject")).toHaveTextContent("Reset your SmartAirway password");
  expect(screen.getByText("Choose a new password")).toBeInTheDocument();   // the link as a button
  expect(screen.getByText(/Sent with SesEmailSender/)).toBeInTheDocument();

  await userEvent.click(screen.getByText("Send me a test"));
  expect(await screen.findByText("Sent to admin@winche.local.")).toBeInTheDocument();

  const subject = screen.getByLabelText("Subject");
  await userEvent.clear(subject);
  await userEvent.type(subject, "New %APP_NAME% password");
  expect(screen.getByTestId("preview-subject")).toHaveTextContent("New SmartAirway password");
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(mock(api.saveAppEmailTemplate)).toHaveBeenCalledWith("resetPassword", "New %APP_NAME% password", reset.body));

  await userEvent.click(screen.getByText("Reset to default"));
  await waitFor(() => expect(mock(api.resetAppEmailTemplate)).toHaveBeenCalledWith("resetPassword"));
});

test("Keycloak-only apps: settings first; providers, mapping with the token test, saved with a reason", async () => {
  mock(api.appAuthConfig).mockResolvedValue({ ...config, wincheAuth: false, directory: null, tokens: null, protection: null, hooks: null, emailPassword: null, email: null, mfa: null, anonymous: false, identityProviders: [] });
  mock(api.checkAuthProvider).mockResolvedValue({ found: true, issuer: "https://auth-staging.trucorp.com/realms/smartairway", keys: 2, algorithms: ["RS256"], error: null });
  mock(api.testAuthToken).mockResolvedValue({
    wouldSignIn: true, provider: "keycloak",
    checks: [{ outcome: "ok", text: "Signed by TruCorp Keycloak (key OqSi2)" }, { outcome: "warning", text: "groups is in the token but not passed to the rules" }],
    auth: { uid: "6f1c2a9e", token: { uid: "6f1c2a9e", issuer: "keycloak", roles: ["clinician"] } }, notPassed: ["groups"],
  });
  mock(api.saveAuthProviders).mockResolvedValue({ number: 4 });
  renderPage();

  // No Users or Email templates tab without Winche Auth; Settings opens first.
  expect(await screen.findByText(/Saved in the console: version 3/)).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Users" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Email templates" })).toBeNull();
  expect(within(screen.getByTestId("provider-card")).getByText("TruCorp Keycloak")).toBeInTheDocument();

  // Add a provider: check its address first.
  await userEvent.click(screen.getByText("Add provider"));
  const form = await screen.findByLabelText("Provider");
  await userEvent.type(within(form).getByLabelText("Address (issuer)"), "https://auth-staging.trucorp.com/realms/smartairway");
  await userEvent.click(within(form).getByText("Check address"));
  expect(await within(form).findByText(/Found it: .*2 signing keys \(RS256\)/)).toBeInTheDocument();
  expect(within(form).getByText(/Give the audience/)).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText(/^Audience/), "smartairway-api");
  await userEvent.clear(within(form).getByLabelText(/^Short name/));
  await userEvent.type(within(form).getByLabelText(/^Short name/), "staging");
  await userEvent.click(within(form).getByText("Add to the list"));
  expect(screen.getAllByTestId("provider-card")).toHaveLength(2);

  // The mapping: add a field, test a token against the draft.
  await userEvent.click(screen.getByRole("tab", { name: /Token mapping/ }));
  await userEvent.click(screen.getByText("Add a field"));
  const rows = screen.getAllByTestId("mapping-row");
  await userEvent.type(within(rows[1]).getByLabelText("Field in the token"), "org");
  await userEvent.type(within(rows[1]).getByLabelText("Name in the rules"), "org");
  await userEvent.type(screen.getByLabelText("Paste a token from a signed-in user"), "eyJ.a.b");
  await userEvent.click(screen.getByText("Test with these settings"));
  expect(await screen.findByText(/groups is in the token/)).toBeInTheDocument();
  expect(screen.getByTestId("token-preview")).toHaveTextContent('"roles"');
  const draft = mock(api.testAuthToken).mock.calls[0][1];
  expect(draft.providers.map((p: { name: string }) => p.name)).toEqual(["keycloak", "staging"]);
  expect(draft.providers[0].claims).toEqual([{ from: "realm_access.roles", to: "roles" }, { from: "org", to: "org" }]);

  // Saving needs a reason.
  const bar = screen.getByTestId("save-bar");
  expect(within(bar).getByText("Save changes").closest("button")).toBeDisabled();
  await userEvent.type(within(bar).getByLabelText("Reason for the change"), "Staging realm and clinic rules");
  await userEvent.click(within(bar).getByText("Save changes"));
  await waitFor(() => expect(mock(api.saveAuthProviders)).toHaveBeenCalledWith(expect.objectContaining({ trustWincheAuth: false }), "Staging realm and clinic rules"));
});

test("change history: restore and reset ask why", async () => {
  mock(api.settingsHistory).mockResolvedValue({ editable: true, versions: [
    { id: 9, area: "auth.identityProviders", areaTitle: "Identity providers", number: 2, at: "2026-11-12T16:05:00Z", by: "admin@trucorp.com", reason: "Clinic rules", restoredFrom: null, reset: false, current: true },
    { id: 8, area: "auth.identityProviders", areaTitle: "Identity providers", number: 1, at: "2026-11-02T17:15:00Z", by: "dev@trucorp.com", reason: "Trust Keycloak", restoredFrom: null, reset: false, current: false },
  ] });
  mock(api.restoreSettings).mockResolvedValue({ number: 3 });
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: /Change history/ }));
  const rows = await screen.findAllByTestId("history-version");
  expect(within(rows[0]).getByText("In use")).toBeInTheDocument();
  await userEvent.click(within(rows[1]).getByText("Restore"));
  expect(screen.getByText("Restore version 1 as a new change?")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Reason"), "That one was right");
  await userEvent.click(screen.getAllByText("Restore").at(-1)!);
  await waitFor(() => expect(mock(api.restoreSettings)).toHaveBeenCalledWith(8, "That one was right"));

  await userEvent.click(within(rows[0]).getByRole("button", { name: "Reset Identity providers" }));
  expect(screen.getByText(/Put Identity providers back to the values in the app's code/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Reason"), "Start over");
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(mock(api.resetSettings)).toHaveBeenCalledWith("auth.identityProviders", "Start over"));
});

const directoryResponse = (over: object = {}) => ({
  settings: { kind: "auto", keycloak: null }, source: "code", version: null, editable: true, whyReadOnly: null, effectiveKind: "wincheAuth",
  wincheAuthInstalled: true, secret: null, secretsAvailable: true, ...over,
});

test("user directory: connect Keycloak, test the service account, save with the secret", async () => {
  mock(api.userDirectory).mockResolvedValue(directoryResponse());
  mock(api.testUserDirectory).mockResolvedValue({ connected: true, error: null, users: 992, permissions: [
    { role: "view-users", granted: true, for: "list and open users" },
    { role: "view-events", granted: false, for: "show sign-ins and failures in Logs" },
  ] });
  mock(api.saveUserDirectory).mockResolvedValue({ number: 1 });
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: /User directory/ }));
  await userEvent.click(await screen.findByText("Keycloak"));
  expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Keycloak address"), "https://auth.trucorp.com");
  await userEvent.type(screen.getByLabelText("Realm"), "smartairway");
  await userEvent.type(screen.getByLabelText("Client id"), "winche-console");
  await userEvent.type(screen.getByLabelText(/Client secret/), "s3cret");
  await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
  const result = await screen.findByTestId("directory-test");
  expect(within(result).getByText(/The realm has 992 users\. Some roles are missing/)).toBeInTheDocument();
  expect(within(result).getByText("view-events")).toBeInTheDocument();
  const draft = { kind: "keycloak", keycloak: { serverUrl: "https://auth.trucorp.com", realm: "smartairway", clientId: "winche-console", signInEvents: true } };
  expect(mock(api.testUserDirectory)).toHaveBeenCalledWith(draft, "s3cret");

  await userEvent.type(within(screen.getByTestId("directory-save-bar")).getByLabelText("Reason for the change"), "Manage SmartAirway users here");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveUserDirectory)).toHaveBeenCalledWith(draft, "s3cret", "Manage SmartAirway users here"));
});

test("user directory: a saved secret is never shown, only replaced", async () => {
  mock(api.userDirectory).mockResolvedValue(directoryResponse({
    settings: { kind: "keycloak", keycloak: { serverUrl: "https://auth.trucorp.com", realm: "smartairway", clientId: "winche-console", signInEvents: true } },
    effectiveKind: "keycloak", secret: { setAt: "2026-11-12T16:00:00Z", setBy: "admin@trucorp.com" },
  }));
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: /User directory/ }));
  const secret = await screen.findByTestId("secret-set");
  expect(within(secret).getByText(/saved encrypted, never shown/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Client secret/)).toBeNull();
  await userEvent.click(within(secret).getByText("Replace"));
  expect(screen.getByLabelText(/Client secret/)).toHaveValue("");
});

test("Keycloak users: groups and attributes; only what Keycloak supports is offered", async () => {
  mock(api.appAuthConfig).mockResolvedValue({ ...config, wincheAuth: false, directory: { kind: "keycloak", label: "Keycloak",
    capabilities: { ...wincheCaps, claimsLabel: "Attributes", unlinkProviders: false, groups: true } } });
  const ana = user({ uid: "u-ana", email: "dr.costa@example.com", displayName: "Ana Costa", providers: ["keycloak"], customClaims: { org: "st-marys" },
    groups: ["/clinicians"], username: "dr.costa@example.com", mfaEnabled: true });
  mock(api.appUsers).mockResolvedValue({ users: [ana], total: 1 });
  mock(api.appUser).mockResolvedValue({ user: ana, sessions: [], mfa: { recoveryCodesLeft: null } });
  renderPage();
  await userEvent.click((await screen.findAllByTestId("app-user"))[0]);
  expect(await screen.findByText("/clinicians")).toBeInTheDocument();
  expect(screen.getByText("Attributes")).toBeInTheDocument();
  expect(screen.getByText("On: authenticator app")).toBeInTheDocument();
  expect(screen.getByText("Send password reset")).toBeInTheDocument();   // Keycloak sends it, whatever Winche Auth's email setup
  expect(screen.queryByText("Email templates")).toBeNull();
});

test("read-only when the app's code doesn't let the console change them", async () => {
  mock(api.authProviders).mockResolvedValue(providersResponse({ editable: false, source: "code", version: null, whyReadOnly: "The app's code sets these." }));
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: /Identity providers/ }));
  expect(await screen.findByText(/Read-only\. The app's code sets these\./)).toBeInTheDocument();
  expect(screen.queryByText("Add provider")).toBeNull();
});

test("sign-in settings: methods and lifetimes change in the console, saved together with a reason", async () => {
  mock(api.saveSignInSettings).mockResolvedValue({ number: 1 });
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await screen.findByLabelText("Users can start as guests");
  await userEvent.click(screen.getByLabelText("Users can start as guests"));
  await userEvent.click(screen.getByRole("tab", { name: /Sessions and security/ }));
  const minutes = screen.getByLabelText("Access tokens last (minutes)");
  await userEvent.clear(minutes);
  await userEvent.type(minutes, "5");
  await userEvent.type(screen.getByLabelText("Reason for the change"), "Tighter sessions, no guests");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    { ...signInSettings, anonymous: false, sessions: { accessTokenMinutes: 5, refreshTokenDays: 60 } }, null, "Tighter sessions, no guests"));
});

test("sign-in settings: SMTP with a write-only password and a test email", async () => {
  mock(api.testSignInEmail).mockResolvedValue({ sentTo: "me@trucorp.com" });
  mock(api.saveSignInSettings).mockResolvedValue({ number: 2 });
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: "Email" }));
  expect(screen.getByText(/The app's code has no email sender/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("SMTP server"));
  await userEvent.type(screen.getByLabelText("Server"), "smtp.example.com");
  await userEvent.type(screen.getByLabelText("Username"), "mailer");
  await userEvent.type(screen.getByLabelText(/^Password/), "pw");
  await userEvent.type(screen.getByLabelText("From address"), "no-reply@trucorp.com");
  await userEvent.click(screen.getByRole("button", { name: "Send test email" }));
  expect(await screen.findByTestId("smtp-test")).toHaveTextContent("Sent to me@trucorp.com");
  const smtp = { host: "smtp.example.com", port: 587, security: "startTls", username: "mailer", fromAddress: "no-reply@trucorp.com", fromName: null };
  expect(mock(api.testSignInEmail)).toHaveBeenCalledWith(expect.objectContaining({ email: expect.objectContaining({ sender: "smtp", smtp }) }), "pw", null);
  await userEvent.type(screen.getByLabelText("Reason for the change"), "Our own mail server");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    expect.objectContaining({ email: expect.objectContaining({ sender: "smtp", smtp }) }), "pw", "Our own mail server"));
});

test("sign-in settings: a saved SMTP password is never shown", async () => {
  mock(api.signInSettings).mockResolvedValue(signInResponse({
    settings: { ...signInSettings, email: { ...signInSettings.email, sender: "smtp", smtp: { host: "smtp.example.com", port: 587, security: "startTls", username: "mailer", fromAddress: "no-reply@trucorp.com", fromName: null } } },
    smtpPassword: { setAt: "2026-11-12T16:00:00Z", setBy: "admin@trucorp.com" },
  }));
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("tab", { name: "Email" }));
  expect(screen.getByTestId("smtp-password-set")).toHaveTextContent("never shown");
  expect(screen.queryByLabelText(/^Password/)).toBeNull();
});

test("sign-in settings: apps without UseSettings() say how to turn it on", async () => {
  mock(api.signInSettings).mockResolvedValue({ available: false, whyReadOnly: "The app's code sets these: add o.UseSettings() to AddWincheAuth(…) to change them here." });
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
  expect(await screen.findByText(/add o.UseSettings\(\)/)).toBeInTheDocument();
});

test("a Keycloak sync shows how it's doing and can be run now", async () => {
  const now = new Date().toISOString();
  mock(api.keycloakSyncs).mockResolvedValue({ syncs: [
    { provider: "keycloak", displayName: "TruCorp Keycloak", clientId: "winche-sync", server: "http://keycloak:8080/realms/winche",
      pollSeconds: 10, reconcileHours: 24, claims: ["roles"], attributes: { ward: "ward" }, webhookUrl: "https://api.example.com/auth/v1/providers/keycloak/changed",
      lastRunAt: now, eventsAfter: now, reconciledAt: null, lastChangeAt: null, lastError: "401 from Keycloak: check the client secret" },
    { provider: "staff", displayName: "Staff", clientId: "sync", server: "https://id.example.com/realms/staff",
      pollSeconds: 10, reconcileHours: 24, claims: [], attributes: {}, webhookUrl: null,
      lastRunAt: now, eventsAfter: now, reconciledAt: now, lastChangeAt: now, lastError: null },
  ] });
  mock(api.syncKeycloakNow).mockResolvedValue(undefined);
  renderPage();
  await userEvent.click(await screen.findByRole("tab", { name: "Sign-in methods" }));
  const [failing, running] = await screen.findAllByTestId("keycloak-sync");
  expect(within(failing).getByText("Failing")).toBeInTheDocument();
  expect(within(failing).getByText("401 from Keycloak: check the client secret")).toBeInTheDocument();
  expect(within(failing).getByText("ward")).toBeInTheDocument();
  expect(within(running).getByText("Running")).toBeInTheDocument();
  expect(within(running).getByText("off (polling only)")).toBeInTheDocument();
  await userEvent.click(within(failing).getByRole("button", { name: "Sync now" }));
  expect(api.syncKeycloakNow).toHaveBeenCalledWith("keycloak");
});
