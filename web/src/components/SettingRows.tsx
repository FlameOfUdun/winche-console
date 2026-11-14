import type { ReactNode } from "react";
import { Group, NumberInput, Paper, Text } from "@mantine/core";
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

/** One setting: an icon, its name, and its control on the right. */
export function SettingRow({ icon: Icon, label, children, dimmed = false, testId }: {
  icon: React.ElementType; label: ReactNode; children: ReactNode; dimmed?: boolean; testId?: string;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" px="md" py={12} className="winche-setting-row" data-testid={testId}
      style={{ opacity: dimmed ? 0.5 : 1, transition: "opacity 120ms" }}>
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0,
          background: "var(--mantine-color-winche-0)", color: "var(--mantine-color-winche-6)" }}>
          <Icon size={17} stroke={1.8} />
        </div>
        <Text size="sm" fw={500}>{label}</Text>
      </Group>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </Group>
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
