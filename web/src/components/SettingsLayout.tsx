import type { ReactNode } from "react";
import { Group, Stack, Text, UnstyledButton } from "@mantine/core";

export interface SettingsSection<T extends string> { id: T; label: string }

/** A settings tab: the sections listed on the left, the chosen one on the right. */
export function SettingsLayout<T extends string>({ sections, active, onChange, children }: {
  sections: SettingsSection<T>[]; active: T; onChange: (id: T) => void; children: ReactNode;
}) {
  return (
    <Group align="flex-start" gap="lg" wrap="wrap">
      <Stack gap={2} role="tablist" aria-label="Settings" style={{ flex: "1 1 200px", maxWidth: 240 }}>
        {sections.map((s) => (
          <UnstyledButton key={s.id} role="tab" aria-selected={active === s.id} onClick={() => onChange(s.id)}
            style={{ padding: "9px 12px", borderRadius: 8, background: active === s.id ? "var(--mantine-color-blue-0)" : undefined }}>
            <Text size="sm" fw={active === s.id ? 600 : 500} c={active === s.id ? "blue.8" : undefined}>{s.label}</Text>
          </UnstyledButton>
        ))}
      </Stack>
      <Stack gap="md" style={{ flex: "999 1 600px", minWidth: 0 }}>{children}</Stack>
    </Group>
  );
}
