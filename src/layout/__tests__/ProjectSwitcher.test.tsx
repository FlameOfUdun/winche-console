import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProjectPicker } from "../ProjectSwitcher";
import { ProjectsPage } from "../../pages/server/ProjectsPage";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, projects: vi.fn(), createServerProject: vi.fn(), checkProjectDatabase: vi.fn(), projectImage: vi.fn(), restoreProject: vi.fn(), deleteProject: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const records = { id: "records", name: "My records", consoleUrl: "/console/projects/records", imageVersion: null };
const boards = { id: "boards", name: "Team boards", consoleUrl: "/console/projects/boards", imageVersion: null };

const renderIt = (page = <ProjectPicker name="My records" id="records" />) => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
);

const openPicker = async () => {
  await waitFor(() => expect(screen.getByRole("button", { name: "Switch project" })).not.toBeDisabled());
  await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
};

let assigned: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  assigned = [];
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: (u: string) => assigned.push(u) } });
});

test("only one project: an empty state; an admin adds one in a dialog, and its console opens", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: true, current: "records", projects: [records] });
  mock(api.createServerProject).mockResolvedValue({ id: "team-boards", name: "Team boards", consoleUrl: "/console/projects/team-boards" });
  renderIt();
  await openPicker();
  expect(await screen.findByTestId("projects-empty")).toHaveTextContent("Only this project");
  await userEvent.click(screen.getByText("Add a project"));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Project name"), "Team boards");
  expect(within(dialog).getByLabelText("Project id")).toHaveValue("team-boards");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(api.createServerProject).toHaveBeenCalledWith("Team boards", "team-boards", null));
  await waitFor(() => expect(assigned).toEqual(["/console/projects/team-boards/overview"]));
});

test("a new project's database on another PostgreSQL server: checked, then made there", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: true, current: "records", projects: [records] });
  mock(api.checkProjectDatabase).mockResolvedValueOnce({ ok: false, problem: "Couldn't connect: password authentication failed", version: null, exists: false, rowsToCopy: 0 })
    .mockResolvedValue({ ok: true, problem: null, version: "17.2", exists: false, rowsToCopy: 0 });
  mock(api.createServerProject).mockResolvedValue({ id: "team-boards", name: "Team boards", consoleUrl: "/console/projects/team-boards" });
  renderIt();
  await openPicker();
  await userEvent.click(await screen.findByText("Add a project"));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Project name"), "Team boards");
  await userEvent.click(within(dialog).getByText("Another PostgreSQL server"));
  await userEvent.type(within(dialog).getByLabelText("Host"), "db.example.com");
  await userEvent.type(within(dialog).getByLabelText("User"), "winche");
  await userEvent.type(within(dialog).getByLabelText("Password"), "nope");
  await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
  expect(await within(dialog).findByText(/password authentication failed/)).toBeInTheDocument();
  await userEvent.clear(within(dialog).getByLabelText("Password"));
  await userEvent.type(within(dialog).getByLabelText("Password"), "s3cret");
  await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
  expect(await within(dialog).findByText(/Ready: PostgreSQL 17.2/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(api.createServerProject).toHaveBeenCalledWith("Team boards", "team-boards",
    { host: "db.example.com", port: 5432, username: "winche", password: "s3cret", sslMode: "Require", database: "" }));
});

test("other projects open their own console; non-admins can't add", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: false, current: "records", projects: [records, boards] });
  renderIt();
  await openPicker();
  await userEvent.click(await screen.findByText("Team boards"));
  expect(assigned).toEqual(["/console/projects/boards/overview"]);
  expect(screen.queryByText("Add a project")).toBeNull();
});

test("a console that runs one project shows just its name, with nothing to pick", async () => {
  mock(api.projects).mockResolvedValue({ available: false, canCreate: false, current: "records", projects: [] });
  renderIt();
  await waitFor(() => expect(screen.getByRole("button", { name: "Switch project" })).toBeDisabled());
  expect(screen.getByText("My records")).toBeInTheDocument();
});

test("the projects page lists every project, each opening its console", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: true, current: "records",
    projects: [{ ...records, products: ["authentication", "database"] }, boards] });
  renderIt(<ProjectsPage />);
  const cards = await screen.findAllByTestId("project-card");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).queryByText("First project")).toBeNull();   // no project is special
  expect(within(cards[0]).getByText("Database")).toBeInTheDocument();
  expect(within(cards[0]).getByText("Storage off")).toBeInTheDocument();
  expect(within(cards[1]).queryByTestId("project-products")).toBeNull();   // a host that doesn't say
  await userEvent.click(cards[1]);
  expect(assigned).toEqual(["/console/projects/boards/overview"]);
  expect(screen.getByRole("button", { name: "Add project" })).toBeInTheDocument();
});

test("server admins restore an archived project, or delete one after typing its id", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: true, current: "records", projects: [records],
    archived: [{ id: "boards", name: "Team boards", archivedAt: "2026-11-14T10:00:00Z" }] });
  mock(api.restoreProject).mockResolvedValue(undefined);
  mock(api.deleteProject).mockResolvedValue(undefined);
  renderIt(<ProjectsPage />);
  const row = await screen.findByTestId("archived-project");
  await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(api.restoreProject).toHaveBeenCalledWith("boards"));
  await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
  const confirm = await screen.findByRole("dialog", { name: /Delete Team boards/ });
  const button = within(confirm).getByRole("button", { name: "Delete for good" });
  expect(button).toBeDisabled();
  await userEvent.type(within(confirm).getByRole("textbox"), "boards");
  await userEvent.click(button);
  await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith("boards"));
});
