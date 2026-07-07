import { Alert, Grid, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { Component, type ReactNode } from "react";
import type { ControlSpec, LayoutNode } from "../../api/tabs";
import { renderWidget } from "../widgets/registry";
import { EmbedFrame } from "./EmbedFrame";

export interface FilterState {
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
}

// Allocate 12 grid columns across children proportional to flex, summing to exactly 12 (largest remainder).
function gridSpans(flexes: number[]): number[] {
  const total = flexes.reduce((a, b) => a + b, 0) || 1;
  const raw = flexes.map((f) => (12 * f) / total);
  const spans = raw.map(Math.floor);
  let left = 12 - spans.reduce((a, b) => a + b, 0);
  const byFrac = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < left && k < byFrac.length; k++) spans[byFrac[k].i] += 1;
  return spans.map((s) => Math.max(1, s));
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <Alert color="red" variant="light">This section couldn't be displayed.</Alert>
      : this.props.children;
  }
}

function ControlView({ control, filters }: { control: ControlSpec; filters: FilterState }) {
  if (control.kind === "select") {
    return (
      <Select
        data={control.options}
        value={filters.values[control.id] ?? control.options[0] ?? ""}
        onChange={(v) => filters.setValue(control.id, v ?? "")}
        placeholder={control.id}
        w={180}
      />
    );
  }
  return (
    <Group gap="xs">
      <TextInput type="date" value={filters.values[`${control.id}From`] ?? ""}
        onChange={(e) => filters.setValue(`${control.id}From`, e.currentTarget.value)} w={150} />
      <TextInput type="date" value={filters.values[`${control.id}To`] ?? ""}
        onChange={(e) => filters.setValue(`${control.id}To`, e.currentTarget.value)} w={150} />
    </Group>
  );
}

export function RenderNode({
  node, filters, data,
}: { node: LayoutNode; filters: FilterState; data: Record<string, unknown> }) {
  switch (node.type) {
    case "column":
      return <Stack>{node.children.map((c, i) => <RenderNode key={i} node={c} filters={filters} data={data} />)}</Stack>;
    case "row": {
      const flexes = node.children.map((c) => (c.type === "widget" || c.type === "embed" ? c.flex : 1));
      const spans = gridSpans(flexes);
      return (
        <Grid>
          {node.children.map((c, i) => (
            <Grid.Col key={i} span={{ base: 12, sm: spans[i] }}>
              <RenderNode node={c} filters={filters} data={data} />
            </Grid.Col>
          ))}
        </Grid>
      );
    }
    case "section":
      return (
        <Stack gap="xs">
          <div><Title order={4}>{node.title}</Title>{node.subtitle && <Text size="sm" c="dimmed">{node.subtitle}</Text>}</div>
          {node.children.map((c, i) => <RenderNode key={i} node={c} filters={filters} data={data} />)}
        </Stack>
      );
    case "filter": {
      const value = filters.values[node.control.id] ?? (node.control.kind === "select" ? node.control.options[0] : "");
      const children = node.mode === "switch" ? (node.branches[value] ?? []) : node.children;
      return (
        <Stack>
          <Group><ControlView control={node.control} filters={filters} /></Group>
          {children.map((c, i) => <RenderNode key={i} node={c} filters={filters} data={data} />)}
        </Stack>
      );
    }
    case "widget": {
      const slice = data[node.id];
      if (slice === undefined || slice === null)
        return <Alert color="red" variant="light">This section couldn't be displayed.</Alert>;
      return <Boundary>{renderWidget(node, slice)}</Boundary>;
    }
    case "embed":
      return <Boundary><EmbedFrame node={node} /></Boundary>;
  }
}
