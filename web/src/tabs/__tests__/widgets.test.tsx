import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { StatRow } from "../widgets/StatRow";
import { DataTable } from "../widgets/DataTable";
import { TabRuntimeProvider, type TabRuntime } from "../runtime";
import type { FilterState } from "../nodes/render";
import type { LayoutNode } from "../../api/tabs";

const runtimeStub: TabRuntime = {
  commands: {}, userRole: "admin", canRun: () => true,
  runCommand: vi.fn(), refresh: vi.fn(), commit: vi.fn(),
};
const filterState: FilterState = {
  values: {}, drafts: {}, setValue: vi.fn(), setDraft: vi.fn(), commit: vi.fn(),
};
const tableNode = { type: "widget", kind: "table", id: "log", flex: 1 } as Extract<
  LayoutNode,
  { type: "widget"; kind: "table" }
>;

const wrap = (n: React.ReactNode) =>
  render(
    <MantineProvider>
      <TabRuntimeProvider value={runtimeStub}>{n}</TabRuntimeProvider>
    </MantineProvider>,
  );

test("StatRow renders a tile per stat (new shape)", () => {
  wrap(<StatRow data={{ stats: [{ label: "Users", value: 42, trend: "up", delta: "+1%" }, { label: "Docs", value: 7, trend: "neutral" }] }} />);
  expect(screen.getByText("Users")).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
  expect(screen.getByText("Docs")).toBeInTheDocument();
});

test("DataTable renders header row + positional cells (new shape)", () => {
  wrap(
    <DataTable
      node={tableNode}
      data={{
        columns: ["User", "Action"],
        total: 2,
        rows: [
          { key: "1", cells: ["alice", "Created"] },
          { key: "2", cells: ["bob", "Deleted"] },
        ],
      }}
      filters={filterState}
    />,
  );
  expect(screen.getByText("User")).toBeInTheDocument();
  expect(screen.getByText("alice")).toBeInTheDocument();
  expect(screen.getByText("Deleted")).toBeInTheDocument();
});
