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
  mock(api.plugins).mockResolvedValue({ plugins: [], functionsUrl: "https://api.example.com/projects/clinic/functions/v1/http" });
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

test("browse: the server's catalog, then the rest of what search finds", async () => {
  renderAt("/plugins/browse");
  const cards = await screen.findAllByTestId("package");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveTextContent("In the catalog");
  expect(cards[0]).toHaveTextContent("by Acme");
  expect(cards[1]).toHaveTextContent("other-plugin");
  expect(cards[1]).toHaveTextContent("Not in the catalog");
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

test("an installed copy: its setup steps with its own addresses and settings, what it needs, its history", async () => {
  mock(api.plugins).mockResolvedValue({ plugins: [installed], functionsUrl: "https://api.example.com/projects/clinic/functions/v1/http" });
  mock(api.pluginHistory).mockResolvedValue({ history: [
    { version: 5, what: "Settings changed: OFFICE_PHONE", note: "Changed calls's settings", by: "ann@example.com", at: "2026-11-19T11:00:00Z", rolledBackFrom: null },
    { version: 4, what: "Installed @acme/winche-plugin-calls 1.0.0", note: "From the pipeline", by: "ci", at: "2026-11-19T10:00:00Z", rolledBackFrom: null },
  ] });
  renderAt("/plugins/installed/calls");
  const steps = await screen.findAllByTestId("setup-step");
  expect(steps).toHaveLength(2);   // the third needs an address
  expect(steps[0]).toHaveTextContent("Point the number at https://api.example.com/projects/clinic/functions/v1/http/calls.incomingCall (calls ring +442071234567).");
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
