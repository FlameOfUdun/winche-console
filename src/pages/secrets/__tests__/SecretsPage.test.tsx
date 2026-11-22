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
      secretSources: vi.fn(), moveFunctionSecret: vi.fn(), testSecretReference: vi.fn(), setSourceKey: vi.fn(), removeSourceKey: vi.fn(), keptSecrets: vi.fn(),
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
  expect(rows[0]).toHaveTextContent("Encrypted");
  expect(within(rows[0]).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/authentication/settings");
  expect(rows[1]).toHaveTextContent("From aws-ssm");
  expect(rows[0]).toHaveTextContent("Authentication");
});

test("without functions there are no secrets of its own to list", async () => {
  mock(useSession).mockReturnValue({ state: { capabilities: {} }, user: { role: "Admin" } });
  renderPage();
  expect(await screen.findByText("Kept by the products")).toBeInTheDocument();
  expect(screen.queryByText("Read by functions")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add a secret" })).not.toBeInTheDocument();
});

test("secrets: listed without values, added and set in a dialog, and removed", async () => {
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "OLD_TOKEN", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: "admin@example.com", usedBy: [] },
    { name: "MAIL_KEY", isSet: false, setAt: null, setBy: null, usedBy: ["sendReport"] },
  ] });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  mock(api.removeFunctionSecret).mockResolvedValue(undefined);
  renderPage();
  const rows = await screen.findAllByTestId("function-secret");
  expect(rows[0]).toHaveTextContent("Not set");   // the ones a function can't read come first
  expect(rows[0]).toHaveTextContent("sendReport");
  expect(rows[1]).toHaveTextContent("Not used by a function");

  await userEvent.click(within(rows[0]).getByRole("button", { name: "Set" }));
  let dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("New value of MAIL_KEY"), "k-123");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.setFunctionSecret)).toHaveBeenCalledWith("MAIL_KEY", "k-123"));

  await userEvent.click(within(rows[1]).getByRole("button", { name: "More for OLD_TOKEN" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
  // Asked first, in the console's own dialog.
  const confirm = await screen.findByRole("dialog", { name: "Remove OLD_TOKEN?" });
  await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(mock(api.removeFunctionSecret)).toHaveBeenCalledWith("OLD_TOKEN"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove OLD_TOKEN?" })).toBeNull());

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
  await userEvent.type(within(card).getByLabelText(/Access key ID/), "AKIDEXAMPLE");
  await userEvent.type(within(card).getByLabelText(/Secret access key/), "s3cr3t");
  await userEvent.click(save);
  await waitFor(() => expect(mock(api.setSourceKey)).toHaveBeenCalledWith("secrets.source.aws", { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "s3cr3t" }));
});

const access = (read: boolean, write: boolean, extra: Partial<{ missing: string[]; problem: string | null }> = {}) =>
  ({ read, write, delete: write, missing: [], problem: null, ...extra });
const awsKey = { name: "secrets.source.aws", title: "AWS access key", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: null, sources: ["aws-sm", "aws-ssm"], fields: [] };
const withAccess = (sm: ReturnType<typeof access>, ssm: ReturnType<typeof access>) => ({ available: true, appCredentials: false, keys: [awsKey], sources: [
  { name: "aws-sm", title: "AWS Secrets Manager", hint: "a secret's ARN or its name", key: awsKey.name, access: sm },
  { name: "aws-ssm", title: "AWS Parameter Store", hint: "a parameter's name", key: awsKey.name, access: ssm },
] });

test("a value kept in AWS: offered only where the key may write, and sent as the value with keep:<store>", async () => {
  mock(api.secretSources).mockResolvedValue(withAccess(access(true, true), access(true, false)));
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [{ name: "MAIL_KEY", isSet: false, setAt: null, setBy: null, usedBy: [] }] });
  mock(api.setFunctionSecret).mockResolvedValue(undefined);
  renderPage();
  await userEvent.click(within((await screen.findAllByTestId("function-secret"))[0]).getByRole("button", { name: "Set" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(await within(dialog).findByText("In AWS"));
  const stores = within(dialog).getByTestId("secret-store");
  expect(stores).toHaveTextContent("Secrets Manager");
  expect(stores).not.toHaveTextContent("Parameter Store");   // read only there
  await userEvent.type(within(dialog).getByLabelText("New value of MAIL_KEY"), "k-123");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock(api.setFunctionSecret)).toHaveBeenCalled());
  const { secretBody } = await import("../../../api/secrets");
  expect(secretBody(mock(api.setFunctionSecret).mock.calls[0][1])).toEqual({ value: "k-123", reference: "keep:aws-sm" });
});

test("no rights in AWS: just the value, no Reference or In AWS, no Move to AWS", async () => {
  mock(api.secretSources).mockResolvedValue(withAccess(access(false, false), access(false, false)));
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "OLD_TOKEN", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: null, usedBy: [] },
  ] });
  renderPage();
  const row = (await screen.findAllByTestId("function-secret"))[0];
  await userEvent.click(within(row).getByRole("button", { name: "More for OLD_TOKEN" }));
  expect(await screen.findByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Move to AWS" })).toBeNull();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(row).getByRole("button", { name: "Replace" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("New value of OLD_TOKEN")).toBeInTheDocument();
  expect(within(dialog).queryByTestId("secret-mode")).toBeNull();
  expect(within(dialog).queryByText("In AWS")).toBeNull();
});

