import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandModal } from "../CommandModal";
import type { CommandSpec } from "../../../api/tabs";
import { api } from "../../../api/client";

vi.mock("../../../api/client", () => ({ api: { consoleTabCommand: vi.fn() } }));
const showMock = vi.fn();
vi.mock("@mantine/notifications", () => ({ notifications: { show: (...a: unknown[]) => showMock(...a) } }));

const call = api.consoleTabCommand as unknown as ReturnType<typeof vi.fn>;

const confirmCmd: CommandSpec = { id: "del", label: "Delete", minRole: "admin", confirm: "Sure?", rowScoped: true, form: [] };
const formCmd: CommandSpec = {
  id: "create", label: "Create", minRole: "admin", confirm: null, rowScoped: false,
  form: [{ key: "email", kind: "text", label: "Email", required: true, pattern: "^.+@.+$" }],
};

function ui(pending: { cmd: CommandSpec; opts: { rowKey: string | null } } | null, onDone = vi.fn()) {
  return render(
    <MantineProvider>
      <CommandModal pending={pending} tabId="t" inputs={{}} onClose={vi.fn()} onDone={onDone} />
    </MantineProvider>,
  );
}

beforeEach(() => { call.mockReset(); showMock.mockReset(); });

describe("CommandModal", () => {
  it("confirm-only: confirming calls the api and reports ok + toast", async () => {
    call.mockResolvedValue({ status: "ok", message: "gone", refetch: "tab" });
    const onDone = vi.fn();
    ui({ cmd: confirmCmd, opts: { rowKey: "r1" } }, onDone);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("t", "del", { rowKey: "r1", input: null, inputs: {} }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("tab"));
    expect(showMock).toHaveBeenCalled();
  });

  it("form: empty required field blocks submit (no api call)", async () => {
    ui({ cmd: formCmd, opts: { rowKey: null } });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(call).not.toHaveBeenCalled();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });

  it("form: server 'invalid' shows the field error and keeps modal open", async () => {
    call.mockResolvedValue({ status: "invalid", fieldErrors: { email: "Already taken" } });
    ui({ cmd: formCmd, opts: { rowKey: null } });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Already taken")).toBeInTheDocument();
  });

  it("'error' status raises an error toast", async () => {
    call.mockResolvedValue({ status: "error", message: "boom" });
    ui({ cmd: formCmd, opts: { rowKey: null } });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ color: "red" })));
  });

  it("form: a non-field ('') server error surfaces as a form-level alert (not silently dropped)", async () => {
    call.mockResolvedValue({ status: "invalid", fieldErrors: { "": "Object-level rule failed" } });
    ui({ cmd: formCmd, opts: { rowKey: null } });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Object-level rule failed")).toBeInTheDocument();
  });
});
