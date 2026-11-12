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
      signOutAppUser: vi.fn(), resetAppUserMfa: vi.fn(), unlinkAppUserProvider: vi.fn(), sendAppUserPasswordReset: vi.fn(), sendAppUserVerification: vi.fn(), setAppUserVerified: vi.fn(),
      appEmailTemplates: vi.fn(), saveAppEmailTemplate: vi.fn(), resetAppEmailTemplate: vi.fn(), testAppEmailTemplate: vi.fn(), revokeAppSession: vi.fn(), unlockAppUser: vi.fn(), deleteAppUser: vi.fn(), appAuthConfig: vi.fn(), rotateAppAuthKeys: vi.fn(),
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
const config: AppAuthConfig = {
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
  expect(nav.map((n) => n.label)).toEqual(["Database", "Authentication"]);
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
