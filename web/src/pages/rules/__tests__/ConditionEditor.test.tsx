import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { beforeEach, expect, test, vi } from "vitest";
import type { RuleExpression } from "../../../api/rules";

const parse = vi.fn();
const format = vi.fn();
vi.mock("../../../api/client", () => ({
  api: {
    rulesParseText: (text: string) => parse(text),
    rulesFormatText: (json: string) => format(json),
  },
}));

const { ConditionEditor } = await import("../ConditionEditor");
const { ConditionValidityProvider, useInvalidConditionCount } = await import("../conditionValidity");

const owner: RuleExpression = {
  kind: "comparison",
  Left: { kind: "member", Target: { kind: "member", Target: { kind: "variable", Name: "request" }, Name: "auth" }, Name: "uid" },
  Op: "Eq",
  Right: { kind: "variable", Name: "uid" },
};

function Invalid() {
  return <span data-testid="invalid">{useInvalidConditionCount()}</span>;
}

function renderEditor(onChange = vi.fn()) {
  render(
    <MantineProvider>
      <ConditionValidityProvider>
        <ConditionEditor value={owner} onChange={onChange} />
        <Invalid />
      </ConditionValidityProvider>
    </MantineProvider>,
  );
  return onChange;
}

beforeEach(() => {
  parse.mockReset();
  format.mockReset();
  format.mockResolvedValue({ text: "request.auth.uid == uid" });
});

test("shows the condition as text", async () => {
  renderEditor();
  expect(await screen.findByDisplayValue("request.auth.uid == uid")).toBeInTheDocument();
  expect(format).toHaveBeenCalledWith(JSON.stringify(owner));
  await waitFor(() => expect(screen.getByTestId("invalid")).toHaveTextContent("0"));
});

test("valid text becomes the condition, without being re-formatted", async () => {
  const parsed: RuleExpression = { kind: "call", Name: "hasOnly", Args: [] };
  parse.mockResolvedValue({ ok: true, expressionJson: JSON.stringify(parsed), error: null, warnings: [] });
  const onChange = renderEditor();
  const box = await screen.findByDisplayValue("request.auth.uid == uid");

  await userEvent.clear(box);
  await userEvent.type(box, "x.hasOnly()");

  await waitFor(() => expect(onChange).toHaveBeenCalledWith(parsed));
  expect(parse).toHaveBeenLastCalledWith("x.hasOnly()");
  expect(parse).toHaveBeenCalledTimes(1);   // debounced: one check for the whole edit
  await waitFor(() => expect(screen.getByTestId("invalid")).toHaveTextContent("0"));
});

test("an error says where, keeps the last valid condition, and blocks saving", async () => {
  parse.mockResolvedValue({ ok: false, expressionJson: null, error: { message: "Use '==' to compare", line: 1, column: 3, offset: 2 }, warnings: [] });
  const onChange = renderEditor();
  const box = await screen.findByDisplayValue("request.auth.uid == uid");

  await userEvent.clear(box);
  await userEvent.type(box, "a = b");

  expect(await screen.findByRole("alert")).toHaveTextContent("Line 1, column 3: Use '==' to compare");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByTestId("invalid")).toHaveTextContent("1");
});

test("an unknown function is flagged", async () => {
  parse.mockResolvedValue({ ok: true, expressionJson: JSON.stringify(owner), error: null, warnings: ["Unknown function 'hasonly' — it will always deny."] });
  renderEditor();
  const box = await screen.findByDisplayValue("request.auth.uid == uid");

  await userEvent.type(box, " ");

  expect(await screen.findByText("Unknown function 'hasonly' — it will always deny.")).toBeInTheDocument();
});

test("the builder is still there", async () => {
  renderEditor();
  await screen.findByDisplayValue("request.auth.uid == uid");
  await userEvent.click(screen.getByText("Builder"));
  expect(screen.getAllByRole("textbox", { name: "Expression kind" }).length).toBeGreaterThan(0);
});
