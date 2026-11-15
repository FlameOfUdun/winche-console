import type { ReactNode } from "react";
import { Group, Text, Title } from "@mantine/core";
import { surface } from "../theme";

/** The top of every console page: where it sits (Build, Monitor…), its title, an optional line, and actions. */
export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-end" gap="md" wrap="wrap" mb="lg">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <Text size="sm" fw={500} c={surface.faint}>{eyebrow}</Text>}
        <Title order={1} fz={28} lh={1.2} mt={eyebrow ? 4 : 0} style={{ letterSpacing: "-0.01em" }}>{title}</Title>
        {description && <Text size="sm" c={surface.muted} mt={6} maw={760}>{description}</Text>}
      </div>
      {actions && <Group gap="xs" wrap="wrap">{actions}</Group>}
    </Group>
  );
}

/** A small status pill: On (green), Off / Not started (amber), or neutral. */
export function StatusPill({ tone, children }: { tone: "on" | "off" | "neutral" | "danger"; children: ReactNode }) {
  const styles = {
    on: { color: "var(--w-pill-on-fg)", background: "var(--w-pill-on-bg)", border: "1px solid var(--w-pill-on-bd)" },
    off: { color: "var(--w-pill-off-fg)", background: "var(--w-pill-off-bg)", border: "1px solid var(--w-pill-off-bd)" },
    neutral: { color: "var(--w-muted)", background: "var(--w-subtle)", border: "1px solid var(--w-border)" },
    danger: { color: "var(--w-pill-danger-fg)", background: "var(--w-pill-danger-bg)", border: "1px solid var(--w-pill-danger-bd)" },
  }[tone];
  return (
    <span style={{ ...styles, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>{children}</span>
  );
}
