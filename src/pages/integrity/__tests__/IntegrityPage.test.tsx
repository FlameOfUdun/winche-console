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

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const page = (platforms: string[]): AppsPageData => ({
  setup: { projectId: "demo", name: null, baseUrl: "https://api.example.com", services: [], providers: [] },
  platforms: ["android", "ios", "macos", "web", "windows", "linux"],
  file: platforms.map((p) => `static final ${p} = WincheOptions(`).join("\n"),
  snippet: "WincheFlutter.initializeApp(options: DefaultWincheOptions.currentPlatform)",
});
const PRODUCTS = ["database", "storage", "authentication", "functions", "assets"];
const clinic: IntegrityApp = {
  id: "app-abc234def567", name: "Clinic app", androidPackage: "com.example.clinic", appleBundleId: "com.example.clinic", appleTeamId: "ABCDE12345",
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

test("no apps: an empty state; Add app is one step (name and the platforms' ids, no SDK), then a guide per SDK with its command and download", async () => {
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
  await userEvent.type(within(dialog).getByLabelText("App name"), "Clinic app");
  await userEvent.type(within(dialog).getByLabelText("Android package"), "com.example.clinic");
  await userEvent.type(within(dialog).getByLabelText("Google Cloud project number"), "123456789012");
  await userEvent.type(within(dialog).getByLabelText("Apple bundle id"), "com.example.clinic");
  await userEvent.type(within(dialog).getByLabelText("Turnstile site key"), "0x4AAAAAAAsitekey123");
  await userEvent.type(within(dialog).getByLabelText("Turnstile secret key"), "0x4AAAAAAAsecret12345");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Sites the app runs on" }), "App.Example.com{enter}");
  await userEvent.type(within(dialog).getByLabelText("Apple team id"), "abcde12345");
  expect(within(dialog).getByLabelText("App id")).toHaveValue("clinic-app");   // follows the name until edited
  await userEvent.clear(within(dialog).getByLabelText("App id"));
  await userEvent.type(within(dialog).getByLabelText("App id"), "clinic-ios");
  expect(within(dialog).queryByLabelText("Web addresses")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Add app" }));
  await waitFor(() => expect(api.addApp).toHaveBeenCalledWith({ name: "Clinic app", androidPackage: "com.example.clinic",
    appleBundleId: "com.example.clinic", appleTeamId: "ABCDE12345", appleDevelopment: false, androidCloudProjectNumber: 123456789012,
    androidSideloaded: false, androidDeviceIntegrity: "device", androidCertificates: [], webSiteKey: "0x4AAAAAAAsitekey123", webHostnames: ["app.example.com"], id: "clinic-ios" }));
  expect(api.setTurnstileSecret).toHaveBeenCalledWith("app-abc234def567", "0x4AAAAAAAsecret12345", null);
  expect(await screen.findByText("winche configure --url https://api.example.com --app app-abc234def567")).toBeInTheDocument();
  // The guide: Flutter, the others greyed out; its steps start Integrity too.
  expect(screen.getByRole("tab", { name: "Flutter" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Android" })).toBeDisabled();
  expect(screen.getByText(/winche_functions winche_integrity$/)).toBeInTheDocument();
  expect(screen.getByText(/app.useIntegrity\(WinchePlatformIntegrity/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Download winche_options.dart/ }));
  await waitFor(() => expect(api.apps).toHaveBeenLastCalledWith(["android", "ios", "macos", "web", "windows", "linux"], "app-abc234def567"));
});

test("with apps: each with its identifiers and verified requests; enforcement per product with today's counts, saved with a reason", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic], unverified: { database: { today: 3, last7Days: 5, lastSeen: null } } }));
  mock(api.setIntegrityEnforcement).mockResolvedValue({});
  renderPage();
  const row = await screen.findByTestId("integrity-app");
  expect(within(row).getByText("Clinic app")).toBeInTheDocument();
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
  expect(within(card).getByText(/users' photos/)).toBeInTheDocument();

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
  const ready = { ...clinic, appleTeamId: null, appleBundleId: null, androidPackage: null, webSiteKey: null,
    usage: { database: { today: 500, last7Days: 4000, lastSeen: null } } };
  mock(api.integrity).mockResolvedValue(integrity({ apps: [ready], unverified: { database: { today: 0, last7Days: 10, lastSeen: null } } }));
  renderPage();
  const database = await screen.findByTestId("enforcement-database");
  expect(database).toHaveTextContent("99% verified · 7 days");
  expect(database).toHaveTextContent("✓ ready to enforce");
  expect(screen.getByTestId("enforcement-storage")).toHaveTextContent("no requests yet");
});

test("a debug token is made for an app and shown once; removing one asks first", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic],
    debugTokens: [{ id: "dt-1", app: clinic.id, name: "Ann's simulator", createdAt: "2026-11-20T10:00:00Z", createdBy: "admin@example.com" }] }));
  mock(api.makeDebugToken).mockResolvedValue({ id: "dt-2", app: clinic.id, name: "CI", token: "wdt_secret-value" });
  mock(api.removeDebugToken).mockResolvedValue(undefined);
  renderPage();
  const tokens = await screen.findByTestId("integrity-debug-tokens");
  expect(within(tokens).getByText("Ann's simulator")).toBeInTheDocument();
  expect(within(tokens).getByText("Clinic app")).toBeInTheDocument();

  await userEvent.click(within(tokens).getByRole("button", { name: "Make debug token" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Name"), "CI");
  await userEvent.click(within(dialog).getByRole("button", { name: "Make token" }));
  await waitFor(() => expect(api.makeDebugToken).toHaveBeenCalledWith(clinic.id, "CI"));
  expect(await screen.findByTestId("debug-token-value")).toHaveTextContent("wdt_secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Done" }));

  await userEvent.click(within(tokens).getByRole("button", { name: "Remove Ann's simulator" }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove token" }));
  await waitFor(() => expect(api.removeDebugToken).toHaveBeenCalledWith("dt-1"));
});

test("viewers see it all and change nothing; without a master key it says so", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic], editable: false, canSign: false }));
  renderPage();
  expect(await screen.findByTestId("integrity-app")).toBeInTheDocument();
  expect(screen.getByText(/no master key/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add app" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Make debug token" })).toBeNull();
  expect(within(screen.getByTestId("integrity-enforcement")).queryByRole("button", { name: "Edit" })).toBeNull();
});

