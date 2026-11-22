import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { IntegrityPage } from "../IntegrityPage";
import { api } from "../../../api/client";
import type { AppsPageData, IntegrityApp, IntegrityData } from "../../../api/apps";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn(), integrity: vi.fn(), addApp: vi.fn(), updateApp: vi.fn(), removeApp: vi.fn(),
    setIntegrityEnforcement: vi.fn(), makeDebugToken: vi.fn(), removeDebugToken: vi.fn(), setPlayServiceAccount: vi.fn(), removePlayServiceAccount: vi.fn(),
    setTurnstileSecret: vi.fn() } };
});

const MODE_ENFORCE = "Refused without a valid token";
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const page = (platforms: string[]): AppsPageData => ({
  setup: { projectId: "demo", name: null, baseUrl: "https://api.example.com", services: [], providers: [] },
  platforms: ["android", "ios", "macos", "web", "windows", "linux"],
  file: platforms.map((p) => `static final ${p} = WincheOptions(`).join("\n"),
  snippet: "WincheFlutter.initializeApp(options: DefaultWincheOptions.currentPlatform)",
});
const PRODUCTS = ["database", "storage", "authentication", "functions", "assets"];
const myApp: IntegrityApp = {
  id: "app-abc234def567", name: "My app", androidPackage: "com.example.myapp", appleBundleId: "com.example.myapp", appleTeamId: "ABCDE12345",
  androidCloudProjectNumber: 123456789012, androidSideloaded: false, androidDeviceIntegrity: "device", androidCertificates: [],
  webSiteKey: "0x4AAAAAAAsitekey123", webHostnames: ["app.example.com"], turnstileSecret: null,
  createdAt: "2026-11-14T10:00:00Z", appleDevelopment: true, devices: { count: 3, development: 1, lastUsed: new Date().toISOString() },
  usage: { database: { today: 10, last7Days: 70, lastSeen: new Date().toISOString() }, authentication: { today: 2, last7Days: 10, lastSeen: null } },
};
const integrity = (over: Partial<IntegrityData> = {}): IntegrityData => ({
  available: true, canSign: true, editable: true, products: PRODUCTS,
  enforcement: Object.fromEntries(PRODUCTS.map((p) => [p, "monitor"])) as IntegrityData["enforcement"],
  tokenMinutes: 60, apps: [], unverified: {}, debugTokens: [], playServiceAccount: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.apps).mockImplementation(async (platforms: string[]) => page(platforms));
  mock(api.integrity).mockResolvedValue(integrity());
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><IntegrityPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test("no apps: an empty state; Add app is one step (name and the platforms' ids, no SDK), then its id and options file", async () => {
  mock(api.addApp).mockResolvedValue({ id: "app-abc234def567" });
  renderPage();
  expect(await screen.findByText("No apps yet")).toBeInTheDocument();
  expect(screen.getByText("Add an app first.")).toBeInTheDocument();   // no debug tokens without one
  await userEvent.click(screen.getByRole("button", { name: "Add app" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByText("What's your app built with?")).toBeNull();   // no SDK to pick
  expect(within(dialog).getByText("Apple (iOS, macOS)")).toBeInTheDocument();
  expect(within(dialog).getByText("Android")).toBeInTheDocument();
  expect(within(dialog).getByText("Web")).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText("App name"), "My app");
  await userEvent.type(within(dialog).getByLabelText("Android package"), "com.example.myapp");
  await userEvent.type(within(dialog).getByLabelText("Google Cloud project number"), "123456789012");
  await userEvent.type(within(dialog).getByLabelText("Apple bundle id"), "com.example.myapp");
  await userEvent.type(within(dialog).getByLabelText("Turnstile site key"), "0x4AAAAAAAsitekey123");
  await userEvent.type(within(dialog).getByLabelText("Turnstile secret key"), "0x4AAAAAAAsecret12345");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Sites the app runs on" }), "App.Example.com{enter}");
  await userEvent.type(within(dialog).getByLabelText("Apple team id"), "abcde12345");
  expect(within(dialog).getByLabelText("App id")).toHaveValue("my-app");   // follows the name until edited
  await userEvent.clear(within(dialog).getByLabelText("App id"));
  await userEvent.type(within(dialog).getByLabelText("App id"), "myapp-ios");
  expect(within(dialog).queryByLabelText("Web addresses")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Add app" }));
  await waitFor(() => expect(api.addApp).toHaveBeenCalledWith({ name: "My app", androidPackage: "com.example.myapp",
    appleBundleId: "com.example.myapp", appleTeamId: "ABCDE12345", appleDevelopment: false, androidCloudProjectNumber: 123456789012,
    androidSideloaded: false, androidDeviceIntegrity: "device", androidCertificates: [], webSiteKey: "0x4AAAAAAAsitekey123", webHostnames: ["app.example.com"], id: "myapp-ios" }));
  expect(api.setTurnstileSecret).toHaveBeenCalledWith("app-abc234def567", "0x4AAAAAAAsecret12345", null);
  // Then just its id and its options file: no steps, no code.
  expect(await screen.findByText("app-abc234def567")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByText(/winche configure|pub add|useIntegrity/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Download winche_options.dart/ }));
  await waitFor(() => expect(api.apps).toHaveBeenLastCalledWith(["android", "ios", "macos", "web", "windows", "linux"], "app-abc234def567"));
});

test("with apps: each with its identifiers and verified requests; enforcement per product with today's counts, saved with a reason", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp], unverified: { database: { today: 3, last7Days: 5, lastSeen: null } } }));
  mock(api.setIntegrityEnforcement).mockResolvedValue({});
  renderPage();
  const row = await screen.findByTestId("integrity-app");
  expect(within(row).getByText("My app")).toBeInTheDocument();
  expect(within(row).getByText(/12 verified requests today · 80 this week · last seen just now/)).toBeInTheDocument();
  // Each platform's readiness: what's missing, in red.
  expect(within(row).getByTestId("ready-apple")).toHaveTextContent("Apple: 3 devices");
  expect(within(row).getByTestId("ready-android")).toHaveTextContent("Android: needs the service account");
  expect(within(row).getByTestId("ready-web")).toHaveTextContent("Web: needs its secret key");

  // The card: each product's mode, the week's share as a bar, today's counts and what enforcing would refuse.
  const card = screen.getByTestId("integrity-enforcement");
  const database = within(card).getByTestId("enforcement-database");
  expect(database).toHaveTextContent("Today: 10 verified · 3 without a token");
  expect(database).toHaveTextContent("⚠ 3 would be refused");
  expect(within(card).getByTestId("week-database")).toHaveTextContent("93% verified · 7 days");   // 70 of 75
  expect(within(database).getByRole("img", { name: "93% verified" })).toBeInTheDocument();
  expect(within(card).getByText("Tokens last 60 minutes")).toBeInTheDocument();

  // Changed in a dialog: every product, the lifetime and the reason, saved together.
  await userEvent.click(within(card).getByRole("button", { name: "Change…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByTestId("enforce-warning-database")).toBeNull();
  await userEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Database mode" })).getByLabelText("Enforce"));
  expect(within(dialog).getByTestId("enforce-warning-database")).toHaveTextContent("Database: 5 requests in the last 7 days had no valid token. Enforced, they'd have been refused.");
  await userEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Assets mode" })).getByLabelText("Off"));
  const minutes = within(dialog).getByLabelText("Tokens last (minutes)");
  await userEvent.clear(minutes);
  await userEvent.type(minutes, "120");
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();   // a reason first
  await userEvent.type(within(dialog).getByLabelText("Reason for the change"), "Our apps all send tokens");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.setIntegrityEnforcement).toHaveBeenCalledWith(
    { database: "enforce", storage: "monitor", authentication: "monitor", functions: "monitor", assets: "off" }, 120, "Our apps all send tokens"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a product verified 99% of the week, with every app set up, is ready to enforce", async () => {
  const ready = { ...myApp, appleTeamId: null, appleBundleId: null, androidPackage: null, webSiteKey: null,
    usage: { database: { today: 500, last7Days: 4000, lastSeen: null } } };
  mock(api.integrity).mockResolvedValue(integrity({ apps: [ready], unverified: { database: { today: 0, last7Days: 10, lastSeen: null } } }));
  renderPage();
  const database = await screen.findByTestId("enforcement-database");
  expect(database).toHaveTextContent("99% verified · 7 days");
  expect(database).toHaveTextContent("✓ ready to enforce");
  expect(screen.getByTestId("enforcement-storage")).toHaveTextContent("no requests yet");
});

test("a debug token is made for an app and shown once; removing one asks first", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp],
    debugTokens: [{ id: "dt-1", app: myApp.id, name: "Ann's simulator", createdAt: "2026-11-20T10:00:00Z", createdBy: "admin@example.com" }] }));
  mock(api.makeDebugToken).mockResolvedValue({ id: "dt-2", app: myApp.id, name: "CI", token: "wdt_secret-value" });
  mock(api.removeDebugToken).mockResolvedValue(undefined);
  renderPage();
  const tokens = await screen.findByTestId("integrity-debug-tokens");
  expect(within(tokens).getByText("Ann's simulator")).toBeInTheDocument();
  expect(within(tokens).getByText("My app")).toBeInTheDocument();

  await userEvent.click(within(tokens).getByRole("button", { name: "Make debug token" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Name"), "CI");
  await userEvent.click(within(dialog).getByRole("button", { name: "Make token" }));
  await waitFor(() => expect(api.makeDebugToken).toHaveBeenCalledWith(myApp.id, "CI"));
  expect(await screen.findByTestId("debug-token-value")).toHaveTextContent("wdt_secret-value");
  await userEvent.keyboard("{Escape}");   // shown once: not closed by accident
  expect(screen.getByTestId("debug-token-value")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(within(tokens).getByRole("button", { name: "Make debug token" }));
  const again = await screen.findByRole("dialog");
  expect(within(again).queryByTestId("debug-token-value")).toBeNull();
  expect(within(again).getByLabelText("Name")).toHaveValue("");
  await userEvent.click(within(again).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await userEvent.click(within(tokens).getByRole("button", { name: "Remove Ann's simulator" }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove token" }));
  await waitFor(() => expect(api.removeDebugToken).toHaveBeenCalledWith("dt-1"));
});

test("viewers see it all and change nothing; without a master key it says so", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp], editable: false, canSign: false }));
  renderPage();
  expect(await screen.findByTestId("integrity-app")).toBeInTheDocument();
  expect(screen.getByText(/no master key/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add app" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Make debug token" })).toBeNull();
  expect(within(screen.getByTestId("integrity-enforcement")).queryByRole("button", { name: "Change…" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^More for/ })).toBeNull();
});

