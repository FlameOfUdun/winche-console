import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { PluginsPage } from "../PluginsPage";
import { fillStep, holds, missingSettings, suggestId, secretFor, upgradeChanges } from "../shared";
import { api } from "../../../api/client";
import type { InstalledPlugin, PluginManifest } from "../../../api/functions";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, plugins: vi.fn(), pluginCatalog: vi.fn(), pluginSearch: vi.fn(), pluginPackage: vi.fn(), pluginVersions: vi.fn(), pluginHistory: vi.fn(),
      installPlugin: vi.fn(), configurePlugin: vi.fn(), upgradePlugin: vi.fn(), uninstallPlugin: vi.fn(), setFunctionSecret: vi.fn(), functionSecrets: vi.fn(),
      secretSources: vi.fn(), functions: vi.fn(),
    },
  };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const PKG = "@acme/winche-plugin-calls";
const manifest: PluginManifest = {
  title: "Calls", description: "Click-to-call.", icon: null, billing: "The service charges per minute.",
  access: ["Places calls through your account."],
  settings: [
    { name: "ACCOUNT", label: "Account", description: null, type: "string", required: true, default: null, options: null, section: "Account" },
    { name: "AGENT_PHONE", label: "Whose phone rings first", description: null, type: "select", required: false, default: "account", options: ["account", "office"], section: "Calls" },
    { name: "OFFICE_PHONE", label: "Office phone", description: null, type: "string", required: true, default: null, options: null, section: "Calls", showIf: { setting: "AGENT_PHONE", is: "office" } },
    { name: "PUBLIC_URL", label: "Project address", description: null, type: "string", required: false, default: null, options: null, section: "Account" },
  ],
  secrets: [{ name: "TOKEN", label: "Auth token", description: null, required: true }],
  setup: [
    { text: "Point the number at `{{function:incomingCall}}` (calls ring {{setting:OFFICE_PHONE}}).", showIf: { setting: "AGENT_PHONE", is: "office" } },
    { text: "Keep {{secret:TOKEN}} safe.", showIf: null },
    { text: "Only with an address.", showIf: { setting: "PUBLIC_URL", set: true } },
  ],
};
const installed: InstalledPlugin = {
  id: "calls", package: PKG, version: "1.0.0", latest: "1.0.0", update: false, curated: true,
  settings: { ACCOUNT: "AC1", AGENT_PHONE: "office", OFFICE_PHONE: "+442071234567", PUBLIC_URL: "" }, source: "console", by: "ann@example.com", at: "2026-11-19T10:00:00Z", manifest,
  secrets: [{ name: "TOKEN", secret: "CALLS__TOKEN" }], secretsNeeded: ["CALLS__TOKEN"], functions: ["calls.connect", "calls.incomingCall"],
};

