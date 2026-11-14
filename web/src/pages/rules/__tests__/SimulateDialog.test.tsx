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

test("builds the request from who's asking, the document now and what's written — no JSON to type", async () => {
  (api.rulesSimulate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, error: "No rule allows update on users/abc" });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SimulateDialog subsystem="database" rulesJson='{"draft":true}' opened onClose={() => {}} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByText("Update"));
  await userEvent.type(within(dialog).getByLabelText("Document path"), "users/abc");
  expect(within(dialog).getByRole("button", { name: "Simulate" })).toBeDisabled();   // signed in needs a user id
  await userEvent.type(within(dialog).getByLabelText("User id (request.auth.uid)"), "abc");
  await userEvent.type(within(dialog).getByLabelText("Email (optional)"), "ann@example.com");

  // The document now: owner = abc; being written: age 42.
  const existing = within(dialog).getByTestId("existing");
  await userEvent.click(within(existing).getByRole("button", { name: "Add a field" }));
  await userEvent.type(within(existing).getByLabelText("Field name"), "owner");
  await userEvent.type(within(existing).getByLabelText("Value"), "abc");
  const incoming = within(dialog).getByTestId("incoming");
  await userEvent.click(within(incoming).getByRole("button", { name: "Add a field" }));
  await userEvent.type(within(incoming).getByLabelText("Field name"), "age");
  await userEvent.click(within(incoming).getByLabelText("Kind"));
  await userEvent.click(await screen.findByRole("option", { name: "Number" }));
  await userEvent.type(within(incoming).getByLabelText("Value"), "42");

  await userEvent.click(within(dialog).getByRole("button", { name: "Simulate" }));
  await waitFor(() => expect(api.rulesSimulate).toHaveBeenCalledWith("database", {
    rulesJson: '{"draft":true}', operation: "Update", documentPath: "users/abc", structured: true,
    auth: { uid: "abc", claims: { email: "ann@example.com", email_verified: true } },
    existing: { owner: "abc" },
    incoming: { age: { $integer: "42" } },
  }));
  expect(await within(dialog).findByText("Denied")).toBeInTheDocument();
  expect(within(dialog).getByText("No rule allows update on users/abc")).toBeInTheDocument();
});

test("signed out with nothing there: auth and resource are null", async () => {
  (api.rulesSimulate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, error: null });
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <SimulateDialog subsystem="database" rulesJson="{}" opened onClose={() => {}} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Document path"), "posts/p1");
  await userEvent.click(within(dialog).getByText("Signed out"));
  await userEvent.click(within(dialog).getByLabelText("It exists"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Simulate" }));
  await waitFor(() => expect(api.rulesSimulate).toHaveBeenCalledWith("database", expect.objectContaining({ operation: "Get", auth: null, existing: null, incoming: null })));
  expect(await within(dialog).findByText("Allowed")).toBeInTheDocument();
});
