import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { RenderNode } from "../nodes/render";
import type { LayoutNode } from "../../api/tabs";

const wrap = (n: React.ReactNode) => render(<MantineProvider>{n}</MantineProvider>);

const noFilters = { values: {}, setValue: vi.fn() };
const dataOf = () => ({ stats: [{ label: "Users", value: 42, trend: "neutral" as const }] });

test("renders a section title and a widget leaf", () => {
  const node: LayoutNode = {
    type: "section", title: "Overview", subtitle: "sub",
    children: [{ type: "widget", kind: "statRow", id: "kpis", flex: 1 }],
  };
  wrap(<RenderNode node={node} filters={noFilters} data={{ kpis: dataOf() }} />);
  expect(screen.getByText("Overview")).toBeInTheDocument();
  expect(screen.getByText("Users")).toBeInTheDocument();
});

test("a switch filter shows only the selected branch", () => {
  const node: LayoutNode = {
    type: "filter", control: { kind: "select", id: "view", options: ["A", "B"] }, mode: "switch",
    branches: {
      A: [{ type: "widget", kind: "statRow", id: "kA", flex: 1 }],
      B: [{ type: "widget", kind: "statRow", id: "kB", flex: 1 }],
    },
  };
  wrap(<RenderNode node={node} filters={{ values: { view: "B" }, setValue: vi.fn() }} data={{ kB: dataOf() }} />);
  expect(screen.getByText("Users")).toBeInTheDocument();  // branch B rendered
});
