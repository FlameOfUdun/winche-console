import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { AcceptInvitePage } from "../AcceptInvitePage";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, invitePreview: vi.fn(), acceptInvite: vi.fn() } };
});

function renderPage() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/invite?token=abc"]}>
        <AcceptInvitePage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test("previews the invite and accepts", async () => {
  (api.invitePreview as ReturnType<typeof vi.fn>).mockResolvedValue({
    email: "invitee@example.com", firstName: null, lastName: null, requireName: false, requireTwoFactor: false,
  });
  (api.acceptInvite as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  renderPage();

  await waitFor(() => expect(screen.getByText("invitee@example.com")).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText("Password"), "Inv1ted!");
  await userEvent.click(screen.getByRole("button", { name: /set password/i }));

  await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledWith(
    expect.objectContaining({ token: "abc", password: "Inv1ted!" }),
  ));
});

test("shows an error for an invalid invite", async () => {
  (api.invitePreview as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("gone"));
  renderPage();
  await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument());
});
