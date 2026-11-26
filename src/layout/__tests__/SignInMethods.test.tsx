import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { SignInMethodsModal, linkUrl } from "../SignInMethods";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, signInMethods: vi.fn(), unlinkSignInMethod: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const renderIt = (error: string | null = null) => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient()}>
      <SignInMethodsModal opened onClose={() => {}} error={error} />
    </QueryClientProvider>
  </MantineProvider>,
);

test("lists the password and each provider; one is removed after a confirmation", async () => {
  mock(api.signInMethods).mockResolvedValue({ password: true, providers: [{ id: "staff", label: "Staff ID", linked: true }, { id: "partner", label: "Partner ID", linked: false }] });
  mock(api.unlinkSignInMethod).mockResolvedValue(undefined);
  renderIt();
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("Password")).toBeInTheDocument();
  expect(within(dialog).getByText("Staff ID")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Add Partner ID" })).toHaveAttribute("href", expect.stringContaining("provider=partner&link=true"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove Staff ID" }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api.unlinkSignInMethod).toHaveBeenCalledWith("staff"));
});

test("an add that came back refused says why", async () => {
  mock(api.signInMethods).mockResolvedValue({ password: true, providers: [{ id: "staff", label: "Staff ID", linked: false }] });
  renderIt("That account at the provider already signs in to another console account.");
  expect(await screen.findByText(/already signs in to another console account/)).toBeInTheDocument();
});

test("the add link comes back to this page with the dialog open", () => {
  const url = linkUrl("staff", "/console/projects/p/");
  expect(url).toContain("/console/v1/session/oidc/start?provider=staff&link=true&returnUrl=");
  expect(decodeURIComponent(url.split("returnUrl=")[1])).toBe("/console/projects/p/?signInMethods=1");
});
