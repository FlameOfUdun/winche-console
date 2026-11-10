import { render, screen, waitFor } from "@testing-library/react";
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
  RulesCodeEditor: ({ value, onChange }: { value: string; onChange: (t: string) => void }) => (
    <textarea aria-label="Rules" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
  ),
}));

const { RuleSetEditor } = await import("../RuleSetEditor");

const FILE = "match users/{uid} {\n  allow read: if request.auth.uid == uid;\n}\n";
const JSON_RULES = JSON.stringify({ Matches: [{ Path: "users/{uid}", Allow: [], Matches: [] }] }, null, 2);

function renderEditor(json = JSON_RULES) {
  const onChange = vi.fn();
  const onValidity = vi.fn();
  const view = render(
    <MantineProvider>
      <RuleSetEditor subsystem="database" json={json} onChange={onChange} onValidityChange={onValidity} />
    </MantineProvider>,
  );
  const rerender = (next: string) => view.rerender(
    <MantineProvider>
      <RuleSetEditor subsystem="database" json={next} onChange={onChange} onValidityChange={onValidity} />
    </MantineProvider>,
  );
  return { onChange, onValidity, rerender };
}

const box = () => screen.findByRole("textbox", { name: "Rules" });

beforeEach(() => {
  parse.mockReset();
  format.mockReset();
  format.mockResolvedValue({ text: FILE });
});

test("shows the rules as a file", async () => {
  const { onValidity } = renderEditor();
  expect(await box()).toHaveValue(FILE);
  expect(format).toHaveBeenCalledWith(JSON_RULES);
  await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(true));
});

test("an edit becomes the draft once it parses, checked once per pause", async () => {
  const parsedJson = JSON.stringify({ Matches: [] });
  parse.mockResolvedValue({ ok: true, rulesJson: parsedJson, error: null, warnings: [] });
  const { onChange, onValidity } = renderEditor();
  const input = await box();

  await userEvent.clear(input);
  await userEvent.type(input, "// none");

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(JSON.stringify({ Matches: [] }, null, 2)));
  expect(parse).toHaveBeenCalledTimes(1);
  expect(parse).toHaveBeenLastCalledWith("// none");
  await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(true));
});

test("an error says where, keeps the last valid draft, and blocks saving", async () => {
  parse.mockResolvedValue({ ok: false, rulesJson: null, error: { message: "Use '==' to compare", line: 2, column: 31, offset: 50 }, warnings: [] });
  const { onChange, onValidity } = renderEditor();
  const input = await box();

  await userEvent.type(input, "x");

  expect(await screen.findByRole("alert")).toHaveTextContent("Line 2, column 31: Use '==' to compare");
  expect(onChange).not.toHaveBeenCalled();
  expect(onValidity).toHaveBeenLastCalledWith(false);
});

test("a misspelled function is flagged", async () => {
  parse.mockResolvedValue({ ok: true, rulesJson: JSON_RULES, error: null, warnings: ["Unknown function 'hasonly' — it will always deny."] });
  renderEditor();
  await userEvent.type(await box(), " ");
  expect(await screen.findByText("Unknown function 'hasonly' — it will always deny.")).toBeInTheDocument();
});

test("rules loaded from outside (import, a version) are shown; our own edits aren't re-formatted", async () => {
  const parsedJson = JSON.stringify({ Matches: [] });
  parse.mockResolvedValue({ ok: true, rulesJson: parsedJson, error: null, warnings: [] });
  const { onChange, rerender } = renderEditor();
  const input = await box();

  await userEvent.clear(input);
  await userEvent.type(input, "// mine");
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  rerender(onChange.mock.calls[0][0]);           // the parent echoes our draft back
  expect(format).toHaveBeenCalledTimes(1);        // not re-formatted
  expect(input).toHaveValue("// mine");

  format.mockResolvedValue({ text: "match other/{id} {\n}\n" });
  rerender(JSON.stringify({ Matches: [{ Path: "other/{id}", Allow: [], Matches: [] }]}));
  await waitFor(() => expect(input).toHaveValue("match other/{id} {\n}\n"));
});
