import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test } from "vitest";
import { LoginPage } from "../LoginPage";
import { useSession } from "../../auth/session";

vi.mock("../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const renderWith = (oidc: { providers: { id: string; label: string }[]; passwordsOnlyForAdmins: boolean } | null) => {
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ state: { oidc, selfServiceResetEnabled: false }, refresh: vi.fn() });
  return render(<MantineProvider><MemoryRouter><LoginPage /></MemoryRouter></MantineProvider>);
};

test("without a provider: email and password", () => {
  renderWith(null);
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /organization/ })).not.toBeInTheDocument();
});

test("with a provider for everyone: its button first, passwords tucked away for server admins", async () => {
  renderWith({ providers: [{ id: "staff", label: "Sign in with Staff ID" }], passwordsOnlyForAdmins: true });
  expect(screen.getByRole("button", { name: "Sign in with Staff ID" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  await userEvent.click(screen.getByText("Server admin? Sign in with a password"));
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("several providers: a button each, starting that provider's sign-in", async () => {
  const assign = { href: "" };
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, set href(v: string) { assign.href = v; }, get href() { return assign.href; } } });
  renderWith({ providers: [{ id: "staff", label: "Sign in with Staff ID" }, { id: "partner", label: "Sign in with Partner ID" }], passwordsOnlyForAdmins: false });
  expect(screen.getByLabelText("Email")).toBeInTheDocument();   // passwords for everyone
  await userEvent.click(screen.getByRole("button", { name: "Sign in with Partner ID" }));
  expect(assign.href).toContain("session/oidc/start?provider=partner&returnUrl=");
});

test("back from a provider for the account's two-step: the code is asked for at once", () => {
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, search: "?secondStep=1" } });
  renderWith({ providers: [{ id: "staff", label: "Sign in with Staff ID" }], passwordsOnlyForAdmins: false });
  expect(screen.getByText("Enter your code")).toBeInTheDocument();
});

test("Forgot your password? is always there; without email, the page says an admin sets a new one", async () => {
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, search: "" } });
  renderWith(null);
  expect(screen.getByRole("link", { name: "Forgot your password?" })).toBeInTheDocument();
  const { ForgotPasswordPage } = await import("../ForgotPasswordPage");
  render(<MantineProvider><MemoryRouter><ForgotPasswordPage /></MemoryRouter></MantineProvider>);
  expect(screen.getByText(/can't send email yet/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send a reset link" })).not.toBeInTheDocument();
});
