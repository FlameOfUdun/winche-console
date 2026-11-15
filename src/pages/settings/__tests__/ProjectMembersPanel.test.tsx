import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ProjectMembersPanel } from "../ProjectMembersPanel";
import { RequireProject } from "../../onboarding/RequireProject";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, members: vi.fn(), addMember: vi.fn(), setMemberRole: vi.fn(), removeMember: vi.fn(), projects: vi.fn(), project: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const renderIt = (ui: React.ReactNode) => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
);
const admin = { userId: "a1", email: "admin@example.com", firstName: "Root", lastName: "Admin" };

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ state: { capabilities: { members: true } }, user: { id: "a1", role: "Admin", email: "admin@example.com", member: true } });
});

test("no members: an empty state; adding someone new shows the link to set their password", async () => {
  mock(api.members).mockResolvedValue({ members: [], serverAdmins: [admin] });
  mock(api.addMember).mockResolvedValue({ userId: "b1", newAccount: true, emailed: false, link: "http://x/p/wards/_console/reset-password?token=t" });
  renderIt(<ProjectMembersPanel />);
  expect(await screen.findByText("No members yet")).toBeInTheDocument();
  expect(screen.getByText("Root Admin (you)")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add member" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Email"), "bob@example.com");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add member" }));
  await waitFor(() => expect(api.addMember).toHaveBeenCalledWith("bob@example.com", "Member"));
  expect(await within(dialog).findByTestId("member-link")).toHaveTextContent("reset-password?token=t");
});

test("members are listed with their roles, changed and removed in place", async () => {
  mock(api.members).mockResolvedValue({ serverAdmins: [], members: [
    { userId: "b1", email: "bob@example.com", firstName: null, lastName: null, role: "Member", addedAt: "2026-11-14T00:00:00Z", passwordSet: false },
  ] });
  mock(api.setMemberRole).mockResolvedValue(undefined);
  mock(api.removeMember).mockResolvedValue(undefined);
  renderIt(<ProjectMembersPanel />);
  const row = await screen.findByTestId("member");
  expect(within(row).getByText("Hasn't set a password")).toBeInTheDocument();
  await userEvent.click(within(row).getByLabelText("Role of bob@example.com"));
  await userEvent.click(await screen.findByRole("option", { name: "Viewer" }));
  await waitFor(() => expect(api.setMemberRole).toHaveBeenCalledWith("b1", "Viewer"));
  await userEvent.click(within(row).getByLabelText("Remove bob@example.com"));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith("b1"));
});

test("not a member of this project: says so and offers the projects they are in", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { id: "b1", role: null, email: "bob@example.com", member: false } });
  mock(api.projects).mockResolvedValue({ available: true, canCreate: false, current: "clinic", projects: [{ id: "wards", name: "Wards", consoleUrl: "/p/wards/_console", imageVersion: null }] });
  renderIt(<RequireProject><div>CONSOLE</div></RequireProject>);
  expect(await screen.findByText("You're not in this project")).toBeInTheDocument();
  expect(await screen.findByText("Wards")).toBeInTheDocument();
  expect(screen.queryByText("CONSOLE")).toBeNull();
  expect(api.project).not.toHaveBeenCalled();
});
