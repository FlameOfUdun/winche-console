import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { ProjectSwitcher } from "../ProjectSwitcher";
import { api } from "../../api/client";

vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, projectLinks: vi.fn(), addProjectLink: vi.fn(), removeProjectLink: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const renderIt = () => render(
  <MantineProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectSwitcher name="Clinic records" id="clinic-records" collapsed={false} logo={<span />} />
    </QueryClientProvider>
  </MantineProvider>,
);

beforeEach(() => vi.clearAllMocks());

test("with no other projects the switcher says so; a project is added in a dialog", async () => {
  mock(api.projectLinks).mockResolvedValue({ editable: true, links: [] });
  mock(api.addProjectLink).mockResolvedValue({});
  renderIt();
  await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
  expect(await screen.findByTestId("projects-empty")).toHaveTextContent("Only this project");
  await userEvent.click(screen.getByText("Add a project"));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Project name"), "Staging");
  await userEvent.type(within(dialog).getByLabelText("Its console's address"), "https://staging.example.com/_console");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add project" }));
  await waitFor(() => expect(api.addProjectLink).toHaveBeenCalledWith("Staging", "https://staging.example.com/_console"));
});

test("other projects link to their consoles", async () => {
  mock(api.projectLinks).mockResolvedValue({ editable: false, links: [{ name: "Staging", consoleUrl: "https://staging.example.com/_console" }] });
  renderIt();
  await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
  expect((await screen.findByText("Staging")).closest("a")).toHaveAttribute("href", "https://staging.example.com/_console");
  expect(screen.queryByText("Add a project")).toBeNull();   // not an admin
  expect(screen.queryByTestId("projects-empty")).toBeNull();
});
