export type ControlSpec =
  | { kind: "select"; id: string; options: string[] }
  | { kind: "dateRange"; id: string }
  | { kind: "text"; id: string; apply: "reactive" | "manual"; placeholder?: string | null; submitLabel?: string | null };

export type LayoutNode =
  | { type: "column"; children: LayoutNode[] }
  | { type: "row"; justify?: "start" | "center" | "end" | "spaceBetween" | null; children: LayoutNode[] }
  | { type: "section"; title: string; subtitle?: string | null; children: LayoutNode[] }
  | { type: "filter"; control: ControlSpec; mode: "reactive"; children: LayoutNode[] }
  | { type: "filter"; control: ControlSpec; mode: "switch"; branches: Record<string, LayoutNode[]> }
  | { type: "widget"; kind: "statRow"; id: string; flex: number }
  | { type: "widget"; kind: "table"; id: string; flex: number; paginate?: number | null; rowActions?: string[] }
  | { type: "widget"; kind: "chart"; chart: "line" | "bar"; id: string; flex: number }
  | { type: "embed"; id: string; route: string; flex: number; minHeight: number; sandbox: string }
  | { type: "button"; intent: "command" | "refresh"; commandId?: string | null; label: string };

export type FieldKind = "text" | "textarea" | "number" | "boolean" | "select" | "date";
export interface FieldSpec {
  key: string; kind: FieldKind; label: string; required: boolean;
  default?: unknown; options?: string[] | null;
  min?: number | null; max?: number | null; pattern?: string | null; placeholder?: string | null;
}
export interface CommandSpec {
  id: string; label: string; minRole: "viewer" | "member" | "admin";
  confirm?: string | null; rowScoped: boolean; form: FieldSpec[];
}

export interface TabNav { id: string; label: string; icon: string }
export interface TabLayout { id: string; label: string; root: LayoutNode; commands: Record<string, CommandSpec> }

export interface StatRowData { stats: { label: string; value: string | number; delta?: string | null; trend: "neutral" | "up" | "down" }[] }
export interface ChartData { series: { name: string; points: { x: string | number; y: number }[] }[] }
export interface TableRow { key: string; cells: (string | number | null)[] }
export interface TableData { columns: string[]; total: number; rows: TableRow[] }

export interface TabDataResponse { widgets: Record<string, unknown> }

export type CommandOutcome =
  | { status: "ok"; message?: string | null; refetch: "tab" | "none" }
  | { status: "invalid"; fieldErrors: Record<string, string> }
  | { status: "error"; message?: string | null };