test("Play Integrity: an Android app needs the service account; its key file is set write-only and its address shown", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp] }));
  mock(api.setPlayServiceAccount).mockResolvedValue({});
  renderPage();
  const card = await screen.findByTestId("play-service-account");
  expect(within(card).getByText(/Not set: Android apps can't prove themselves/)).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Set service account" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByLabelText(/Key file/));
  await userEvent.paste('{"type":"service_account","client_email":"x@y.iam.gserviceaccount.com"}');
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.setPlayServiceAccount).toHaveBeenCalledWith('{"type":"service_account","client_email":"x@y.iam.gserviceaccount.com"}', null));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(within(card).getByRole("button", { name: "Set service account" }));
  expect(within(await screen.findByRole("dialog")).getByLabelText(/Key file/)).toHaveValue("");   // never shown again

  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp], playServiceAccount: { setAt: "2026-11-21T10:00:00Z", setBy: "admin@example.com", reference: null, email: "x@y.iam.gserviceaccount.com" } }));
  renderPage();
  expect(await screen.findByText("x@y.iam.gserviceaccount.com")).toBeInTheDocument();
});

test("readiness: ready once everything is set; an app with nothing set has debug tokens only; enforcing with an app not ready warns", async () => {
  const { readiness } = await import("../IntegrityPage");
  const account = { setAt: "2026-11-21T10:00:00Z", setBy: null, reference: null, email: "x@y.iam.gserviceaccount.com" };
  const ready = { ...myApp, turnstileSecret: { setAt: "2026-11-21T10:00:00Z", setBy: null, reference: null } };
  expect(readiness(ready, { playServiceAccount: account, debugTokens: [] }).map((r) => [r.platform, r.color])).toEqual([["apple", "teal"], ["android", "teal"], ["web", "teal"]]);
  expect(readiness({ ...ready, appleTeamId: null, androidCloudProjectNumber: null }, { playServiceAccount: account, debugTokens: [] }).map((r) => r.label))
    .toEqual(["Apple: needs its team id", "Android: needs its Cloud project number", "Web: ready"]);
  expect(readiness({ ...ready, devices: null }, { playServiceAccount: account, debugTokens: [] })[0].label).toBe("Apple: ready, no devices yet");
  const bare = { ...myApp, appleBundleId: null, appleTeamId: null, androidPackage: null, webSiteKey: null };
  expect(readiness(bare, { playServiceAccount: null, debugTokens: [] })[0].label).toBe("No way to prove itself yet");
  expect(readiness(bare, { playServiceAccount: null, debugTokens: [{ id: "dt-1", app: myApp.id, name: "CI", createdAt: "", createdBy: null }] })[0].label).toBe("Debug tokens only (1)");

  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp], enforcement: { ...integrity().enforcement, database: "enforce" } }));
  renderPage();
  expect(await screen.findByTestId("enforced-not-ready")).toHaveTextContent("not every app can prove itself yet");
});

