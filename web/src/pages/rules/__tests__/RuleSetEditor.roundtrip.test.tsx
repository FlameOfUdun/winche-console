import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { vi, expect, test } from "vitest";
import { RuleSetEditor } from "../RuleSetEditor";
import type { RuleSet } from "../../../api/rules";

const ruleSet: RuleSet = {
  Matches: [
    {
      Path: "users/{userId}",
      Allow: [
        {
          Operations: ["Get"],
          Condition: {
            kind: "comparison",
            Left: { kind: "variable", Name: "userId" },
            Op: "Eq",
            Right: { kind: "literal", Value: "alice" },
          },
        },
      ],
      Matches: [],
    },
  ],
};
const rulesJson = JSON.stringify(ruleSet, null, 2);

function renderEditor(json = rulesJson, onChange = vi.fn()) {
  render(
    <MantineProvider>
      <RuleSetEditor value={ruleSet} json={json} onChange={onChange} />
    </MantineProvider>,
  );
  return onChange;
}

test("Builder mode renders the match path in an input", () => {
  renderEditor();
  expect(screen.getByDisplayValue("users/{userId}")).toBeInTheDocument();
});

test("switching to JSON mode shows PascalCase keys and lowercase kind in the textarea", async () => {
  renderEditor();
  await userEvent.click(screen.getByText("JSON"));

  const textarea = screen.getByLabelText("Rules JSON") as HTMLTextAreaElement;
  expect(textarea.value).toContain('"Matches"');
  expect(textarea.value).toContain('"Path"');
  expect(textarea.value).toContain('"kind": "comparison"');
});

test("editing the Path input fires onChange with updated JSON that still parses to a RuleSet with the new path", async () => {
  const onChange = renderEditor();
  const pathInput = screen.getByDisplayValue("users/{userId}");

  await userEvent.type(pathInput, "x");

  expect(onChange).toHaveBeenCalled();
  const lastJson = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
  const parsed = JSON.parse(lastJson) as RuleSet;
  expect(parsed.Matches[0].Path).toBe("users/{userId}x");
});
