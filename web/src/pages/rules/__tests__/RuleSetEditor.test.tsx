import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { beforeEach, expect, test, vi } from "vitest";

const parse = vi.fn();
const format = vi.fn();
vi.mock("../../../api/client", () => ({
  api: {
    rulesParseText: (text: string) => parse(text),
    rulesFormatText: (json: string) => format(json),
  },
}));

// CodeMirror's contenteditable doesn't take typing in jsdom: stand in a textarea with the same contract
// (RulesCodeEditor itself has its own test).
vi.mock("../RulesCodeEditor", () => ({
  RulesCodeEditor: ({ value, onChange, onBlur }: { value: string; onChange: (t: string) => void; onBlur?: () => void }) => (
    <textarea aria-label="Rules" value={value} onChange={(e) => onChange(e.currentTarget.value)} onBlur={onBlur} />
  ),
}));

const { RuleSetEditor } = await import("../RuleSetEditor");
type Handle = import("../RuleSetEditor").RuleSetEditorHandle;

const FILE = "match users/{uid} {\n  allow read: if request.auth.uid == uid;\n}\n";
const JSON_RULES = JSON.stringify({ Matches: [{ Path: "users/{uid}", Allow: [], Matches: [] }] }, null, 2);
const OK = (rules: object) => ({ ok: true, rulesJson: JSON.stringify(rules), error: null, warnings: [] });

function renderEditor(json = JSON_RULES) {
  const onChange = vi.fn();
  const onEdited = vi.fn();
  const ref = createRef<Handle>();
  const ui = (j: string) => (
    <MantineProvider>
      <RuleSetEditor ref={ref} subsystem="database" json={j} onChange={onChange} onEditedChange={onEdited} />
    </MantineProvider>
  );
  const view = render(ui(json));
  return { onChange, onEdited, ref, rerender: (j: string) => view.rerender(ui(j)) };
}

const box = () => screen.findByRole("textbox", { name: "Rules" });

beforeEach(() => {
  parse.mockReset();
  format.mockReset();
  format.mockResolvedValue({ text: FILE });
});

test("shows the rules as a file", async () => {
  renderEditor();
  expect(await box()).toHaveValue(FILE);
  expect(format).toHaveBeenCalledWith(JSON_RULES);
});

test("typing sends nothing; leaving the editor checks it", async () => {
  parse.mockResolvedValue(OK({ Matches: [] }));
  const { onChange, onEdited } = renderEditor();
  const input = await box();

  await userEvent.clear(input);
  await userEvent.type(input, "// none");
  expect(parse).not.toHaveBeenCalled();
  expect(onEdited).toHaveBeenLastCalledWith(true);

  fireEvent.blur(input);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(JSON.stringify({ Matches: [] }, null, 2)));
  expect(parse).toHaveBeenCalledTimes(1);
  expect(parse).toHaveBeenLastCalledWith("// none");
  await waitFor(() => expect(onEdited).toHaveBeenLastCalledWith(false));
});

test("check() returns the rules, or null with the error shown", async () => {
  const { ref } = renderEditor();
  const input = await box();
  await userEvent.type(input, "x");

  parse.mockResolvedValueOnce({ ok: false, rulesJson: null, error: { message: "Use '==' to compare", line: 2, column: 31, offset: 50 }, warnings: [] });
  let result: string | null = "unset";
  await act(async () => { result = await ref.current!.check(); });
  expect(result).toBeNull();
  expect(await screen.findByRole("alert")).toHaveTextContent("Line 2, column 31: Use '==' to compare");

  await userEvent.type(input, "y");            // editing clears the stale error
  expect(screen.queryByRole("alert")).toBeNull();
  parse.mockResolvedValueOnce(OK({ Matches: [] }));
  await act(async () => { result = await ref.current!.check(); });
  expect(result).toBe(JSON.stringify({ Matches: [] }, null, 2));
});

test("unchanged text isn't checked again", async () => {
  const { ref } = renderEditor();
  await box();
  let result: string | null = null;
  await act(async () => { result = await ref.current!.check(); });
  expect(result).toBe(JSON_RULES);
  expect(parse).not.toHaveBeenCalled();
});

test("a misspelled function is flagged after a check", async () => {
  parse.mockResolvedValue({ ...OK({ Matches: [] }), warnings: ["Unknown function 'hasonly' — it will always deny."] });
  renderEditor();
  const input = await box();
  await userEvent.type(input, " ");
  fireEvent.blur(input);
  expect(await screen.findByText("Unknown function 'hasonly' — it will always deny.")).toBeInTheDocument();
});

test("rules loaded from outside are shown; our own checked draft isn't re-formatted", async () => {
  parse.mockResolvedValue(OK({ Matches: [] }));
  const { onChange, rerender } = renderEditor();
  const input = await box();

  await userEvent.clear(input);
  await userEvent.type(input, "// mine");
  fireEvent.blur(input);
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  rerender(onChange.mock.calls[0][0]);           // the parent echoes our draft back
  expect(format).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue("// mine");

  format.mockResolvedValue({ text: "match other/{id} {\n}\n" });
  rerender(JSON.stringify({ Matches: [{ Path: "other/{id}", Allow: [], Matches: [] }] }));
  await waitFor(() => expect(input).toHaveValue("match other/{id} {\n}\n"));
});
