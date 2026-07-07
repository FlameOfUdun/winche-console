import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { RenderNode, type FilterState } from "../nodes/render";
import { TabRuntimeProvider, type TabRuntime } from "../runtime";
import type { CommandSpec, LayoutNode } from "../../api/tabs";

const noFilters: FilterState = {
  values: {}, drafts: {}, setValue: vi.fn(), setDraft: vi.fn(), commit: vi.fn(),
};
const dataOf = () => ({ stats: [{ label: "Users", value: 42, trend: "neutral" as const }] });

const runtimeStub = (over: Partial<TabRuntime> = {}): TabRuntime => ({
  commands: {}, userRole: "admin", canRun: () => true,
  runCommand: vi.fn(), refresh: vi.fn(), commit: vi.fn(), ...over,
});

const wrap = (n: React.ReactNode, rt: TabRuntime = runtimeStub()) =>
  render(
    <MantineProvider>
      <TabRuntimeProvider value={rt}>{n}</TabRuntimeProvider>
    </MantineProvider>,
  );

const cmd: CommandSpec = { id: "act", label: "Do It", minRole: "admin", rowScoped: false, form: [] };

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
  wrap(<RenderNode node={node} filters={{ ...noFilters, values: { view: "B" } }} data={{ kB: dataOf() }} />);
  expect(screen.getByText("Users")).toBeInTheDocument();  // branch B rendered
});

test("a refresh button calls runtime.refresh on click", async () => {
  const refresh = vi.fn();
  const node: LayoutNode = { type: "button", intent: "refresh", label: "Refresh" };
  wrap(<RenderNode node={node} filters={noFilters} data={{}} />, runtimeStub({ refresh }));
  await userEvent.click(screen.getByText("Refresh"));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a row with justify packs children tightly (Group, not the proportional Grid)", () => {
  const node: LayoutNode = {
    type: "row", justify: "start",
    children: [
      { type: "button", intent: "refresh", label: "One" },
      { type: "button", intent: "refresh", label: "Two" },
    ],
  };
  const { container } = wrap(<RenderNode node={node} filters={noFilters} data={{}} />);
  expect(container.querySelector(".mantine-Group-root")).not.toBeNull();   // tight group branch
  expect(container.querySelector(".mantine-Grid-root")).toBeNull();        // not the grid branch
  expect(screen.getByText("One")).toBeInTheDocument();
  expect(screen.getByText("Two")).toBeInTheDocument();
});

test("a command button is hidden when canRun is false and shown when true", () => {
  const node: LayoutNode = { type: "button", intent: "command", commandId: "act", label: "Do It" };
  const commands = { act: cmd };

  const { unmount } = wrap(
    <RenderNode node={node} filters={noFilters} data={{}} />,
    runtimeStub({ commands, canRun: () => false }),
  );
  expect(screen.queryByText("Do It")).not.toBeInTheDocument();
  unmount();

  wrap(
    <RenderNode node={node} filters={noFilters} data={{}} />,
    runtimeStub({ commands, canRun: () => true }),
  );
  expect(screen.getByText("Do It")).toBeInTheDocument();
});

test("a manual text input renders an inline submit button that commits on click", async () => {
  const commit = vi.fn();
  const node: LayoutNode = {
    type: "filter", mode: "reactive",
    control: { kind: "text", id: "q", apply: "manual", submitLabel: "Search" },
    children: [],
  };
  wrap(<RenderNode node={node} filters={{ ...noFilters, commit }} data={{}} />);
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(commit).toHaveBeenCalledTimes(1);
});

test("a reactive text input has no submit button", () => {
  const node: LayoutNode = {
    type: "filter", mode: "reactive",
    control: { kind: "text", id: "q", apply: "reactive" },
    children: [],
  };
  wrap(<RenderNode node={node} filters={noFilters} data={{}} />);
  expect(screen.queryByRole("button")).toBeNull();
});
