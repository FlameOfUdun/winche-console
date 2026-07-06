import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { vi, expect, test } from "vitest";
import { ExpressionBuilder } from "../ExpressionBuilder";
import type { RuleExpression } from "../../../api/rules";

// jsdom doesn't implement scrollIntoView; Mantine's Combobox calls it when the dropdown opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function renderBuilder(value: RuleExpression, onChange = vi.fn()) {
  render(
    <MantineProvider>
      <ExpressionBuilder value={value} onChange={onChange} />
    </MantineProvider>,
  );
  return onChange;
}

test("changing the kind Select to comparison calls onChange with a well-formed comparison node", async () => {
  const onChange = renderBuilder({ kind: "literal", Value: true });

  await userEvent.click(screen.getByRole("textbox", { name: "Expression kind" }));
  await userEvent.click(await screen.findByRole("option", { name: "comparison" }));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "comparison",
      Left: expect.anything(),
      Op: expect.any(String),
      Right: expect.anything(),
    }),
  );
  const [arg] = onChange.mock.calls[0];
  expect(arg.kind).toBe("comparison");
  expect(arg.Left).toBeDefined();
  expect(arg.Op).toBeDefined();
  expect(arg.Right).toBeDefined();
});

test("a comparison node renders LEFT and RIGHT child builders", () => {
  const comparison: RuleExpression = {
    kind: "comparison",
    Left: { kind: "variable", Name: "request" },
    Op: "Eq",
    Right: { kind: "literal", Value: true },
  };
  renderBuilder(comparison);

  expect(screen.getByText("LEFT")).toBeInTheDocument();
  expect(screen.getByText("RIGHT")).toBeInTheDocument();
  // Three "Expression kind" Selects: the outer comparison node, plus one for each of its
  // LEFT (variable) and RIGHT (literal) child builders.
  expect(screen.getAllByRole("textbox", { name: "Expression kind" })).toHaveLength(3);
});

test("selecting the kind on a literal node does not call onChange when re-selecting the same kind", async () => {
  const onChange = renderBuilder({ kind: "literal", Value: true });
  await userEvent.click(screen.getByRole("textbox", { name: "Expression kind" }));
  await userEvent.click(await screen.findByRole("option", { name: "literal" }));
  expect(onChange).not.toHaveBeenCalled();
});
