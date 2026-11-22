import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { AuthenticationPage } from "../AuthenticationPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";
import { statusOf, errorMessage, type AppUser, type AppAuthConfig } from "../../../api/appAuth";
import { builtinNav, projectNav } from "../../../layout/nav";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, appUsers: vi.fn(), appUser: vi.fn(), createAppUser: vi.fn(), setAppUserDisabled: vi.fn(), setAppUserClaims: vi.fn(),
      signOutAppUser: vi.fn(), authProviders: vi.fn(), saveAuthProviders: vi.fn(), checkAuthProvider: vi.fn(), testAuthToken: vi.fn(),
      settingsHistory: vi.fn(), restoreSettings: vi.fn(), resetSettings: vi.fn(), resetAppUserMfa: vi.fn(), unlinkAppUserProvider: vi.fn(), sendAppUserPasswordReset: vi.fn(), sendAppUserVerification: vi.fn(), setAppUserVerified: vi.fn(),
      appEmailTemplates: vi.fn(), saveAppEmailTemplate: vi.fn(), resetAppEmailTemplate: vi.fn(), testAppEmailTemplate: vi.fn(), revokeAppSession: vi.fn(), unlockAppUser: vi.fn(), deleteAppUser: vi.fn(), appAuthConfig: vi.fn(), rotateAppAuthKeys: vi.fn(), keycloakSyncs: vi.fn(), syncKeycloakNow: vi.fn(),
      signInSettings: vi.fn(), saveSignInSettings: vi.fn(), testSignInEmail: vi.fn(), rulesSubsystems: vi.fn(),
      updateAppUserProfile: vi.fn(), setAppUserEmail: vi.fn(), setAppUserPassword: vi.fn(), setAppUserPhoto: vi.fn(), removeAppUserPhoto: vi.fn(),
    },
  };
});
vi.mock("../../../components/ProjectAvatar", async (orig) => {
  const actual = await orig<typeof import("../../../components/ProjectAvatar")>();
  return { ...actual, squareThumbnail: vi.fn(async (f: Blob) => f) };   // jsdom can't draw: the photo is the file itself
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const user = (over: Partial<AppUser> = {}): AppUser => ({
  uid: "Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", email: "anna.k@example.com", emailVerified: true, displayName: "Anna", photoUrl: null,
  isAnonymous: false, disabled: false, providers: ["password"], customClaims: { role: "editor" }, createdAt: "2026-11-03T10:00:00Z",
  lastSignInAt: "2026-11-12T15:41:00Z", lockedOutUntil: null, ...over,
});
const wincheCaps = { create: true, claims: true, claimsLabel: "Custom claims", sessions: true, unlock: true, resetMfa: true, unlinkProviders: true,
  passwordReset: true, verify: true, delete: true, disable: true, groups: false, profile: true, email: true, password: true, photo: true };
const config: AppAuthConfig = {
  directory: { kind: "wincheAuth", label: "Winche Auth", capabilities: wincheCaps }, trustedProviders: true,
  emailPassword: { minLength: 10, requireVerifiedEmail: false }, anonymous: true,
  email: { appName: "MyApp", actionUrl: "https://api.example.com/auth/v1/action", sendVerificationOnSignUp: true, maxPerAddressPerHour: 5, logLinksOnly: false, sender: "SesEmailSender" },
  emailLink: null,
  mfa: { issuer: "MyApp", recoveryCodes: 10, pendingMinutes: 5 },
  identityProviders: [{ name: "google", kind: "google", displayName: "Google", authority: "https://accounts.google.com", audiences: ["x.apps.googleusercontent.com"], useSubjectAsUid: false, copiedClaims: [], testingOnly: false }], trustsWincheTokens: true,
  trustedIssuers: [{ name: "keycloak", issuer: "https://auth.example.com/realms/example", authority: "https://auth.example.com/realms/example", audience: "my-api", uidClaim: "sub", claims: ["role"] }],
  tokens: { issuer: "https://api.example.com", audience: "https://api.example.com", accessTokenMinutes: 15, refreshTokenDays: 60, keyRotationDays: 90, keysEncrypted: false },
  keys: [{ kid: "k-20261112-abc123", createdAt: "2026-11-12T10:00:00Z", retiredAt: null }],
  protection: { maxFailedSignIns: 5, lockoutMinutes: 15 },
  hooks: { beforeCreate: true, afterCreate: false, beforeSignIn: false },
};

function renderPage(page = "users") {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/authentication/${page}`]}>
          <Routes><Route path="authentication/:page" element={<AuthenticationPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ state: { capabilities: { logs: { app: true }, authentication: true } }, user: { role: "Admin" } });
  mock(api.rulesSubsystems).mockResolvedValue([]);
  mock(api.appUsers).mockResolvedValue({ users: [user(), user({ uid: "guest1", email: null, displayName: null, isAnonymous: true, providers: ["anonymous"], customClaims: {} })], total: 2 });
  mock(api.appUser).mockResolvedValue({ user: user({ providers: ["password", "google"], mfaEnabled: true }), mfa: { recoveryCodesLeft: 7 }, sessions: [{ id: "s1", provider: "password", createdAt: "2026-11-12T10:00:00Z", lastUsedAt: "2026-11-12T15:41:00Z", expiresAt: "2027-01-11T10:00:00Z", userAgent: "MyApp/2.4.1 iOS", ipAddress: "10.0.0.7" }] });
  mock(api.appAuthConfig).mockResolvedValue(config);
  mock(api.keycloakSyncs).mockResolvedValue({ syncs: [] });
  mock(api.authProviders).mockResolvedValue(providersResponse());
  mock(api.settingsHistory).mockResolvedValue({ editable: true, versions: [] });
  mock(api.signInSettings).mockResolvedValue(signInResponse());
});

const keycloak = {
  name: "keycloak", displayName: "Example Keycloak", kind: "keycloak", issuer: "https://auth.example.com/realms/example", authority: null,
  audiences: ["my-api"], validateAudience: true, uidClaim: "sub", claims: [{ from: "realm_access.roles", to: "roles" }], requireHttps: true,
};
const signInSettings = {
  emailPassword: { enabled: true, minLength: 10, requireVerifiedEmail: false }, anonymous: true, emailLink: { enabled: false, linkUrl: "" },
  twoStep: { enabled: true, issuer: "MyApp", recoveryCodes: 10 },
  providers: [{ name: "google", kind: "google" as const, displayName: "Google", authority: "https://accounts.google.com", audiences: ["x.apps.googleusercontent.com"], useSubjectAsUid: false, copiedClaims: [] }],
  sessions: { accessTokenMinutes: 15, refreshTokenDays: 60 }, lockout: { maxFailedSignIns: 5, lockoutMinutes: 15 },
  email: { enabled: true, appName: "MyApp", actionUrl: null, sendVerificationOnSignUp: true, maxPerAddressPerHour: 5, verifyLinkHours: 24, resetLinkHours: 1, sender: "app" as const, smtp: null },
};
const signInResponse = (over: object = {}) => ({
  available: true, settings: signInSettings, codeDefault: signInSettings, source: "code", version: null, editable: true, whyReadOnly: null,
  smtpPassword: null, secretsAvailable: true, appSender: false, ...over,
});
const providersResponse = (over: object = {}) => ({
  settings: { trustWincheAuth: false, providers: [keycloak] }, codeDefault: { trustWincheAuth: false, providers: [] },
  source: "console", version: { id: 7, area: "auth.identityProviders", areaTitle: "Identity providers", number: 3, at: "2026-11-12T16:05:00Z", by: "admin@example.com", reason: "Team rules", restoredFrom: null, reset: false },
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
  const dialog = await screen.findByRole("dialog", { name: "User: Anna" });   // a plain name, not the rich header
  const tab = (name: RegExp | string) => userEvent.click(within(dialog).getByRole("tab", { name }));

  // Profile (the first tab): name and photo; email at once (not verified, a verify link) or by a link; a password.
  await userEvent.clear(within(dialog).getByLabelText("Display name"));
  await userEvent.type(within(dialog).getByLabelText("Display name"), "Anna Kowalska");
  await userEvent.type(within(dialog).getByLabelText("Photo URL"), "https://example.com/anna.png");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save name and photo" }));
  await waitFor(() => expect(mock(api.updateAppUserProfile)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "Anna Kowalska", "https://example.com/anna.png"));
  const email = within(dialog).getByLabelText("Email");
  await userEvent.clear(email);
  await userEvent.type(email, "anna@example.com");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save email" }));
  await waitFor(() => expect(mock(api.setAppUserEmail)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "anna@example.com", { confirm: false, verified: false, sendVerification: true }));
  expect(await within(dialog).findByText(/a verify link is on its way to anna@example.com/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByText("Send a link to confirm"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Send the link" }));
  await waitFor(() => expect(mock(api.setAppUserEmail)).toHaveBeenLastCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "anna@example.com", { confirm: true }));
  expect(await within(dialog).findByText(/the email changes when they open it/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Link sent" })).toBeDisabled();   // not sent again until the address changes
  await userEvent.type(within(dialog).getByLabelText("New password"), "a brand new password");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  await waitFor(() => expect(mock(api.setAppUserPassword)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "a brand new password"));

  // Access: claims, and turning the account off.
  await tab("Access");
  const claims = within(dialog).getByLabelText("Custom claims (JSON)") as HTMLTextAreaElement;
  expect(JSON.parse(claims.value)).toEqual({ role: "editor" });
  await userEvent.clear(claims);
  await userEvent.type(claims, "{{ \"role\": \"admin\" }");
  await userEvent.click(within(dialog).getByText("Save claims"));
  await waitFor(() => expect(mock(api.setAppUserClaims)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", { role: "admin" }));
  await userEvent.clear(claims);
  await userEvent.type(claims, "[[1]");
  await userEvent.click(within(dialog).getByText("Save claims"));
  expect(await within(dialog).findByText("Custom claims must be a JSON object.")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByText("Disable user"));
  await waitFor(() => expect(mock(api.setAppUserDisabled)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", true));

  // Sign-in: two-step sign-in, methods, emails.
  await tab("Sign-in");
  expect(within(dialog).getByTestId("app-user-mfa")).toHaveTextContent("7 recovery codes left");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(within(within(dialog).getByTestId("app-user-mfa")).getByText("Turn off"));
  await waitFor(() => expect(mock(api.resetAppUserMfa)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w"));
  const providers = within(dialog).getAllByTestId("app-user-provider");
  expect(within(providers[0]).queryByText("Unlink")).toBeNull();   // a password isn't unlinked
  await userEvent.click(within(providers[1]).getByText("Unlink"));
  await waitFor(() => expect(mock(api.unlinkAppUserProvider)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "google"));
  await userEvent.click(within(dialog).getByText("Send password reset"));
  await waitFor(() => expect(mock(api.sendAppUserPasswordReset)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w"));
  expect(await within(dialog).findByText("A reset link is on its way to anna.k@example.com.")).toBeInTheDocument();

  // Sessions.
  await tab(/Sessions/);
  expect(within(dialog).getByText("MyApp/2.4.1 iOS")).toBeInTheDocument();
  await userEvent.click(within(within(dialog).getByTestId("app-session")).getByText("Sign out"));
  await waitFor(() => expect(mock(api.revokeAppSession)).toHaveBeenCalledWith("Xq3v9LmT2aB7pQ8rS1dF4gH6jK0w", "s1"));

  // Deleting asks first, at the foot.
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete user" }));
  expect(within(dialog).getByText(/Their sign-in goes; their data stays/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(mock(api.deleteAppUser)).not.toHaveBeenCalled();
});

async function editCard(title: string) {
  const card = (await screen.findByRole("heading", { name: title })).closest(".mantine-Paper-root") as HTMLElement;
  await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
  return card;
}

test("sign-in method: each provider with its status; keys can be rotated in Settings", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage("methods");
  expect(within(await screen.findByTestId("method-emailPassword")).getByText("Enabled")).toBeInTheDocument();
  expect(within(screen.getByTestId("method-emailPassword")).getByText(/two-step available/)).toBeInTheDocument();
  expect(within(screen.getByTestId("method-emailLink")).getByText("Disabled")).toBeInTheDocument();
  expect(within(screen.getByTestId("method-anonymous")).getByText("Enabled")).toBeInTheDocument();
  expect(within(screen.getByTestId("signin-provider")).getAllByText("Google").length).toBeGreaterThan(0);
  expect(screen.queryByText("Example Keycloak")).toBeNull();   // a trusted issuer: its own page

  cleanup();
  renderPage("settings");
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
  expect(nav.map((n) => n.label)).toEqual(["Authentication", "Database"]);   // Authentication first; apps and members are in Project settings
  expect(builtinNav({ capabilities: { hooks: true } } as never, null)).toEqual([]);   // hooks are pages of the products, not a product
  // Each product's pages sit under it; one with a single page has none.
  const full = projectNav({ capabilities: { database: true, hooks: true, history: true, logs: { app: true, database: true, storage: false } } } as never,
    { role: "Admin" } as never, { rules: ["database"] });
  expect(full.find((n) => n.to === "/database")!.pages.map((p) => p.label)).toEqual(["Data", "Rules", "History", "Webhooks", "Logs"]);
  expect(full.find((n) => n.to === "/settings")!.pages.map((p) => p.label)).toEqual(["General", "Members", "Service accounts"]);
  expect(full.find((n) => n.to === "/secrets")!.label).toBe("Secrets");   // a section of its own, for admins
  expect(projectNav({ capabilities: {} } as never, { role: "Member" } as never).find((n) => n.to === "/secrets")).toBeUndefined();
});

test("email templates: edit with a live preview, save, test and reset", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const reset = { kind: "resetPassword", name: "Reset password", subject: "Reset your %APP_NAME% password", body: "Hello %DISPLAY_NAME%,\n\nReset %EMAIL%:\n\n%LINK%",
    isCustom: true, defaultSubject: "d", defaultBody: "d", linkLifetime: "1 hour", updatedAt: "2026-11-12T10:00:00Z", updatedBy: "admin@winche.local" };
  mock(api.appEmailTemplates).mockResolvedValue({ templates: [
    { ...reset, kind: "verifyEmail", name: "Verify email", isCustom: false, linkLifetime: "1 day" }, reset,
  ] });
  mock(api.testAppEmailTemplate).mockResolvedValue({ sentTo: "admin@winche.local" });
  renderPage("emails");
  await userEvent.click(await screen.findByRole("tab", { name: /Reset password/ }));
  expect(await screen.findByText(/admin@winche.local/)).toBeInTheDocument();
  expect(screen.getByTestId("preview-subject")).toHaveTextContent("Reset your MyApp password");
  expect(screen.getByText("Choose a new password")).toBeInTheDocument();   // the link as a button
  expect(screen.getByText(/Sent with SesEmailSender/)).toBeInTheDocument();

  await userEvent.click(screen.getByText("Send me a test"));
  expect(await screen.findByText("Sent to admin@winche.local.")).toBeInTheDocument();

  const subject = screen.getByLabelText("Subject");
  await userEvent.clear(subject);
  await userEvent.type(subject, "New %APP_NAME% password");
  expect(screen.getByTestId("preview-subject")).toHaveTextContent("New MyApp password");
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(mock(api.saveAppEmailTemplate)).toHaveBeenCalledWith("resetPassword", "New %APP_NAME% password", reset.body));

  await userEvent.click(screen.getByText("Reset to default"));
  await waitFor(() => expect(mock(api.resetAppEmailTemplate)).toHaveBeenCalledWith("resetPassword"));
});

test("Keycloak-only apps: settings first; providers, mapping with the token test, saved with a reason", async () => {
  mock(api.appAuthConfig).mockResolvedValue({ ...config, wincheAuth: false, directory: null, tokens: null, protection: null, hooks: null, emailPassword: null, email: null, mfa: null, anonymous: false, identityProviders: [] });
  mock(api.checkAuthProvider).mockResolvedValue({ found: true, issuer: "https://auth-staging.example.com/realms/staging", keys: 2, algorithms: ["RS256"], error: null });
  mock(api.testAuthToken).mockResolvedValue({
    wouldSignIn: true, provider: "keycloak",
    checks: [{ outcome: "ok", text: "Signed by Example Keycloak (key OqSi2)" }, { outcome: "warning", text: "groups is in the token but not passed to the rules" }],
    auth: { uid: "6f1c2a9e", token: { uid: "6f1c2a9e", issuer: "keycloak", roles: ["editor"] } }, notPassed: ["groups"],
  });
  mock(api.saveAuthProviders).mockResolvedValue({ number: 4 });
  renderPage("issuers");

  // Tokens from other issuers, accepted as they are: their own page.
  expect(await screen.findByText(/Version 3,/)).toBeInTheDocument();
  expect(within(screen.getByTestId("provider-card")).getByText("Example Keycloak")).toBeInTheDocument();

  // Add a provider: check its address first.
  await userEvent.click(screen.getByText("Add issuer"));
  const form = await screen.findByLabelText("Provider");
  await userEvent.type(within(form).getByLabelText("Address (issuer)"), "https://auth-staging.example.com/realms/staging");
  await userEvent.click(within(form).getByText("Check address"));
  expect(await within(form).findByText(/Found it: .*2 signing keys \(RS256\)/)).toBeInTheDocument();
  expect(within(form).getByText(/Give the audience/)).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText(/^Audience/), "my-api");
  await userEvent.clear(within(form).getByLabelText(/^Short name/));
  await userEvent.type(within(form).getByLabelText(/^Short name/), "staging");
  await userEvent.click(within(form).getByText("Add to the list"));
  expect(screen.getAllByTestId("provider-card")).toHaveLength(2);

  // The mapping, under the issuers: add a field, test a token against the draft.
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
  await userEvent.type(within(bar).getByLabelText("Reason for the change"), "Staging realm and team rules");
  await userEvent.click(within(bar).getByText("Save changes"));
  await waitFor(() => expect(mock(api.saveAuthProviders)).toHaveBeenCalledWith(expect.objectContaining({ trustWincheAuth: false }), "Staging realm and team rules", expect.any(Number)));
});

test("change history: restore and reset ask why", async () => {
  mock(api.settingsHistory).mockResolvedValue({ editable: true, versions: [
    { id: 9, area: "auth.identityProviders", areaTitle: "Identity providers", number: 2, at: "2026-11-12T16:05:00Z", by: "admin@example.com", reason: "Team rules", restoredFrom: null, reset: false, current: true },
    { id: 8, area: "auth.identityProviders", areaTitle: "Identity providers", number: 1, at: "2026-11-02T17:15:00Z", by: "dev@example.com", reason: "Trust Keycloak", restoredFrom: null, reset: false, current: false },
  ] });
  mock(api.restoreSettings).mockResolvedValue({ number: 3 });
  renderPage("settings");
  await userEvent.click(await screen.findByRole("button", { name: "Change history" }));
  const rows = await screen.findAllByTestId("history-version");
  expect(within(rows[0]).getByText("In use")).toBeInTheDocument();
  await userEvent.click(within(rows[1]).getByText("Restore"));
  expect(screen.getByText("Restore version 1 as a new change?")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Reason"), "That one was right");
  await userEvent.click(screen.getAllByText("Restore").at(-1)!);
  await waitFor(() => expect(mock(api.restoreSettings)).toHaveBeenCalledWith(8, "That one was right"));

  await userEvent.click(within(rows[0]).getByRole("button", { name: "Reset Identity providers" }));
  expect(screen.getByText(/Put Identity providers back to the defaults/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Reason"), "Start over");
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(mock(api.resetSettings)).toHaveBeenCalledWith("auth.identityProviders", "Start over"));
});

test("users from a Keycloak with sync on: marked, and their account managed in Keycloak (no disable, delete or emails here)", async () => {
  mock(api.appAuthConfig).mockResolvedValue({ ...config, identityProviders: [{ name: "keycloak", kind: "oidc", displayName: "Keycloak",
    authority: "https://auth.example.com/realms/staff", audiences: ["app"], useSubjectAsUid: false, copiedClaims: [], testingOnly: false, keycloakSync: true }] });
  const ana = user({ uid: "u-ana", email: "ana@example.com", displayName: "Ana Lopez", providers: ["keycloak"], customClaims: { org: "acme" } });
  mock(api.appUsers).mockResolvedValue({ users: [ana], total: 1 });
  mock(api.appUser).mockResolvedValue({ user: ana, sessions: [], mfa: { recoveryCodesLeft: null } });
  renderPage();
  await userEvent.click((await screen.findAllByTestId("app-user"))[0]);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByTestId("from-keycloak")).toHaveTextContent("managed in Keycloak");
  // Their profile, email and password are Keycloak's: shown, not editable; no password field.
  expect(within(dialog).getByLabelText("Display name")).toBeDisabled();
  expect(within(dialog).getByLabelText("Email")).toBeDisabled();
  expect(within(dialog).queryByLabelText("New password")).toBeNull();
  expect(within(dialog).queryByText("Delete user")).toBeNull();
  await userEvent.click(within(dialog).getByRole("tab", { name: "Access" }));
  expect(within(dialog).queryByText("Disable user")).toBeNull();
  expect(within(dialog).getByLabelText("Custom claims (JSON)")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("tab", { name: "Sign-in" }));
  expect(within(dialog).queryByText("Send password reset")).toBeNull();
  await userEvent.click(within(dialog).getByRole("tab", { name: /Sessions/ }));
  expect(within(dialog).getByText("Sign out everywhere")).toBeInTheDocument();   // their sessions here are Winche's
});

test("settings have no user directory: users are Winche Auth's", async () => {
  renderPage("settings");
  await screen.findByRole("heading", { name: "Sessions" });
  expect(screen.queryByText("User directory")).toBeNull();
});

test("read-only when the app's code doesn't let the console change them", async () => {
  mock(api.authProviders).mockResolvedValue(providersResponse({ editable: false, source: "code", version: null, whyReadOnly: "The app's code sets these." }));
  renderPage("issuers");
  expect(await screen.findByText(/Read-only\. The app's code sets these\./)).toBeInTheDocument();
  expect(screen.queryByText("Add issuer")).toBeNull();
});

test("sign-in settings: methods and lifetimes change in the console, saved together with a reason", async () => {
  mock(api.saveSignInSettings).mockResolvedValue({ number: 1 });
  renderPage("methods");
  const guests = await screen.findByTestId("method-anonymous");
  await userEvent.click(within(guests).getByRole("button", { expanded: false }));
  await userEvent.click(within(guests).getByLabelText("Users can start as guests"));
  await userEvent.type(within(guests).getByLabelText("Reason for the change"), "No guests");
  await userEvent.click(within(guests).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith({ ...signInSettings, anonymous: false }, null, "No guests", undefined, expect.any(Number)));

  cleanup();
  renderPage("settings");
  const sessions = await editCard("Sessions");
  const minutes = within(sessions).getByLabelText("Access tokens last (minutes)");
  await userEvent.clear(minutes);
  await userEvent.type(minutes, "5");
  await userEvent.type(within(sessions).getByLabelText("Reason for the change"), "Tighter sessions");
  await userEvent.click(within(sessions).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    { ...signInSettings, sessions: { accessTokenMinutes: 5, refreshTokenDays: 60 } }, null, "Tighter sessions", undefined, expect.any(Number)));
});

test("sign-in method: Add new provider opens a dialog; saved with a reason, then in the list", async () => {
  mock(api.saveSignInSettings).mockResolvedValue({ number: 1 });
  renderPage("methods");
  const before = (await screen.findAllByTestId("signin-provider").catch(() => [])).length;
  await userEvent.click(await screen.findByRole("button", { name: "Add new provider" }));
  const dialog = await screen.findByRole("dialog");
  expect(screen.queryAllByTestId("signin-provider")).toHaveLength(before);   // not in the list until it's added
  await userEvent.type(within(dialog).getByLabelText(/^Name/), "google-web");
  await userEvent.type(within(dialog).getByLabelText(/^Client ids/), "web.apps.googleusercontent.com");
  await userEvent.type(within(dialog).getByLabelText("Reason for the change"), "Google sign-in");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add provider" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    { ...signInSettings, providers: [...signInSettings.providers, expect.objectContaining({ kind: "google", name: "google-web", audiences: ["web.apps.googleusercontent.com"] })] },
    null, "Google sign-in"));
});

test("sign-in method: an OpenID Connect provider kept in step with Keycloak, its sync secret sent with the save", async () => {
  mock(api.saveSignInSettings).mockResolvedValue({ number: 1 });
  renderPage("methods");
  await userEvent.click(await screen.findByRole("button", { name: "Add new provider" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("textbox", { name: "Kind" }));
  await userEvent.click(await screen.findByRole("option", { name: "OpenID Connect" }));
  await userEvent.type(within(dialog).getByLabelText(/^Name/), "staff");
  await userEvent.type(within(dialog).getByLabelText(/^Address/), "https://id.example.com/realms/staff");
  await userEvent.type(within(dialog).getByLabelText(/^Client ids/), "app");
  await userEvent.click(within(dialog).getByLabelText(/^Keep its users in step with Keycloak/));
  await userEvent.type(within(dialog).getByLabelText(/^Sync client id/), "winche-sync");
  await userEvent.type(within(dialog).getByLabelText("Sync client secret"), "s3cret");
  await userEvent.type(within(dialog).getByLabelText("Reason for the change"), "Staff");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add provider" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    expect.objectContaining({ providers: expect.arrayContaining([expect.objectContaining({ name: "staff", keycloakSync: expect.objectContaining({ clientId: "winche-sync" }) })]) }),
    null, "Staff", { staff: "s3cret" }));
});

test("sign-in settings: SMTP with a write-only password and a test email", async () => {
  mock(api.testSignInEmail).mockResolvedValue({ sentTo: "me@example.com" });
  mock(api.saveSignInSettings).mockResolvedValue({ number: 2 });
  renderPage("settings");
  const card = await editCard("Emails to users");
  expect(screen.getByText(/Choose how emails are sent/)).toBeInTheDocument();   // an app sender isn't offered
  await userEvent.click(screen.getByText("SMTP server"));
  await userEvent.type(screen.getByLabelText("Server"), "smtp.example.com");
  await userEvent.type(screen.getByLabelText("Username"), "mailer");
  await userEvent.type(screen.getByLabelText(/^Password/), "pw");
  await userEvent.type(screen.getByLabelText("From address"), "no-reply@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Send test email" }));
  expect(await screen.findByTestId("smtp-test")).toHaveTextContent("Sent to me@example.com");
  const smtp = { host: "smtp.example.com", port: 587, security: "startTls", username: "mailer", fromAddress: "no-reply@example.com", fromName: null };
  expect(mock(api.testSignInEmail)).toHaveBeenCalledWith(expect.objectContaining({ email: expect.objectContaining({ sender: "smtp", smtp }) }), "pw", null);
  await userEvent.type(within(card).getByLabelText("Reason for the change"), "Our own mail server");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    expect.objectContaining({ email: expect.objectContaining({ sender: "smtp", smtp }) }), "pw", "Our own mail server", undefined, expect.any(Number)));
});

test("sign-in settings: sign-in link and reset emails can be sent before answering", async () => {
  mock(api.saveSignInSettings).mockResolvedValue({ number: 2 });
  mock(api.signInSettings).mockResolvedValue(signInResponse({ settings: { ...signInSettings, email: { ...signInSettings.email, sender: "logLinks" } } }));
  renderPage("settings");
  expect(await screen.findByText("Sent after answering")).toBeInTheDocument();   // absent: on
  const card = await editCard("Emails to users");
  const toggle = within(card).getByRole("switch", { name: /emails after answering/ });
  expect(toggle).toBeChecked();
  await userEvent.click(toggle);
  await userEvent.type(within(card).getByLabelText("Reason for the change"), "Show send failures");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    expect.objectContaining({ email: expect.objectContaining({ sendInBackground: false }) }), null, "Show send failures", undefined, expect.any(Number)));
});

test("sign-in settings: with the server's own email, it's offered and needs nothing set up", async () => {
  mock(api.appAuthConfig).mockResolvedValue({ ...config, serverEmail: "Amazon SES (eu-west-1) as no-reply@example.com" });
  mock(api.saveSignInSettings).mockResolvedValue({ number: 2 });
  renderPage("settings");
  const card = await editCard("Emails to users");
  await userEvent.click(await screen.findByText("The server's email"));
  expect(screen.getByText(/Sent through the server's own email: Amazon SES \(eu-west-1\) as no-reply@example.com/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Server")).toBeNull();   // no SMTP fields
  await userEvent.type(within(card).getByLabelText("Reason for the change"), "The server's email");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(
    expect.objectContaining({ email: expect.objectContaining({ sender: "app" }) }), null, "The server's email", undefined, expect.any(Number)));
});

test("sign-in settings: a saved SMTP password is never shown", async () => {
  mock(api.signInSettings).mockResolvedValue(signInResponse({
    settings: { ...signInSettings, email: { ...signInSettings.email, sender: "smtp", smtp: { host: "smtp.example.com", port: 587, security: "startTls", username: "mailer", fromAddress: "no-reply@example.com", fromName: null } } },
    smtpPassword: { setAt: "2026-11-12T16:00:00Z", setBy: "admin@example.com" },
  }));
  renderPage("settings");
  await editCard("Emails to users");
  expect(screen.getByTestId("smtp-password-set")).toHaveTextContent("never shown");
  expect(screen.queryByLabelText(/^Password/)).toBeNull();
});

test("sign-in settings: apps without UseSettings() say how to turn it on", async () => {
  mock(api.signInSettings).mockResolvedValue({ available: false, whyReadOnly: "The app's code sets these: add o.UseSettings() to AddWincheAuth(…) to change them here." });
  renderPage("settings");
  expect(await screen.findByText(/add o.UseSettings\(\)/)).toBeInTheDocument();
});

test("a Keycloak sync shows how it's doing and can be run now", async () => {
  const now = new Date().toISOString();
  mock(api.keycloakSyncs).mockResolvedValue({ syncs: [
    { provider: "keycloak", displayName: "Example Keycloak", clientId: "winche-sync", server: "http://keycloak:8080/realms/winche",
      pollSeconds: 10, reconcileHours: 24, claims: ["roles"], attributes: { team: "team" }, webhookUrl: "https://api.example.com/auth/v1/providers/keycloak/changed",
      lastRunAt: now, eventsAfter: now, reconciledAt: null, lastChangeAt: null, lastError: "401 from Keycloak: check the client secret" },
    { provider: "staff", displayName: "Staff", clientId: "sync", server: "https://id.example.com/realms/staff",
      pollSeconds: 10, reconcileHours: 24, claims: [], attributes: {}, webhookUrl: null,
      lastRunAt: now, eventsAfter: now, reconciledAt: now, lastChangeAt: now, lastError: null },
  ] });
  mock(api.syncKeycloakNow).mockResolvedValue(undefined);
  renderPage("methods");
  const [failing, running] = await screen.findAllByTestId("keycloak-sync");
  expect(within(failing).getByText("Failing")).toBeInTheDocument();
  expect(within(failing).getByText("401 from Keycloak: check the client secret")).toBeInTheDocument();
  expect(within(failing).getByText("team")).toBeInTheDocument();
  expect(within(running).getByText("Running")).toBeInTheDocument();
  expect(within(running).getByText("off (polling only)")).toBeInTheDocument();
  await userEvent.click(within(failing).getByRole("button", { name: "Sync now" }));
  expect(api.syncKeycloakNow).toHaveBeenCalledWith("keycloak");
});

test("a sign-in provider can require a second step; saved with a reason", async () => {
  mock(api.saveSignInSettings).mockResolvedValue({ number: 2 });
  renderPage("methods");
  const google = await screen.findByTestId("signin-provider");
  await userEvent.click(within(google).getByRole("button", { expanded: false }));
  await userEvent.click(await within(google).findByRole("switch", { name: /Require a second step/ }));
  await userEvent.type(within(google).getByLabelText("Reason for the change"), "Staff must use a code");
  await userEvent.click(within(google).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveSignInSettings)).toHaveBeenCalledWith(expect.objectContaining({
    providers: [expect.objectContaining({ name: "google", requireSecondStep: true })],
  }), null, "Staff must use a code", undefined, expect.any(Number)));
});

test("a user's photo: where it came from; uploaded (shrunk first) or removed", async () => {
  const google = user({ photoUrl: "https://lh3.example.com/anna.png", photoSource: "provider:google", providers: ["google"] });
  mock(api.appUsers).mockResolvedValue({ users: [google], total: 1 });
  mock(api.appUser).mockResolvedValue({ user: google, sessions: [], mfa: null });
  mock(api.setAppUserPhoto).mockResolvedValue(user({ photoSource: "upload" }));
  renderPage();
  await userEvent.click((await screen.findAllByTestId("app-user"))[0]);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByTestId("photo-source")).toHaveTextContent("From Google");
  const file = new File(["png"], "anna.png", { type: "image/png" });
  await userEvent.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, file);
  await waitFor(() => expect(api.setAppUserPhoto).toHaveBeenCalledWith(google.uid, file));
  expect(await within(dialog).findByText("Photo uploaded.")).toBeInTheDocument();

  const uploaded = user({ photoUrl: "https://api.example.com/auth/v1/photos/abc", photoSource: "upload" });
  mock(api.appUser).mockResolvedValue({ user: uploaded, sessions: [], mfa: null });
  mock(api.removeAppUserPhoto).mockResolvedValue(user());
  cleanup();
  renderPage();
  await userEvent.click((await screen.findAllByTestId("app-user"))[0]);
  const again = await screen.findByRole("dialog");
  expect(within(again).getByTestId("photo-source")).toHaveTextContent("Uploaded");
  await userEvent.click(within(again).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api.removeAppUserPhoto).toHaveBeenCalledWith(uploaded.uid));
});
