import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi, expect, test, beforeEach } from "vitest";
import { SecretsPage } from "../SecretsPage";
import { api } from "../../../api/client";
import { useSession } from "../../../auth/session";

vi.mock("../../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api, functionSecrets: vi.fn(), setFunctionSecret: vi.fn(), removeFunctionSecret: vi.fn(), testFunctionSecret: vi.fn(),
      secretSources: vi.fn(), testSecretReference: vi.fn(), setSourceKey: vi.fn(), removeSourceKey: vi.fn(), keptSecrets: vi.fn(),
    },
  };
});
vi.mock("../../../auth/session", async (orig) => {
  const actual = await orig<typeof import("../../../auth/session")>();
  return { ...actual, useSession: vi.fn() };
});
const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><SecretsPage /></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(useSession).mockReturnValue({ state: { capabilities: { functions: true } }, user: { role: "Admin" } });
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [] });
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: true, keys: [], sources: [] });
  mock(api.keptSecrets).mockResolvedValue({ available: true, secrets: [] });
});

test("the products' secrets are listed with where each is changed; never values", async () => {
  mock(api.keptSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "auth.smtp.password", product: "Authentication", title: "SMTP password (emails to users)", link: "/authentication/settings", setAt: "2026-11-12T20:00:00Z", setBy: "admin@example.com", reference: null },
    { name: "storage.location.b1.secretKey", product: "Storage", title: "Secret key of bucket files (eu-west-2)", link: "/storage/settings", setAt: "2026-11-12T20:00:00Z", setBy: null, reference: "aws-ssm:/app/bucket" },
  ] });
  renderPage();
  const rows = await screen.findAllByTestId("kept-secret");
  expect(rows[0]).toHaveTextContent("SMTP password");
  expect(rows[0]).toHaveTextContent("Value");
  expect(within(rows[0]).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/authentication/settings");
  expect(rows[1]).toHaveTextContent("From aws-ssm");
  expect(rows[0]).toHaveTextContent("Authentication");
});

test("without functions there are no secrets of its own to list", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Admin" } });
  renderPage();
  expect(await screen.findByText("No secrets yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add a secret" })).not.toBeInTheDocument();
});

test("secrets: listed without values, added and set in a dialog, and removed", async () => {
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "MAIL_KEY", isSet: false, setAt: null, setBy: null, usedBy: ["sendReport"] },
    { name: "OLD_TOKEN", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: "admin@example.com", usedBy: [] },
  ] });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  mock(api.removeFunctionSecret).mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  const rows = await screen.findAllByTestId("function-secret");
  expect(rows[0]).toHaveTextContent("Not set");
  expect(rows[0]).toHaveTextContent("sendReport");
  expect(rows[1]).toHaveTextContent("no function declares it");

  await userEvent.click(within(rows[0]).getByRole("button", { name: "Set" }));
  let dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("New value of MAIL_KEY"), "k-123");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("MAIL_KEY", "k-123"));

  await userEvent.click(within(rows[1]).getByRole("button", { name: "More for OLD_TOKEN" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
  await waitFor(() => expect(mock(api.removeFunctionSecret)).toHaveBeenCalledWith("OLD_TOKEN"));

  await userEvent.click(screen.getByRole("button", { name: "Add a secret" }));
  dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Name"), "bad-name");
  expect(within(dialog).getByText(/Capitals, digits and underscores/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
});

test("secrets: a reference to AWS instead of a value, tried before saving, and shown as where it's read from", async () => {
  mock(api.secretSources).mockResolvedValue({ available: true, appCredentials: false, keys: [], sources: [
    { name: "aws-sm", title: "AWS Secrets Manager", hint: "a secret's ARN or its name", key: "secrets.source.aws" },
    { name: "aws-ssm", title: "AWS Parameter Store", hint: "a parameter's name", key: "secrets.source.aws" },
  ] });
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "MAIL_KEY", isSet: false, setAt: null, setBy: null, usedBy: ["sendReport"] },
    { name: "SES_SECRET", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: "admin@example.com", usedBy: [], reference: "aws-ssm:/app/ses" },
  ] });
  mock(api.testSecretReference).mockResolvedValue({ ok: false, problem: "AWS Parameter Store has nothing at /app/mail.", code: "not-found" });
  mock(api.testFunctionSecret).mockResolvedValue({ ok: true, problem: null, code: null });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  renderPage();
  const rows = await screen.findAllByTestId("function-secret");
  expect(rows[1]).toHaveTextContent("From AWS Parameter Store");
  await userEvent.click(within(rows[1]).getByRole("button", { name: "More for SES_SECRET" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Test" }));
  expect(await within(rows[1]).findByText("Read just now: it works.")).toBeInTheDocument();

  await userEvent.click(within(rows[0]).getByRole("button", { name: "Set" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(await within(dialog).findByText("Reference"));
  await userEvent.type(within(dialog).getByLabelText("New value of MAIL_KEY (reference)"), "aws-ssm:/app/mail");
  await userEvent.click(within(dialog).getByRole("button", { name: "Test" }));
  expect(await within(dialog).findByText("AWS Parameter Store has nothing at /app/mail.")).toBeInTheDocument();
  expect(mock(api.testSecretReference)).toHaveBeenCalledWith("aws-ssm:/app/mail");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("MAIL_KEY", "\u0000ref:aws-ssm:/app/mail"));
});

test("admins keep the project's own AWS key under Secrets, never shown again", async () => {
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
  renderPage();
  await userEvent.click(await screen.findByTestId("aws-key-button"));
  const card = await screen.findByTestId("source-key");
  expect(card).toHaveTextContent("only a server admin can set references");
  const save = within(card).getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  await userEvent.type(within(card).getByLabelText(/Access key ID/), "AKIDWARDS");
  await userEvent.type(within(card).getByLabelText(/Secret access key/), "s3cr3t");
  await userEvent.click(save);
  await waitFor(() => expect(mock(api.setSourceKey)).toHaveBeenCalledWith("secrets.source.aws", { accessKeyId: "AKIDWARDS", secretAccessKey: "s3cr3t" }));
});
