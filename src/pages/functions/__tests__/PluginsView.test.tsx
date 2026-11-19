import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { PluginsTab, suggestId, upgradeChanges, secretFor } from "../PluginsView";
import { api } from "../../../api/client";
import type { InstalledPlugin, PluginManifest } from "../../../api/functions";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, plugins: vi.fn(), pluginCatalog: vi.fn(), pluginPackage: vi.fn(), installPlugin: vi.fn(), configurePlugin: vi.fn(),
      upgradePlugin: vi.fn(), uninstallPlugin: vi.fn(), setFunctionSecret: vi.fn(), functionSecrets: vi.fn(), secretSources: vi.fn(),
    },
  };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const manifest: PluginManifest = {
  title: "Text messages", description: "Sends texts.", icon: "message", access: ["Updates the queue collection's documents."],
  settings: [
    { name: "FROM", label: "From number", description: null, type: "string", required: true, default: null, options: null },
    { name: "QUEUE", label: "Queue collection", description: null, type: "string", required: false, default: "sms", options: null },
  ],
  secrets: [{ name: "AUTH_TOKEN", label: "Auth token", description: null, required: true }],
};
const installed: InstalledPlugin = {
  id: "sms", package: "@acme/winche-plugin-sms", version: "1.0.0", latest: "1.1.0", update: true, curated: true,
  settings: { FROM: "+44", QUEUE: "sms" }, source: "console", by: "ann@example.com", at: "2026-11-19T10:00:00Z", manifest,
  secrets: [{ name: "AUTH_TOKEN", secret: "SMS__AUTH_TOKEN" }], secretsNeeded: ["SMS__AUTH_TOKEN"], functions: ["sms.queued", "sms.send"],
};

function renderTab() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><PluginsTab /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.plugins).mockResolvedValue({ plugins: [] });
  mock(api.pluginCatalog).mockResolvedValue({ plugins: [{ package: "@acme/winche-plugin-sms", version: "1.0.0", title: "Text messages", description: "Sends texts.", icon: null, problem: null }] });
  mock(api.pluginPackage).mockResolvedValue({ package: "@acme/winche-plugin-sms", version: "1.0.0", manifest });
  mock(api.installPlugin).mockResolvedValue({ version: 3, note: "Installed sms" });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [] });
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, sources: [], keys: [] });
});

test("a plugin from the catalog is installed with its settings and secret, after seeing what it does", async () => {
  renderTab();
  expect(await screen.findByText("No plugins yet")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add plugin" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(await within(dialog).findByRole("button", { name: "Choose" }));
  expect(await within(dialog).findByText("Updates the queue collection's documents.")).toBeInTheDocument();
  expect(within(dialog).queryByText("Not in this server's catalog")).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText(/Install as/)).toHaveValue("sms");
  const install = within(dialog).getByRole("button", { name: "Install" });
  expect(install).toBeDisabled();   // From number is needed
  await userEvent.type(within(dialog).getByLabelText(/From number/), "+441");
  await userEvent.type(within(dialog).getByLabelText(/Auth token \(SMS__AUTH_TOKEN\)/), "tok-123");
  await userEvent.click(install);
  await waitFor(() => expect(mock(api.installPlugin)).toHaveBeenCalledWith({ id: "sms", package: "@acme/winche-plugin-sms", version: "1.0.0", settings: { FROM: "+441", QUEUE: "sms" } }));
  expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("SMS__AUTH_TOKEN", "tok-123");
});

test("a package outside the catalog is looked up, with a warning to accept before installing", async () => {
  mock(api.pluginPackage).mockResolvedValue({ package: "someones-plugin", version: "0.3.0", manifest: { ...manifest, settings: [], secrets: [] } });
  renderTab();
  await userEvent.click(await screen.findByRole("button", { name: "Add plugin" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Package"), "someones-plugin");
  await userEvent.click(within(dialog).getByRole("button", { name: "Look up" }));
  expect(await within(dialog).findByText("Not in this server's catalog")).toBeInTheDocument();
  const install = within(dialog).getByRole("button", { name: "Install" });
  expect(install).toBeDisabled();
  await userEvent.click(within(dialog).getByLabelText(/I trust this package/));
  expect(install).toBeEnabled();
  expect(mock(api.pluginPackage)).toHaveBeenCalledWith("someones-plugin", null);
});

test("an installed copy shows what it needs, saves settings, upgrades with what changes, and is removed with its secrets", async () => {
  mock(api.plugins).mockResolvedValue({ plugins: [installed] });
  mock(api.configurePlugin).mockResolvedValue({ version: 4, note: "Changed" });
  mock(api.upgradePlugin).mockResolvedValue({ version: 5, note: "Upgraded" });
  mock(api.uninstallPlugin).mockResolvedValue({ version: 6, note: "Removed" });
  const next: PluginManifest = { ...manifest, access: [...manifest.access, "Reads users' phone numbers."],
    settings: [...manifest.settings, { name: "REGION", label: "Region", description: null, type: "select", required: true, default: null, options: ["eu", "us"] }] };
  mock(api.pluginPackage).mockResolvedValue({ package: installed.package, version: "1.1.0", manifest: next });
  renderTab();
  const card = await screen.findByTestId("plugin");
  expect(card).toHaveTextContent("Needs a secret");
  expect(card).toHaveTextContent("1.1.0 is out");
  await userEvent.click(card);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("sms.send")).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole("tab", { name: /Settings/ }));
  const from = within(dialog).getByLabelText(/From number/);
  await userEvent.clear(from);
  await userEvent.type(from, "+449");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.configurePlugin)).toHaveBeenCalledWith("sms", { FROM: "+449", QUEUE: "sms" }));

  await userEvent.click(within(dialog).getByRole("tab", { name: /Version/ }));
  expect(await within(dialog).findByText(/It now says: Reads users' phone numbers/)).toBeInTheDocument();
  const upgrade = within(dialog).getByRole("button", { name: "Upgrade to 1.1.0" });
  expect(upgrade).toBeDisabled();   // Region is needed
  await userEvent.click(within(dialog).getByRole("textbox", { name: /Region/ }));
  await userEvent.click(await screen.findByRole("option", { name: "eu" }));
  await userEvent.click(upgrade);
  await waitFor(() => expect(mock(api.upgradePlugin)).toHaveBeenCalledWith("sms", "1.1.0", { REGION: "eu" }));

  await userEvent.click(within(dialog).getByRole("tab", { name: /Overview/ }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove plugin" }));
  const confirm = await screen.findByRole("dialog", { name: /Remove Text messages/ });
  expect(confirm).toHaveTextContent("Also remove its secrets: SMS__AUTH_TOKEN");
  await userEvent.click(within(confirm).getByRole("checkbox"));
  await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(mock(api.uninstallPlugin)).toHaveBeenCalledWith("sms", true));
});

test("ids, secret names and upgrade changes", () => {
  expect(suggestId("@acme/winche-plugin-sms")).toBe("sms");
  expect(suggestId("payments-plugin")).toBe("payments");
  expect(secretFor("sms-alerts", "AUTH_TOKEN")).toBe("SMS_ALERTS__AUTH_TOKEN");
  const c = upgradeChanges(manifest, { ...manifest, settings: manifest.settings.slice(1), secrets: [] });
  expect(c.goneSettings.map((s) => s.name)).toEqual(["FROM"]);
  expect(c.goneSecrets.map((s) => s.name)).toEqual(["AUTH_TOKEN"]);
  expect(c.newAccess).toEqual([]);
});
