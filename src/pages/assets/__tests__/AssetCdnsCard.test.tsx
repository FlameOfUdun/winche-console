import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { AssetCdnsCard } from "../AssetsSettingsView";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, assetCdns: vi.fn(), saveAssetCdn: vi.fn(), testAssetCdn: vi.fn(), secretSources: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const media = { id: "media", kind: "cloudfront", baseUrl: "https://cdn.example.com/app/", keyPairId: "K2KEY", linkMinutes: 10,
  key: { setAt: "2026-11-19T10:00:00Z", setBy: "ann@example.com", reference: "aws-sm:platform/app/cdn-key" } };

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.secretSources).mockResolvedValue({ sources: [{ name: "aws-sm", title: "AWS Secrets Manager" }] });
});

function renderCard() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetCdnsCard /></QueryClientProvider>
    </MantineProvider>,
  );
}

test("no CDNs: what they're for", async () => {
  mock(api.assetCdns).mockResolvedValue({ cdns: [], editable: true, secretsAvailable: true });
  renderCard();
  expect(await screen.findByText("No CDNs")).toBeInTheDocument();
});

test("a CDN shows where its key comes from, tests a file, and a new one is saved with its key", async () => {
  mock(api.assetCdns).mockResolvedValue({ cdns: [media], editable: true, secretsAvailable: true });
  mock(api.testAssetCdn).mockResolvedValue({ ok: true, status: 200, message: "The CDN took the signed link." });
  mock(api.saveAssetCdn).mockResolvedValue(undefined);
  renderCard();
  const row = (await screen.findByTestId("asset-cdns")).querySelector("tr")!;
  expect(within(row).getByText("Key from aws-sm:platform/app/cdn-key")).toBeInTheDocument();

  await userEvent.click(within(row).getByRole("button", { name: "Test" }));
  const address = await screen.findByLabelText("A file on it");
  await userEvent.type(address, "bvm.mp4");
  await userEvent.click(screen.getAllByRole("button", { name: "Test" }).at(-1)!);
  expect(await screen.findByTestId("asset-cdn-test")).toHaveTextContent("The CDN took the signed link.");
  expect(mock(api.testAssetCdn)).toHaveBeenCalledWith("media", "https://cdn.example.com/app/bvm.mp4");
  await userEvent.keyboard("{Escape}");

  await userEvent.click(screen.getByRole("button", { name: "Add a CDN" }));
  const save = await screen.findByRole("button", { name: "Save" });
  await userEvent.type(screen.getByLabelText("Name"), "videos");
  await userEvent.type(screen.getByLabelText("Base address"), "https://videos.example.com/");
  await userEvent.type(screen.getByLabelText("Key pair id"), "K3KEY");
  await userEvent.type(screen.getByLabelText("Why"), "Videos");
  expect(save).toBeDisabled();   // a new CDN needs its key
  await userEvent.type(screen.getByLabelText("Private key"), "-----BEGIN PRIVATE KEY-----");
  await userEvent.click(save);
  await waitFor(() => expect(mock(api.saveAssetCdn)).toHaveBeenCalledWith("videos",
    { kind: "cloudfront", baseUrl: "https://videos.example.com/", keyPairId: "K3KEY", linkMinutes: 10 }, "-----BEGIN PRIVATE KEY-----", "Videos"));
});

test("a public CDN needs no key pair or key", async () => {
  mock(api.assetCdns).mockResolvedValue({ cdns: [], editable: true, secretsAvailable: true });
  mock(api.saveAssetCdn).mockResolvedValue(undefined);
  renderCard();
  await userEvent.click(await screen.findByRole("button", { name: "Add a CDN" }));
  await userEvent.click(await screen.findByText("Public"));
  expect(screen.queryByLabelText("Key pair id")).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "trucdn");
  await userEvent.type(screen.getByLabelText("Base address"), "https://cdn.example.com/app/");
  await userEvent.type(screen.getByLabelText("Why"), "Videos");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.saveAssetCdn)).toHaveBeenCalledWith("trucdn",
    { kind: "public", baseUrl: "https://cdn.example.com/app/", keyPairId: "", linkMinutes: 10 }, null, "Videos"));
});
