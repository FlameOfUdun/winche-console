import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test } from "vitest";
import { SimulateDialog } from "../SimulateDialog";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, rulesSimulate: vi.fn() } };
});

test("simulates a request against the draft rules in a dialog", async () => {
  (api.rulesSimulate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, error: "No rule allows Get on users/abc" });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SimulateDialog subsystem="database" rulesJson='{"draft":true}' opened onClose={() => {}} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "Simulate" })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("Document path"), "users/abc");
  await userEvent.click(within(dialog).getByRole("button", { name: "Simulate" }));
  await waitFor(() => expect(api.rulesSimulate).toHaveBeenCalledWith("database", expect.objectContaining({ rulesJson: '{"draft":true}', operation: "Get", documentPath: "users/abc" })));
  expect(await within(dialog).findByText("Denied")).toBeInTheDocument();
  expect(within(dialog).getByText("No rule allows Get on users/abc")).toBeInTheDocument();
});
