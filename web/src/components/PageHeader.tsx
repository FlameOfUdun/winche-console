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
    on: { color: "#067647", background: "#ECFDF3", border: "1px solid #ABEFC6" },
    off: { color: "#B54708", background: "#FFFAEB", border: "1px solid #FEDF89" },
    neutral: { color: "#475467", background: "#F2F4F7", border: "1px solid #E4E7EC" },
    danger: { color: "#B42318", background: "#FEF3F2", border: "1px solid #FECDCA" },
  }[tone];
  return (
    <span style={{ ...styles, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>{children}</span>
  );
}
