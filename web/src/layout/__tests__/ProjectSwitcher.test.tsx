import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { ProjectSwitcher } from "../ProjectSwitcher";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, projects: vi.fn(), createServerProject: vi.fn(), projectImage: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const clinic = { id: "clinic", name: "Clinic records", consoleUrl: "/_console", imageVersion: null };
const wards = { id: "wards", name: "Ward boards", consoleUrl: "/p/wards/_console", imageVersion: null };

const renderIt = () => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectSwitcher name="Clinic records" id="clinic" collapsed={false} logo={<span />} />
    </QueryClientProvider>
  </MantineProvider>,
);

let assigned: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  assigned = [];
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: (u: string) => assigned.push(u) } });
});

test("only one project: an empty state; an admin adds one in a dialog, and its console opens", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: true, current: "clinic", projects: [clinic] });
  mock(api.createServerProject).mockResolvedValue({ id: "ward-boards", name: "Ward boards", consoleUrl: "/p/ward-boards/_console" });
  renderIt();
  await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
  expect(await screen.findByTestId("projects-empty")).toHaveTextContent("Only this project");
  await userEvent.click(screen.getByText("Add a project"));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Project name"), "Ward boards");
  expect(within(dialog).getByLabelText("Project id")).toHaveValue("ward-boards");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(api.createServerProject).toHaveBeenCalledWith("Ward boards", "ward-boards"));
  await waitFor(() => expect(assigned).toEqual(["/p/ward-boards/_console/overview"]));
});

test("other projects open their own console; non-admins can't add", async () => {
  mock(api.projects).mockResolvedValue({ available: true, canCreate: false, current: "clinic", projects: [clinic, wards] });
  renderIt();
  await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
  await userEvent.click(await screen.findByText("Ward boards"));
  expect(assigned).toEqual(["/p/wards/_console/overview"]);
  expect(screen.queryByText("Add a project")).toBeNull();
});

test("a console that runs one project lists just it", async () => {
  mock(api.projects).mockResolvedValue({ available: false, canCreate: false, current: "clinic", projects: [] });
  renderIt();
  await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
  expect(await screen.findByTestId("projects-empty")).toHaveTextContent("This console runs one project.");
  expect(screen.queryByText("Add a project")).toBeNull();
});
