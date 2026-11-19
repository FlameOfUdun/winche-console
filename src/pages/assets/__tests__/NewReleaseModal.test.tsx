import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { NewReleaseModal } from "../NewReleaseModal";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, assetsMissing: vi.fn(), putAssetContent: vi.fn(), publishAssetRelease: vi.fn(), inspectAssetCdnFiles: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const live = {
  channel: "production", release: 3, publishedAt: "2026-11-19T10:00:00Z", note: null, by: null, size: 3, source: null,
  files: [
    { path: "audio/de/objective_completed.wav", hash: "a".repeat(64), size: 2, mimeType: "audio/wav", since: 3 },
    { path: "translations/application_en.json", hash: "b".repeat(64), size: 1, mimeType: "application/json", since: 2 },
  ],
};

beforeEach(() => vi.clearAllMocks());

test("a release from the console: files added into a folder, one taken out, only new contents uploaded, the channel moved", async () => {
  mock(api.assetsMissing).mockImplementation(async (hashes: string[]) => ({ missing: hashes }));
  mock(api.putAssetContent).mockResolvedValue(undefined);
  mock(api.publishAssetRelease).mockResolvedValue({ number: 4 });
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}><NewReleaseModal opened live={live} onClose={onClose} /></QueryClientProvider>
    </MantineProvider>,
  );
  const publish = await screen.findByRole("button", { name: "Publish" });
  expect(publish).toBeDisabled();   // nothing changed yet

  await userEvent.type(screen.getByLabelText("Into folder"), "audio/es/");
  await userEvent.upload(screen.getByTestId("new-release-files"), new File(["hola"], "objective_completed.wav", { type: "audio/wav" }));
  expect(await screen.findByText("audio/es/objective_completed.wav")).toBeInTheDocument();
  expect(screen.getByText("added")).toBeInTheDocument();

  const rows = screen.getAllByTestId("draft-file");
  const translations = rows.find((r) => r.textContent?.includes("translations/application_en.json"))!;
  await userEvent.click(translations.querySelector("button")!);   // Remove
  expect(screen.getByText("removed")).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("What changed"), "Spanish audio");
  await userEvent.click(publish);
  await waitFor(() => expect(mock(api.publishAssetRelease)).toHaveBeenCalled());
  const [files, note, channel] = mock(api.publishAssetRelease).mock.calls[0];
  expect(Object.keys(files).sort()).toEqual(["audio/de/objective_completed.wav", "audio/es/objective_completed.wav"]);
  expect(files["audio/de/objective_completed.wav"].hash).toBe("a".repeat(64));
  expect(files["audio/es/objective_completed.wav"].hash).toBe("b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79");   // SHA-256 of "hola"
  expect(mock(api.putAssetContent)).toHaveBeenCalledWith(files["audio/es/objective_completed.wav"].hash, expect.anything());
  expect([note, channel]).toEqual(["Spanish audio", "production"]);
  expect(onClose).toHaveBeenCalled();
});