function renderAt(path: string) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/plugins/*" element={<PluginsPage />} /><Route path="*" element={<div>elsewhere</div>} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.plugins).mockResolvedValue({ plugins: [], functionsUrl: "https://api.example.com/projects/demo/functions/v1/http" });
  mock(api.pluginCatalog).mockResolvedValue({ plugins: [{ package: PKG, version: "1.0.0", title: "Calls", description: "Click-to-call.", icon: null, author: "Acme", problem: null }] });
  mock(api.pluginSearch).mockResolvedValue({ results: [
    { package: PKG, version: "1.0.0", description: "dup", publisher: "acme", at: null, provided: false, curated: true },
    { package: "other-plugin", version: "0.2.0", description: "Something else.", publisher: "someone", at: null, provided: false, curated: false },
  ] });
  mock(api.pluginPackage).mockResolvedValue({ package: PKG, version: "1.0.0", manifest, curated: true,
    about: { description: null, author: "Acme", homepage: null, repository: "https://github.com/acme/calls", license: "MIT", readme: "# Calls\n\nRings **your** phone.\n\n<script>alert(1)</script>" } });
  mock(api.pluginVersions).mockResolvedValue({ versions: [{ version: "1.0.0", at: "2026-11-01T00:00:00Z" }] });
  mock(api.installPlugin).mockResolvedValue({ version: 4, note: "Installed calls" });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [] });
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, sources: [], keys: [] });
  mock(api.functions).mockResolvedValue({ current: null, files: [], runtimeProblem: null });
});

test("browse: search on top; the server's catalog, then npm's most popular; typing searches both", async () => {
  mock(api.pluginSearch).mockImplementation(async (q: string) => ({ results: q ? [
    { package: "texts-plugin", version: "1.0.0", description: "Texts.", publisher: "x", at: null, provided: false, curated: false, downloads: 12 },
  ] : [
    { package: PKG, version: "1.0.0", description: "dup", publisher: "acme", at: null, provided: false, curated: true, downloads: 5400 },
    { package: "other-plugin", version: "0.2.0", description: "Something else.", publisher: "someone", at: null, provided: false, curated: false, downloads: 1234567 },
  ] }));
  renderAt("/plugins/browse");
  const search = await screen.findByRole("textbox", { name: "Search plugins" });
  const cards = await screen.findAllByTestId("package");
  expect(search.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();   // the search box comes first
  expect(screen.getByText("Popular on npm")).toBeInTheDocument();
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("In the catalog");
  expect(cards[0]).toHaveTextContent("5.4k/mo");
  expect(cards[1]).toHaveTextContent("other-plugin");
  expect(cards[1]).toHaveTextContent("1.2M/mo");
  expect(cards[1]).toHaveTextContent("Not in the catalog");

  await userEvent.type(search, "call");
  expect(await screen.findByText("Results for “call”")).toBeInTheDocument();
  const hits = await screen.findAllByTestId("package");
  expect(hits.map((h) => h.getAttribute("aria-label"))).toEqual(["Calls", "texts-plugin"]);   // the catalog's match first
  expect(mock(api.pluginSearch)).toHaveBeenLastCalledWith("call");

  // Clear: back to the catalog and npm's most popular.
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(search).toHaveValue("");
  expect(await screen.findByText("Popular on npm")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  await userEvent.type(search, "x{Escape}");
  expect(search).toHaveValue("");
});

test("a package's page: its README as markdown (no raw HTML), what it does and costs, what it asks for", async () => {
  renderAt(`/plugins/browse/package?name=${encodeURIComponent(PKG)}`);
  const readme = await screen.findByTestId("readme");
  expect(within(readme).getByRole("heading", { name: "Calls" })).toBeInTheDocument();
  expect(within(readme).getByText("your").tagName).toBe("STRONG");
  expect(readme.querySelector("script")).toBeNull();
  expect(screen.getByText("The service charges per minute.")).toBeInTheDocument();
  expect(screen.getByText(/and 2 optional settings \(Calls, Account\)/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Install/ })).toHaveAttribute("href", `/plugins/install?name=${encodeURIComponent(PKG)}&version=1.0.0`);
});

test("a package's homepage and source are links only when they're web addresses", async () => {
  mock(api.pluginPackage).mockResolvedValue({ package: PKG, version: "1.0.0", manifest, curated: true,
    about: { description: null, author: "Acme", homepage: "javascript:alert(1)", repository: "https://github.com/acme/calls", license: "MIT", readme: null } });
  renderAt(`/plugins/browse/package?name=${encodeURIComponent(PKG)}`);
  expect(await screen.findByRole("link", { name: /Source/ })).toHaveAttribute("href", "https://github.com/acme/calls");
  expect(screen.queryByRole("link", { name: /Homepage/ })).toBeNull();
});

test("installing step by step: a setting shown and needed only when another says so, then its secret", async () => {
  renderAt(`/plugins/install?name=${encodeURIComponent(PKG)}`);
  await userEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(screen.getByLabelText(/Install as/)).toHaveValue("calls");
  expect(screen.queryByLabelText(/Office phone/)).not.toBeInTheDocument();
  const next = () => screen.getByRole("button", { name: "Next" });
  expect(next()).toBeDisabled();   // Account is needed
  await userEvent.type(screen.getByLabelText(/^Account/), "AC1");
  expect(next()).toBeEnabled();
  await userEvent.click(screen.getByRole("textbox", { name: /Whose phone rings first/ }));
  await userEvent.click(await screen.findByRole("option", { name: "office" }));
  expect(screen.getByLabelText(/Office phone/)).toBeInTheDocument();
  expect(next()).toBeDisabled();   // now the office phone is needed
  await userEvent.type(screen.getByLabelText(/Office phone/), "+442071234567");
  await userEvent.click(next());
  await userEvent.type(screen.getByLabelText(/Auth token/), "tok-1");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Office phone")).toBeInTheDocument();   // in the review
  await userEvent.click(screen.getByRole("button", { name: "Install Calls" }));
  await waitFor(() => expect(mock(api.installPlugin)).toHaveBeenCalledWith({ id: "calls", package: PKG, version: "1.0.0",
    settings: { ACCOUNT: "AC1", AGENT_PHONE: "office", OFFICE_PHONE: "+442071234567" } }));
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("CALLS__TOKEN", "tok-1");
  expect(await screen.findByText("Calls is installed as calls")).toBeInTheDocument();
});

test("installing: a secret reference that isn't one stops the wizard before anything is installed", async () => {
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, keys: [], sources: [{ name: "aws-sm", title: "AWS Secrets Manager", hint: "" }] });
  renderAt(`/plugins/install?name=${encodeURIComponent(PKG)}`);
  await userEvent.click(await screen.findByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText(/^Account/), "AC1");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByText("Reference"));
  await userEvent.type(screen.getByLabelText(/Auth token.*\(reference\)/), "not-a-reference");
  expect(screen.getByText("Not a reference")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText(/Auth token.*\(reference\)/));
  await userEvent.type(screen.getByLabelText(/Auth token.*\(reference\)/), "aws-sm:calls-token");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Install Calls" }));
  await waitFor(() => expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("CALLS__TOKEN", "\u0000ref:aws-sm:calls-token"));
  expect(mock(api.installPlugin)).toHaveBeenCalledTimes(1);
});

test("installing: a secret that fails to save after the install; trying again sends only that secret, never a second install", async () => {
  mock(api.pluginPackage).mockResolvedValue({ package: PKG, version: "1.0.0", curated: true, about: null,
    manifest: { ...manifest, secrets: [...manifest.secrets, { name: "SIGNING", label: "Signing key", description: null, required: false }] } });
  mock(api.setFunctionSecret).mockImplementation(async (name: string) => { if (name === "CALLS__SIGNING") throw new Error("Can't write to AWS"); });
  renderAt(`/plugins/install?name=${encodeURIComponent(PKG)}`);
  await userEvent.click(await screen.findByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText(/^Account/), "AC1");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText(/Auth token/), "tok-1");
  await userEvent.type(screen.getByLabelText(/Signing key/), "sig-1");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Install Calls" }));
  expect(await screen.findByText(/Can't write to AWS/)).toBeInTheDocument();
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("CALLS__TOKEN", "tok-1");

  mock(api.setFunctionSecret).mockClear();
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  await userEvent.click(screen.getByRole("button", { name: "Save secrets" }));
  expect(await screen.findByText("Calls is installed as calls")).toBeInTheDocument();
  expect(mock(api.installPlugin)).toHaveBeenCalledTimes(1);
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledTimes(1);
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("CALLS__SIGNING", "sig-1");
});

test("installing: after a failed secret, a setting changed going back and a saved secret edited are both sent on the retry", async () => {
  mock(api.pluginPackage).mockResolvedValue({ package: PKG, version: "1.0.0", curated: true, about: null,
    manifest: { ...manifest, secrets: [...manifest.secrets, { name: "SIGNING", label: "Signing key", description: null, required: false }] } });
  mock(api.setFunctionSecret).mockImplementation(async (name: string) => { if (name === "CALLS__SIGNING") throw new Error("Can't write to AWS"); });
  mock(api.configurePlugin).mockResolvedValue({ version: 2, note: "" });
  renderAt(`/plugins/install?name=${encodeURIComponent(PKG)}`);
  await userEvent.click(await screen.findByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText(/^Account/), "AC1");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText(/Auth token/), "tok-1");
  await userEvent.type(screen.getByLabelText(/Signing key/), "sig-1");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Install Calls" }));
  expect(await screen.findByText(/Can't write to AWS/)).toBeInTheDocument();

  // Back: the account changed, and the token (already saved) typed again.
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.clear(screen.getByLabelText(/^Account/));
  await userEvent.type(screen.getByLabelText(/^Account/), "AC2");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.clear(screen.getByLabelText(/Auth token/));
  await userEvent.type(screen.getByLabelText(/Auth token/), "tok-2");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  mock(api.setFunctionSecret).mockClear();
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  await userEvent.click(screen.getByRole("button", { name: /Install Calls|Save secrets/ }));
  expect(await screen.findByText("Calls is installed as calls")).toBeInTheDocument();
  expect(mock(api.installPlugin)).toHaveBeenCalledTimes(1);
  expect(mock(api.configurePlugin)).toHaveBeenCalledWith("calls", expect.objectContaining({ ACCOUNT: "AC2" }));
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("CALLS__TOKEN", "tok-2");
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("CALLS__SIGNING", "sig-1");
});

test("an installed copy: its setup steps with its own addresses and settings, what it needs, its history", async () => {
  mock(api.plugins).mockResolvedValue({ plugins: [installed], functionsUrl: "https://api.example.com/projects/demo/functions/v1/http" });
  mock(api.pluginHistory).mockResolvedValue({ history: [
    { version: 5, what: "Settings changed: OFFICE_PHONE", note: "Changed calls's settings", by: "ann@example.com", at: "2026-11-19T11:00:00Z", rolledBackFrom: null },
    { version: 4, what: "Installed @acme/winche-plugin-calls 1.0.0", note: "From the pipeline", by: "ci", at: "2026-11-19T10:00:00Z", rolledBackFrom: null },
  ] });
  renderAt("/plugins/installed/calls");
  const steps = await screen.findAllByTestId("setup-step");
  expect(steps).toHaveLength(2);   // the third needs an address
  expect(steps[0]).toHaveTextContent("Point the number at https://api.example.com/projects/demo/functions/v1/http/calls.incomingCall (calls ring +442071234567).");
  expect(steps[1]).toHaveTextContent("Keep CALLS__TOKEN safe.");
  expect(screen.getByText(/CALLS__TOKEN isn't set/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "History" }));
  const entries = await screen.findAllByTestId("history-entry");
  expect(entries[0]).not.toHaveTextContent("Changed calls's settings");   // its own note says nothing more
  expect(entries[1]).toHaveTextContent("From the pipeline");
});

test("conditions, setup placeholders, ids and upgrade changes", () => {
  expect(holds({ setting: "A", is: ["x", "y"] }, { A: "y" })).toBe(true);
  expect(holds({ setting: "A", set: true }, { A: "" })).toBe(false);
  expect(holds({ setting: "A", set: false }, { A: "" })).toBe(true);
  expect(missingSettings(manifest.settings, { ACCOUNT: "x", AGENT_PHONE: "account" })).toEqual([]);
  expect(missingSettings(manifest.settings, { ACCOUNT: "x", AGENT_PHONE: "office" }).map((s) => s.name)).toEqual(["OFFICE_PHONE"]);
  expect(fillStep("{{id}} at {{function:hook}} with {{secret:TOKEN}} and {{setting:NOPE}}", "sms", "https://a/functions/v1/http", {}))
    .toBe("sms at https://a/functions/v1/http/sms.hook with SMS__TOKEN and (NOPE isn't set)");
  expect(suggestId("@acme/winche-plugin-sms")).toBe("sms");
  expect(secretFor("sms-alerts", "AUTH_TOKEN")).toBe("SMS_ALERTS__AUTH_TOKEN");
  expect(upgradeChanges(manifest, { ...manifest, secrets: [] }).goneSecrets.map((s) => s.name)).toEqual(["TOKEN"]);
});
