import { createRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { RulesCodeEditor, type RulesCodeEditorHandle } from "../RulesCodeEditor";

const FILE = "match users/{uid} {\n  allow read: if request.auth.uid == uid;\n}\n";

test("mounts CodeMirror with the rules, coloured, and shows a pushed-in change", async () => {
  const props = { onChange: vi.fn(), error: null, subsystem: "database" as const, fieldsFor: vi.fn().mockResolvedValue([]) };
  const { container, rerender } = render(<MantineProvider><RulesCodeEditor value={FILE} {...props} /></MantineProvider>);

  const content = container.querySelector(".cm-content")!;
  expect(content.getAttribute("aria-label")).toBe("Rules");
  expect(content.textContent).toContain("allow read: if request.auth.uid == uid;");
  expect(container.querySelectorAll(".cm-line").length).toBe(4);

  rerender(<MantineProvider><RulesCodeEditor value={"match other/{id} {\n}\n"} {...props} /></MantineProvider>);
  await waitFor(() => expect(container.querySelector(".cm-content")!.textContent).toContain("match other/{id} {"));
  expect(props.onChange).toHaveBeenCalledWith("match other/{id} {\n}\n");
});

test("an error is marked in the gutter", async () => {
  const props = { onChange: vi.fn(), subsystem: "database" as const, fieldsFor: vi.fn().mockResolvedValue([]) };
  const { container } = render(<MantineProvider>
    <RulesCodeEditor value={FILE} error={{ message: "Use '==' to compare", line: 2, column: 31, offset: 50 }} {...props} />
  </MantineProvider>);
  await waitFor(() => expect(container.querySelector(".cm-lint-marker-error")).not.toBeNull());
});

test("undo and redo, and whether they're available", async () => {
  const ref = createRef<RulesCodeEditorHandle>();
  const onHistory = vi.fn();
  const props = { onChange: vi.fn(), error: null, subsystem: "database" as const, fieldsFor: vi.fn().mockResolvedValue([]) };
  const { container, rerender } = render(<MantineProvider><RulesCodeEditor ref={ref} value={FILE} onHistoryChange={onHistory} {...props} /></MantineProvider>);
  const text = () => container.querySelector(".cm-content")!.textContent;

  rerender(<MantineProvider><RulesCodeEditor ref={ref} value={"match changed/{id} {\n}\n"} onHistoryChange={onHistory} {...props} /></MantineProvider>);
  await waitFor(() => expect(text()).toContain("match changed/{id}"));
  expect(onHistory).toHaveBeenLastCalledWith(true, false);

  act(() => ref.current!.undo());
  expect(text()).toContain("allow read: if request.auth.uid == uid;");
  expect(onHistory).toHaveBeenLastCalledWith(false, true);

  act(() => ref.current!.redo());
  expect(text()).toContain("match changed/{id}");
  expect(onHistory).toHaveBeenLastCalledWith(true, false);
});
