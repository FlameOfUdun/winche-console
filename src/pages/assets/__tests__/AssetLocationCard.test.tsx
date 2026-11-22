import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { AssetLocationCard } from "../AssetsSettingsView";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, assetLocation: vi.fn(), testAssetLocation: vi.fn(), startAssetMove: vi.fn(), secretSources: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.secretSources).mockResolvedValue({ sources: [] });
  mock(api.assetLocation).mockResolvedValue({
    active: { kind: "s3" }, activeLabel: "bucket my-assets", codeLabel: "On this server's disk", move: null, editable: true, secretsAvailable: true,
  });
});

function renderCard() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetLocationCard /></QueryClientProvider>
    </MantineProvider>,
  );
}

async function startMove() {
  renderCard();
  await userEvent.click(await screen.findByRole("button", { name: "Move assets…" }));
  await userEvent.type(screen.getByLabelText("Reason for the move"), "Back home");
  await userEvent.click(screen.getByRole("button", { name: "Start copying" }));
  await waitFor(() => expect(screen.queryByLabelText("Reason for the move")).toBeNull());
  expect(mock(api.startAssetMove)).toHaveBeenCalledWith({ kind: "code" }, null, "Back home");
}

test("a warning from the server stays after the form closes", async () => {
  mock(api.startAssetMove).mockResolvedValue({ warning: "The secret key couldn't be kept in AWS, so it's kept on this server." });
  await startMove();
  expect(await screen.findByTestId("move-warning")).toHaveTextContent("couldn't be kept in AWS");
});

test("nothing answered: no notice", async () => {
  mock(api.startAssetMove).mockResolvedValue(undefined);
  await startMove();
  expect(screen.queryByTestId("move-warning")).toBeNull();
});
