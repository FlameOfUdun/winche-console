import { Group, Paper, Text } from "@mantine/core";
import type { StatRowData } from "../../api/tabs";

export function StatRow({ data }: { data: StatRowData }) {
  return (
    <Group gap="md" wrap="wrap">
      {data.stats.map((s, i) => (
        <Paper key={i} p="md" withBorder radius="md" style={{ minWidth: 140 }}>
          <Text size="xs" c="dimmed">{s.label}</Text>
          <Group gap={6} align="baseline">
            <Text fw={600} size="xl">{s.value}</Text>
            {s.delta && <Text size="xs" c={s.trend === "down" ? "red" : "teal"}>{s.delta}</Text>}
          </Group>
        </Paper>
      ))}
    </Group>
  );
}
