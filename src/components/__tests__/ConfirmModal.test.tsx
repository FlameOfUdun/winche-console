import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { ConfirmModal } from "../ConfirmModal";
import { ScrollDialog } from "../ScrollDialog";

function Nested({ action, onOuterClose }: { action: () => Promise<unknown>; onOuterClose: () => void }) {
  const [outer, setOuter] = useState(true);
  const [confirming, setConfirming] = useState(false);
  return (
    <MantineProvider>
      <ScrollDialog opened={outer} onClose={() => { setOuter(false); onOuterClose(); }} title="Outer">
        <button onClick={() => setConfirming(true)}>Remove it</button>
      </ScrollDialog>
      <ConfirmModal opened={confirming} title="Sure?" message="Gone for good." confirmLabel="Remove"
        action={async () => { await action(); setOuter(false); }} onCancel={() => setConfirming(false)} />
    </MantineProvider>
  );
}

test("Escape in a confirm over another dialog closes only the confirm; Escape again closes the one under it", async () => {
  const onOuterClose = vi.fn();
  render(<Nested action={vi.fn()} onOuterClose={onOuterClose} />);
  await userEvent.click(await screen.findByRole("button", { name: "Remove it" }));
  await screen.findByRole("dialog", { name: "Sure?" });
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sure?" })).toBeNull());
  expect(onOuterClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(onOuterClose).toHaveBeenCalled());
});

test("an action: busy while it runs, closed when done; when it fails, its error shown and the dialog kept", async () => {
  let finish!: () => void;
  const action = vi.fn().mockRejectedValueOnce(new Error("Not allowed")).mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
  const onOuterClose = vi.fn();
  render(<Nested action={action} onOuterClose={onOuterClose} />);
  await userEvent.click(await screen.findByRole("button", { name: "Remove it" }));
  const confirm = await screen.findByRole("dialog", { name: "Sure?" });
  await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
  expect(await within(confirm).findByText("Not allowed")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();

  await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled());
  expect(within(confirm).queryByText("Not allowed")).toBeNull();
  finish();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(action).toHaveBeenCalledTimes(2);
});