test("adding: the app is made but its secret key isn't saved; trying again sends only the secret, never a second app", async () => {
  mock(api.addApp).mockResolvedValue({ id: "my-app" });
  mock(api.setTurnstileSecret).mockRejectedValueOnce(new Error("Secrets are unavailable")).mockResolvedValueOnce({});
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add app" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("App name"), "My app");
  await userEvent.type(within(dialog).getByLabelText("Turnstile site key"), "0x4AAAAAAAsitekey123");
  await userEvent.type(within(dialog).getByLabelText("Turnstile secret key"), "0x4AAAAAAAsecret12345");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add app" }));
  expect(await within(dialog).findByText(/The app was added, but its Turnstile secret key wasn't saved: Secrets are unavailable/)).toBeInTheDocument();
  expect(within(dialog).getByLabelText("App id")).toBeDisabled();   // it exists now
  await userEvent.click(within(dialog).getByRole("button", { name: "Save secret key" }));
  expect(await screen.findByRole("button", { name: /Download winche_options.dart/ })).toBeInTheDocument();
  expect(api.addApp).toHaveBeenCalledTimes(1);
  expect(api.updateApp).not.toHaveBeenCalled();
  expect(api.setTurnstileSecret).toHaveBeenCalledTimes(2);
  expect(api.setTurnstileSecret).toHaveBeenLastCalledWith("my-app", "0x4AAAAAAAsecret12345", null);

  // The download says when it fails.
  mock(api.apps).mockRejectedValueOnce(new Error("Server unreachable"));
  await userEvent.click(screen.getByRole("button", { name: /Download winche_options.dart/ }));
  expect(await screen.findByText("Couldn't download it: Server unreachable")).toBeInTheDocument();
});

test("removing an app that fails says why and keeps the dialog", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp] }));
  mock(api.removeApp).mockRejectedValue(new Error("Not allowed"));
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "More for My app" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
  const dialog = await screen.findByRole("dialog", { name: "Remove My app?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove app" }));
  expect(await within(dialog).findByText("Not allowed")).toBeInTheDocument();
  expect(api.removeApp).toHaveBeenCalledWith(myApp.id);
});

