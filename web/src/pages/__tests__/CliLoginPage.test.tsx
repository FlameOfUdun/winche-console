import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { CliLoginPage } from "../CliLoginPage";
import { api } from "../../api/client";
import { useSession } from "../../auth/session";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, approveCliLogin: vi.fn() } };
});
vi.mock("../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});

const challenge = "a".repeat(43);
function renderPage(query: string) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/cli-login?${query}`]}><CliLoginPage /></MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (useSession as ReturnType<typeof vi.fn>).mockReturnValue({ user: { email: "ann@example.com", role: "Admin" } });
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
});

test("allowing the CLI sends the browser back to it with the code", async () => {
  (api.approveCliLogin as ReturnType<typeof vi.fn>).mockResolvedValue({ redirect: "http://127.0.0.1:9005/callback?code=c&state=s" });
  renderPage(`port=9005&state=s&challenge=${challenge}&name=winche%20CLI%20on%20laptop`);
  expect(screen.getByText("winche CLI on laptop")).toBeInTheDocument();
  expect(screen.getByText(/ann@example.com · Admin/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(api.approveCliLogin).toHaveBeenCalledWith({ challenge, port: 9005, state: "s", name: "winche CLI on laptop" }));
  expect(window.location.href).toBe("http://127.0.0.1:9005/callback?code=c&state=s");
});

test("cancelling tells the CLI; an incomplete link says so", async () => {
  const { unmount } = renderPage(`port=9005&state=s&challenge=${challenge}`);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(window.location.href).toContain("http://127.0.0.1:9005/callback?error=access_denied");
  expect(api.approveCliLogin).not.toHaveBeenCalled();
  unmount();
  renderPage("port=80&state=s");
  expect(screen.getByText(/isn't complete/)).toBeInTheDocument();
});
