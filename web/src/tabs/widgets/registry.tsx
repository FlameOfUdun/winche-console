import { StatRow } from "./StatRow";
import { DataTable } from "./DataTable";
import { ChartWidget } from "./ChartWidget";
import type { LayoutNode, ChartData, StatRowData, TableData } from "../../api/tabs";
import type { FilterState } from "../nodes/render";

type WidgetLeaf = Extract<LayoutNode, { type: "widget" }>;

export function renderWidget(node: WidgetLeaf, data: unknown, filters: FilterState) {
  switch (node.kind) {
    case "statRow": return <StatRow data={data as StatRowData} />;
    case "table":   return <DataTable node={node} data={data as TableData} filters={filters} />;
    case "chart":   return <ChartWidget chart={node.chart} data={data as ChartData} />;
  }
}
