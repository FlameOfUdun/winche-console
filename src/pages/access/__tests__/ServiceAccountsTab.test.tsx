import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, expect, test, beforeEach } from "vitest";
import { ServiceAccountsTab } from "../ServiceAccountsTab";
import { api } from "../../../api/client";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return { ...actual, api: { ...actual.api, serviceAccounts: vi.fn(), createServiceAccount: vi.fn(), addServiceAccountKey: vi.fn(),
    revokeServiceAccountKey: vi.fn(), trustIdentity: vi.fn(), updateServiceAccount: vi.fn() } };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const deploy = {
  id: "a1", name: "gitlab-deploy", role: null, scopes: ["functions"], disabled: false, createdBy: "bob@example.com",
  createdAt: "2026-11-14T10:00:00Z", lastUsedAt: null, makerIsAdmin: false,
  keys: [{ id: "k1aaaaaaaaaaaaaa", createdBy: "bob@example.com", createdAt: "2026-06-01T10:00:00Z", expiresAt: "2027-06-01T10:00:00Z", lastUsedAt: null, lastUsedFrom: null, unused: true }],
  identities: [],
};
const page = (accounts: unknown[]) => ({ available: true, roles: ["Viewer", "Member", "Admin"], scopes: ["functions", "rules"], maxKeys: 2, maxKeyDays: 730, keysAllowed: true, accounts });

function renderTab() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ServiceAccountsTab /></QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test("an account shows its role or scopes, flags a maker who's no longer an admin and an unused key, and a new key is shown once", async () => {
  mock(api.serviceAccounts).mockResolvedValue(page([deploy]));
  mock(api.addServiceAccountKey).mockResolvedValue({ key: { id: "k2", createdAt: "", expiresAt: "" }, secret: "wsk_k2_secret" });
  renderTab();
  const card = await screen.findByTestId("service-account");
  expect(within(card).getByText("gitlab-deploy")).toBeInTheDocument();
  expect(within(card).getByText("Deploy functions")).toBeInTheDocument();
  expect(within(card).getByTestId("maker-gone")).toHaveTextContent("bob@example.com is no longer an admin here");
  expect(within(card).getByText("unused 90 days")).toBeInTheDocument();

  await userEvent.click(within(card).getByRole("button", { name: "Add a key" }));
  expect(await screen.findByTestId("service-account-secret")).toHaveTextContent("wsk_k2_secret");
  expect(mock(api.addServiceAccountKey)).toHaveBeenCalledWith("a1", 90);
});

test("a new account: a role for a server, or deploy scopes for CI; a trusted identity needs issuer, subject and audience", async () => {
  mock(api.serviceAccounts).mockResolvedValueOnce(page([])).mockResolvedValue(page([{ ...deploy, makerIsAdmin: true, keys: [] }]));
  mock(api.createServiceAccount).mockResolvedValue({ id: "a2", name: "billing" });
  renderTab();
  await userEvent.click(await screen.findByRole("button", { name: "New service account" }));
  await userEvent.type(await screen.findByLabelText("Name"), "billing");
  await userEvent.click(screen.getByText("Uses the data (a server)"));
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(mock(api.createServiceAccount)).toHaveBeenCalledWith("billing", "Member", []));

  mock(api.trustIdentity).mockResolvedValue({ id: "i1" });
  const card = await screen.findByTestId("service-account");
  await userEvent.click(within(card).getByRole("button", { name: "Trust an identity" }));
  const trust = await screen.findByRole("button", { name: "Trust it" });   // once the dialog has opened
  expect(trust).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Issuer"), "https://gitlab.example.com");
  await userEvent.type(screen.getByLabelText("Subject"), "project_path:team/app:ref_type:branch:ref:main");
  await userEvent.type(screen.getByLabelText("Audience"), "https://winche.example.com/projects/app");
  await userEvent.click(trust);
  await waitFor(() => expect(mock(api.trustIdentity)).toHaveBeenCalledWith("a1", "https://gitlab.example.com", "project_path:team/app:ref_type:branch:ref:main", "https://winche.example.com/projects/app"));
});
