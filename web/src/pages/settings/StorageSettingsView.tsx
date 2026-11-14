import { useState } from "react";
import { Group, NumberInput, Stack, Switch, TextInput, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { SettingsLayout } from "../../components/SettingsLayout";
import type { StorageSettings } from "../../api/dataSettings";
import { AreaHistory, AreaSettingsView, num, Section } from "./AreaSettings";
import { LocationSection } from "./LocationSection";

type StorageSection = "location" | "size" | "logging" | "cleanup" | "changes";
const STORAGE_SECTIONS: { id: StorageSection; label: string }[] = [
  { id: "location", label: "Where files are kept" }, { id: "size", label: "File size" }, { id: "logging", label: "Logging" },
  { id: "cleanup", label: "Clean-up" }, { id: "changes", label: "Change history" },
];

/** Storage → Settings: its sections listed on the left, the chosen one on the right. */
export function StorageSettingsView() {
  const [section, setSection] = useState<StorageSection>("location");
  const saved = useQuery({ queryKey: ["data-settings", "storage"], queryFn: () => api.dataSettings<StorageSettings>("storage") });
  const label = STORAGE_SECTIONS.find((s) => s.id === section)!.label;
  return (
    <SettingsLayout sections={STORAGE_SECTIONS} active={section} onChange={setSection}>
      {section === "location" ? <LocationSection /> : section === "changes" ? (
        <Stack gap="md"><Title order={4}>Change history</Title><AreaHistory area="storage" editable={saved.data?.editable ?? false} /></Stack>
      ) : (
    <AreaSettingsView<StorageSettings> area="storage" title={label} history={false}>
      {(draft, set, editable) => (
        <Stack gap="md">
          {section === "size" && <Section>
            <Group align="flex-end" wrap="wrap">
              <Switch label="Limit file size" disabled={!editable} checked={draft.maxFileSizeMb != null}
                onChange={(e) => set({ ...draft, maxFileSizeMb: e.currentTarget.checked ? 25 : null })} />
              {draft.maxFileSizeMb != null && (
                <NumberInput label="Largest file (MB)" w={180} min={0.001} decimalScale={3} disabled={!editable} value={draft.maxFileSizeMb}
                  onChange={(v) => set({ ...draft, maxFileSizeMb: num(v) })} />
              )}
            </Group>
          </Section>}
          {section === "logging" && <Section>
            <Group align="flex-end" wrap="wrap">
              <Switch label="Log requests" disabled={!editable} checked={draft.requestLog.enabled}
                onChange={(e) => set({ ...draft, requestLog: { ...draft.requestLog, enabled: e.currentTarget.checked } })} />
              {draft.requestLog.enabled && (
                <>
                  <NumberInput label="Successful requests logged (%)" w={220} min={0} max={100} disabled={!editable}
                    value={Math.round(draft.requestLog.sampleRate * 100)}
                    onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, sampleRate: v === "" ? 0 : Number(v) / 100 } })} />
                  <NumberInput label="Slow after (ms)" w={160} min={1} disabled={!editable} value={draft.requestLog.slowMs}
                    onChange={(v) => set({ ...draft, requestLog: { ...draft.requestLog, slowMs: num(v) } })} />
                </>
              )}
            </Group>
          </Section>}
          {section === "cleanup" && <Section>
            <Switch label="Regularly delete stored files no file record points to" disabled={!editable} checked={draft.orphanSweep.enabled}
              onChange={(e) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, enabled: e.currentTarget.checked } })} />
            {draft.orphanSweep.enabled && (
              <Group wrap="wrap">
                <NumberInput label="Every (hours)" w={150} min={0.25} decimalScale={2} disabled={!editable} value={draft.orphanSweep.intervalHours}
                  onChange={(v) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, intervalHours: num(v) } })} />
                <NumberInput label="Once older than (hours)" w={190} min={1} disabled={!editable} value={draft.orphanSweep.graceHours}
                  onChange={(v) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, graceHours: num(v) } })} />
                <TextInput label="Only under (optional)" placeholder="uploads/" disabled={!editable} value={draft.orphanSweep.prefix ?? ""}
                  onChange={(e) => set({ ...draft, orphanSweep: { ...draft.orphanSweep, prefix: e.currentTarget.value || null } })} />
              </Group>
            )}
          </Section>}
        </Stack>
      )}
    </AreaSettingsView>
      )}
    </SettingsLayout>
  );
}
