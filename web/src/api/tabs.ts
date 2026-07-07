export type ControlSpec =
  | { kind: "select"; id: string; options: string[] }
  | { kind: "dateRange"; id: string };

export type LayoutNode =
  | { type: "column"; children: LayoutNode[] }
  | { type: "row"; children: LayoutNode[] }
  | { type: "section"; title: string; subtitle?: string | null; children: LayoutNode[] }
  | { type: "filter"; control: ControlSpec; mode: "reactive"; children: LayoutNode[] }
  | { type: "filter"; control: ControlSpec; mode: "switch"; branches: Record<string, LayoutNode[]> }
  | { type: "widget"; kind: "statRow" | "table"; id: string; flex: number }
  | { type: "widget"; kind: "chart"; chart: "line" | "bar"; id: string; flex: number }
  | { type: "embed"; id: string; route: string; flex: number; minHeight: number };

export interface TabNav { id: string; label: string; icon: string }
export interface TabLayout { id: string; label: string; root: LayoutNode }

export interface StatRowData { stats: { label: string; value: string | number; delta?: string | null; trend: "neutral" | "up" | "down" }[] }
export interface ChartData { series: { name: string; points: { x: string | number; y: number }[] }[] }
export interface TableData { columns: string[]; rows: (string | number | null)[][] }

export interface TabDataResponse { widgets: Record<string, unknown> }
