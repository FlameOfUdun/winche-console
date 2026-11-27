import type { ReactNode } from "react";
import { NumberInput, Paper, Text } from "@mantine/core";
import { surface } from "../theme";

/** Settings as rows in one card, divided by hairlines. */
export function SettingsCard({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {title && <Text fw={600} size="sm" px="md" pt="sm" pb={4} c={surface.muted} tt="uppercase" fz={11} style={{ letterSpacing: "0.04em" }}>{title}</Text>}
      <div className="winche-setting-rows">{children}</div>
    </Paper>
  );
}

/** A number with its unit inside the field (KB, ms, days…). */
export function UnitInput({ value, onChange, unit, min, max, disabled, label, decimalScale, placeholder }: {
  value: number | ""; onChange: (v: number | string) => void; unit: string; min?: number; max?: number; disabled?: boolean;
  label: string; decimalScale?: number; placeholder?: string;
}) {
  return (
    <NumberInput aria-label={label} w={150} size="sm" value={value} onChange={onChange} min={min} max={max} disabled={disabled}
      decimalScale={decimalScale} placeholder={placeholder} hideControls
      rightSection={<Text size="xs" c={surface.faint} pr={8}>{unit}</Text>} rightSectionWidth={unit.length * 7 + 18} />
  );
}
