import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { vi, expect, test, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ResetPasswordPage } from "../ResetPasswordPage";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, resetPassword: vi.fn(), removeSignInMethod: vi.fn(), authConfig: vi.fn().mockResolvedValue({}) } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const at = (url: string) => render(<MantineProvider><MemoryRouter initialEntries={[url]}><ResetPasswordPage /></MemoryRouter></MantineProvider>);

beforeEach(() => vi.clearAllMocks());

test("a 'sign-in method added' link asks, then removes it: never a password form", async () => {
  mock(api.removeSignInMethod).mockResolvedValue(undefined);
  at("/reset-password?mode=unlinkProvider&code=abc");
  expect(screen.queryByLabelText("New password")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
  await waitFor(() => expect(screen.getByText("It's removed")).toBeTruthy());
  expect(api.removeSignInMethod).toHaveBeenCalledWith("abc");
  expect(api.resetPassword).not.toHaveBeenCalled();
});

test("removing the last way in says how to get back: by email, or a server admin", async () => {
  mock(api.removeSignInMethod).mockResolvedValue({ next: "admin" });
  at("/reset-password?mode=unlinkProvider&code=abc");
  await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
  expect(await screen.findByText(/ask a server admin to set a new password/)).toBeTruthy();
});

test("a reset link still asks for a new password", () => {
  at("/reset-password?mode=resetPassword&code=abc");
  expect(screen.getByLabelText("New password")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove it" })).toBeNull();
});
