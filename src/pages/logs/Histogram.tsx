import { Group, Text } from "@mantine/core";
import type { Histogram as Data } from "../../api/logs";

const COLORS = { info: "var(--mantine-color-blue-4)", warning: "var(--mantine-color-yellow-6)", error: "var(--mantine-color-red-6)" };

function clock(at: string, long: boolean) {
  const d = new Date(at);
  return long
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Entries over time, stacked info / warning / error. */
export function Histogram({ data, title }: { data: Data; title: string }) {
  const max = Math.max(1, ...data.buckets.map((b) => b.info + b.warning + b.error));
  const w = 600 / Math.max(1, data.buckets.length);
  const long = new Date(data.to).getTime() - new Date(data.from).getTime() > 24 * 3_600_000;
  const mid = new Date((new Date(data.from).getTime() + new Date(data.to).getTime()) / 2).toISOString();
  return (
    <div data-testid="histogram">
      <Group justify="space-between" mb={4}>
        <Text size="xs" fw={500}>{title}</Text>
        <Group gap="sm">
          {(["info", "warning", "error"] as const).map((k) => (
            <Group key={k} gap={4}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[k], display: "inline-block" }} />
              <Text size="xs" c="dimmed">{k === "info" ? "Info" : k === "warning" ? "Warning" : "Error"}</Text>
            </Group>
          ))}
        </Group>
      </Group>
      <svg viewBox="0 0 600 60" preserveAspectRatio="none" width="100%" height={60} role="img" aria-label="Entries over time">
        {data.buckets.map((b, i) => {
          let y = 60;
          return (["info", "warning", "error"] as const).map((k) => {
            const h = (b[k] / max) * 58;
            y -= h;
            return h > 0 ? <rect key={`${i}${k}`} x={i * w + 0.5} y={y} width={Math.max(1, w - 1)} height={h} fill={COLORS[k]}>
              <title>{`${clock(b.start, long)}: ${b.info} info, ${b.warning} warning, ${b.error} error`}</title>
            </rect> : null;
          });
        })}
      </svg>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">{clock(data.from, long)}</Text>
        <Text size="xs" c="dimmed">{clock(mid, long)}</Text>
        <Text size="xs" c="dimmed">now</Text>
      </Group>
    </div>
  );
}
