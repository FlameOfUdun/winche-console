import type { ReactNode } from "react";

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
