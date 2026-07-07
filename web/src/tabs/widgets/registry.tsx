import { StatRow } from "./StatRow";
import { DataTable } from "./DataTable";
import { ChartWidget } from "./ChartWidget";
import type { LayoutNode, ChartData, StatRowData, TableData } from "../../api/tabs";

type WidgetLeaf = Extract<LayoutNode, { type: "widget" }>;

/** Renders one widget leaf given its resolved data. */
export function renderWidget(node: WidgetLeaf, data: unknown) {
  switch (node.kind) {
    case "statRow": return <StatRow data={data as StatRowData} />;
    case "table":   return <DataTable data={data as TableData} />;
    case "chart":   return <ChartWidget chart={node.chart} data={data as ChartData} />;
  }
}