test("Play Integrity: an Android app needs the service account; its key file is set write-only and its address shown", async () => {
  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic] }));
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

  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic], playServiceAccount: { setAt: "2026-11-21T10:00:00Z", setBy: "admin@example.com", reference: null, email: "x@y.iam.gserviceaccount.com" } }));
  renderPage();
  expect(await screen.findByText("x@y.iam.gserviceaccount.com")).toBeInTheDocument();
});

test("readiness: ready once everything is set; an app with nothing set has debug tokens only; enforcing with an app not ready warns", async () => {
  const { readiness } = await import("../IntegrityPage");
  const account = { setAt: "2026-11-21T10:00:00Z", setBy: null, reference: null, email: "x@y.iam.gserviceaccount.com" };
  const ready = { ...clinic, turnstileSecret: { setAt: "2026-11-21T10:00:00Z", setBy: null, reference: null } };
  expect(readiness(ready, { playServiceAccount: account, debugTokens: [] }).map((r) => [r.platform, r.color])).toEqual([["apple", "teal"], ["android", "teal"], ["web", "teal"]]);
  expect(readiness({ ...ready, appleTeamId: null, androidCloudProjectNumber: null }, { playServiceAccount: account, debugTokens: [] }).map((r) => r.label))
    .toEqual(["Apple: needs its team id", "Android: needs its Cloud project number", "Web: ready"]);
  expect(readiness({ ...ready, devices: null }, { playServiceAccount: account, debugTokens: [] })[0].label).toBe("Apple: ready, no devices yet");
  const bare = { ...clinic, appleBundleId: null, appleTeamId: null, androidPackage: null, webSiteKey: null };
  expect(readiness(bare, { playServiceAccount: null, debugTokens: [] })[0].label).toBe("No way to prove itself yet");
  expect(readiness(bare, { playServiceAccount: null, debugTokens: [{ id: "dt-1", app: clinic.id, name: "CI", createdAt: "", createdBy: null }] })[0].label).toBe("Debug tokens only (1)");

  mock(api.integrity).mockResolvedValue(integrity({ apps: [clinic], enforcement: { ...integrity().enforcement, database: "enforce" } }));
  renderPage();
  expect(await screen.findByTestId("enforced-not-ready")).toHaveTextContent("not every app can prove itself yet");
});