test("removing the Play service account asks first", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp], playServiceAccount: { setAt: "2026-11-21T10:00:00Z", setBy: null, reference: null, email: "x@y.iam.gserviceaccount.com" } }));
  mock(api.removePlayServiceAccount).mockResolvedValue(undefined);
  renderPage();
  await userEvent.click(within(await screen.findByTestId("play-service-account")).getByRole("button", { name: "Replace" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove it" }));
  expect(api.removePlayServiceAccount).not.toHaveBeenCalled();
  const confirm = await screen.findByRole("dialog", { name: "Remove the service account?" });
  await userEvent.click(within(confirm).getByRole("button", { name: "Remove it" }));
  await waitFor(() => expect(api.removePlayServiceAccount).toHaveBeenCalled());
});

test("enforcement: clearing the minutes isn't a change; ready shows only where the mode is Monitor", async () => {
  const ready = { ...myApp, appleTeamId: null, appleBundleId: null, androidPackage: null, webSiteKey: null,
    usage: { database: { today: 500, last7Days: 4000, lastSeen: null }, storage: { today: 500, last7Days: 4000, lastSeen: null } } };
  mock(api.integrity).mockResolvedValue(integrity({ apps: [ready], enforcement: { ...integrity().enforcement, storage: "enforce" } }));
  renderPage();
  await userEvent.click(within(await screen.findByTestId("integrity-enforcement")).getByRole("button", { name: "Change…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getAllByText("✓ ready")).toHaveLength(1);   // database; storage is already enforced
  expect(within(dialog).getByText(MODE_ENFORCE)).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText("Reason for the change"), "Shorter");
  await userEvent.clear(within(dialog).getByLabelText("Tokens last (minutes)"));
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
});

test("adding: fields changed after the app was made are saved once on retry (by its id, never a new id), then the secret key", async () => {
  mock(api.addApp).mockResolvedValue({ id: "my-app" });
  mock(api.updateApp).mockResolvedValue({});
  mock(api.setTurnstileSecret).mockRejectedValueOnce(new Error("Secrets are unavailable")).mockResolvedValueOnce({});
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add app" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("App name"), "My app");
  await userEvent.type(within(dialog).getByLabelText("Turnstile site key"), "0x4AAAAAAAsitekey123");
  await userEvent.type(within(dialog).getByLabelText("Turnstile secret key"), "0x4AAAAAAAsecret12345");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add app" }));
  await within(dialog).findByText(/its Turnstile secret key wasn't saved/);
  await userEvent.type(within(dialog).getByLabelText("Apple bundle id"), "com.example.myapp");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save secret key" }));
  expect(await screen.findByRole("button", { name: /Download winche_options.dart/ })).toBeInTheDocument();
  expect(api.addApp).toHaveBeenCalledTimes(1);
  expect(api.updateApp).toHaveBeenCalledTimes(1);
  const [id, fields] = mock(api.updateApp).mock.calls[0];
  expect(id).toBe("my-app");
  expect(fields).not.toHaveProperty("id");
  expect(fields).toMatchObject({ name: "My app", appleBundleId: "com.example.myapp", webSiteKey: "0x4AAAAAAAsitekey123" });
  expect(api.setTurnstileSecret).toHaveBeenLastCalledWith("my-app", "0x4AAAAAAAsecret12345", null);
  expect(mock(api.updateApp).mock.invocationCallOrder[0]).toBeLessThan(mock(api.setTurnstileSecret).mock.invocationCallOrder[1]);
});

test("a debug token that arrives after its dialog was closed isn't shown when it's opened again", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp] }));
  let arrive!: (t: { id: string; app: string; name: string; token: string }) => void;
  mock(api.makeDebugToken).mockImplementation(() => new Promise((r) => { arrive = r; }));
  renderPage();
  const tokens = await screen.findByTestId("integrity-debug-tokens");
  await userEvent.click(within(tokens).getByRole("button", { name: "Make debug token" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Name"), "CI");
  await userEvent.click(within(dialog).getByRole("button", { name: "Make token" }));
  await waitFor(() => expect(api.makeDebugToken).toHaveBeenCalled());
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  arrive({ id: "dt-2", app: myApp.id, name: "CI", token: "wdt_late-value" });
  await userEvent.click(within(tokens).getByRole("button", { name: "Make debug token" }));
  const again = await screen.findByRole("dialog");
  expect(within(again).getByLabelText("Name")).toHaveValue("");
  expect(within(again).getByRole("button", { name: "Make token" })).not.toHaveAttribute("data-loading");
  expect(screen.queryByTestId("debug-token-value")).toBeNull();
  expect(screen.queryByText("wdt_late-value")).toBeNull();
});

test("removing the Play service account: Escape leaves its dialog open; a failure is shown; once removed, both dialogs close", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [myApp], playServiceAccount: { setAt: "2026-11-21T10:00:00Z", setBy: null, reference: null, email: "x@y.iam.gserviceaccount.com" } }));
  mock(api.removePlayServiceAccount).mockRejectedValueOnce(new Error("Secrets are unavailable")).mockResolvedValueOnce(undefined);
  renderPage();
  await userEvent.click(within(await screen.findByTestId("play-service-account")).getByRole("button", { name: "Replace" }));
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Google service account" })).getByRole("button", { name: "Remove it" }));
  await screen.findByRole("dialog", { name: "Remove the service account?" });
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove the service account?" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Google service account" })).toBeInTheDocument();

  await userEvent.click(within(screen.getByRole("dialog", { name: "Google service account" })).getByRole("button", { name: "Remove it" }));
  const confirm = await screen.findByRole("dialog", { name: "Remove the service account?" });
  await userEvent.click(within(confirm).getByRole("button", { name: "Remove it" }));
  expect(await within(confirm).findByText("Secrets are unavailable")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Google service account" })).toBeInTheDocument();
  await userEvent.click(within(confirm).getByRole("button", { name: "Remove it" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.removePlayServiceAccount).toHaveBeenCalledTimes(2);
});
