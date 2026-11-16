import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { ProjectSettingsPage } from "../ProjectSettingsPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, apps: vi.fn(), listUsers: vi.fn(), listInvites: vi.fn(), consoleTokens: vi.fn(),
    secretSources: vi.fn(), setSourceKey: vi.fn(), removeSourceKey: vi.fn() } };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
function renderAt(path: string) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="settings/:tab" element={<><ProjectSettingsPage /><Where /></>} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(api.apps).mockResolvedValue({
    setup: { projectId: "demo", name: "Demo", baseUrl: "https://api.example.com", services: [], providers: [] },
    platforms: ["android"], file: "x", snippet: "y",
  });
  mock(api.listUsers).mockResolvedValue([]);
  mock(api.listInvites).mockResolvedValue([]);
  mock(api.consoleTokens).mockResolvedValue({ available: true, scopes: ["functions", "rules"], tokens: [] });
});

test("admins get General, Users and permissions, and CI tokens, each at its own address", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: { manageUsers: true } }, user: { role: "Admin" } });
  renderAt("/settings/general");
  expect(await screen.findByText("Your apps")).toBeInTheDocument();
  expect(await screen.findByTestId("project-name")).toHaveTextContent("Demo");
  cleanup();
  renderAt("/settings/users");   // the old address
  expect(await screen.findByTestId("where")).toHaveTextContent("/settings/members");
  expect(await screen.findByRole("button", { name: "New user" })).toBeInTheDocument();
  cleanup();
  renderAt("/settings/ci");
  expect(await screen.findByText("CI tokens")).toBeInTheDocument();
});

test("others see only General", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Member" } });
  renderAt("/settings/ci");
  expect(await screen.findByTestId("where")).toHaveTextContent("/settings/general");
});

test("admins keep the project's own AWS key under Secrets, never shown again", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Admin" } });
  const key = {
    name: "secrets.source.aws", title: "AWS access key", isSet: false, setAt: null, setBy: null, sources: ["aws-sm", "aws-ssm"],
    fields: [
      { name: "accessKeyId", title: "Access key ID", secret: false, required: true, hint: null },
      { name: "secretAccessKey", title: "Secret access key", secret: true, required: true, hint: null },
      { name: "region", title: "Region", secret: false, required: false, hint: "e.g. eu-west-2" },
    ],
  };
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, keys: [key], sources: [
    { name: "aws-sm", title: "AWS Secrets Manager", hint: "a secret's ARN or its name", key: key.name },
    { name: "aws-ssm", title: "AWS Parameter Store", hint: "a parameter's name", key: key.name },
  ] });
  mock(api.setSourceKey).mockResolvedValue(undefined);
  renderAt("/settings/secrets");
  const card = await screen.findByTestId("source-key");
  expect(card).toHaveTextContent("only a server admin can set references");
  await userEvent.click(within(card).getByRole("button", { name: "Set" }));
  const save = within(card).getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  await userEvent.type(within(card).getByLabelText(/Access key ID/), "AKIDWARDS");
  await userEvent.type(within(card).getByLabelText(/Secret access key/), "s3cr3t");
  await userEvent.click(save);
  await waitFor(() => expect(mock(api.setSourceKey)).toHaveBeenCalledWith("secrets.source.aws", { accessKeyId: "AKIDWARDS", secretAccessKey: "s3cr3t" }));
});