test("a value kept here moved to AWS, to a store the key may write in; managed ones say they're in AWS and are deleted there too", async () => {
  mock(api.secretSources).mockResolvedValue(withAccess(access(true, false), access(true, true)));
  mock(api.functionSecrets).mockResolvedValue({ available: true, secrets: [
    { name: "OLD_TOKEN", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: null, usedBy: [] },
    { name: "SES_SECRET", isSet: true, setAt: "2026-11-12T20:00:00Z", setBy: null, usedBy: [], reference: "aws-sm:winche/p1/SES_SECRET", managed: true },
  ] });
  mock(api.moveFunctionSecret).mockRejectedValueOnce(new Error(JSON.stringify({ error: { message: "AWS refused: not allowed." } }))).mockResolvedValue(undefined);
  renderPage();
  const rows = await screen.findAllByTestId("function-secret");
  expect(rows[0]).toHaveTextContent("Encrypted");
  expect(rows[1]).toHaveTextContent("In AWS Secrets Manager");

  await userEvent.click(within(rows[0]).getByRole("button", { name: "More for OLD_TOKEN" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Move to AWS" }));
  const dialog = await screen.findByTestId("move-dialog");
  expect(dialog).toHaveTextContent("Parameter Store");
  expect(dialog).not.toHaveTextContent("Secrets Manager");
  await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
  expect(await within(dialog).findByText("AWS refused: not allowed.")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
  await waitFor(() => expect(mock(api.moveFunctionSecret)).toHaveBeenLastCalledWith("OLD_TOKEN", "aws-ssm"));
  await waitFor(() => expect(screen.queryByTestId("move-dialog")).toBeNull());
  expect(mock(api.functionSecrets).mock.calls.length).toBeGreaterThan(1);

  await userEvent.click(within(rows[1]).getByRole("button", { name: "More for SES_SECRET" }));
  expect(screen.queryByRole("menuitem", { name: "Move to AWS" })).toBeNull();
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
  expect(await screen.findByRole("dialog", { name: "Remove SES_SECRET?" })).toHaveTextContent("It's deleted in AWS too.");
});

test("the AWS key line says what the key may do, or what it lacks, and checks again with AWS", async () => {
  mock(api.secretSources)
    .mockResolvedValueOnce(withAccess(access(true, true), access(true, false)))
    .mockResolvedValue(withAccess(access(true, false, { missing: ["secretsmanager:CreateSecret"] }), access(true, false)));
  renderPage();
  const line = await screen.findByTestId("aws-access-line");
  expect(line).toHaveTextContent("Read and write in Secrets Manager · read only in Parameter Store");
  await userEvent.click(within(line).getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(mock(api.secretSources)).toHaveBeenCalledWith(true));
  expect(await screen.findByText("Missing: secretsmanager:CreateSecret")).toBeInTheDocument();
});
