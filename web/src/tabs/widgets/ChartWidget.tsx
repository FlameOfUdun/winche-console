import { BarChart, LineChart } from "@mantine/charts";
import type { ChartData } from "../../api/tabs";

function toRows(data: ChartData): { rows: Record<string, unknown>[]; keys: string[] } {
  const byX = new Map<string | number, Record<string, unknown>>();
  const keys: string[] = [];
  data.series.forEach((series, i) => {
    const key = keys.includes(series.name) ? `${series.name} (${i + 1})` : series.name;
    keys.push(key);
    for (const pt of series.points) {
      const row = byX.get(pt.x) ?? { x: pt.x };
      row[key] = pt.y;
      byX.set(pt.x, row);
    }
  });
  return { rows: [...byX.values()], keys };
}

const PALETTE = ["blue.6", "teal.6", "grape.6", "orange.6"];

export function ChartWidget({ chart, data }: { chart: "line" | "bar"; data: ChartData }) {
  const { rows, keys } = toRows(data);
  const series = keys.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] }));
  const common = { h: 260, data: rows, dataKey: "x", series };
  return chart === "bar" ? <BarChart {...common} /> : <LineChart {...common} curveType="linear" />;
}
